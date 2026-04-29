import { schema } from '@osd/config-schema';
import { IRouter, Logger, exportSavedObjectsToStream } from '../../../../src/core/server';
import { API_BASE, extractEmbeddedIndexPatternRefs } from '../../common';

/**
 * Collect all objects from a Readable stream into an array.
 */
async function streamToArray(stream: NodeJS.ReadableStream): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * After the core export, scan all objects for inline index-pattern references
 * (TSVB params.index_pattern, searchSourceJSON.index, Vega specs) that aren't
 * in the formal references array. Fetch any missing index-patterns and append
 * them to the export bundle.
 */
async function resolveInlineIndexPatterns(
  exportedObjects: Array<Record<string, unknown>>,
  client: { get: (type: string, id: string) => Promise<any>; find: (options: any) => Promise<any> },
  logger: Logger
): Promise<Array<Record<string, unknown>>> {
  // Build a set of all object keys already in the bundle (by type:id)
  const bundledKeys = new Set<string>();
  // Also track index-pattern titles already in the bundle
  const bundledPatternTitles = new Set<string>();
  for (const obj of exportedObjects) {
    if (obj.type && obj.id) {
      bundledKeys.add(`${obj.type}:${obj.id}`);
    }
    if (obj.type === 'index-pattern' && (obj.attributes as any)?.title) {
      bundledPatternTitles.add((obj.attributes as any).title as string);
    }
  }

  // Collect missing inline-referenced index-pattern values (could be IDs or titles)
  const missingRefs = new Set<string>();
  for (const obj of exportedObjects) {
    if (!obj.type || !obj.id) continue; // skip export details line
    const embeddedIds = extractEmbeddedIndexPatternRefs(obj as any);
    for (const ref of embeddedIds) {
      // Skip if already covered by a formal reference
      const refs = (obj.references ?? []) as Array<{ type: string; id: string }>;
      if (refs.some((r) => r.type === 'index-pattern' && r.id === ref)) continue;
      // Skip if already in bundle by ID or by title
      if (bundledKeys.has(`index-pattern:${ref}`) || bundledPatternTitles.has(ref)) continue;
      missingRefs.add(ref);
    }
  }

  if (missingRefs.size === 0) return exportedObjects;

  // Fetch each missing index-pattern — try by ID first, then search by title
  const additional: Array<Record<string, unknown>> = [];
  for (const ref of missingRefs) {
    try {
      // Try direct get by ID
      const savedObj = await client.get('index-pattern', ref);
      additional.push({
        id: savedObj.id,
        type: savedObj.type,
        attributes: savedObj.attributes,
        references: savedObj.references ?? [],
        ...(savedObj.migrationVersion ? { migrationVersion: savedObj.migrationVersion } : {}),
      });
      bundledKeys.add(`index-pattern:${savedObj.id}`);
      bundledPatternTitles.add((savedObj.attributes?.title ?? '') as string);
      logger.info(`Resolved inline index-pattern '${ref}' (by ID) into export bundle`);
    } catch {
      // ID lookup failed — try searching by title
      try {
        const findResult = await client.find({
          type: 'index-pattern',
          search: ref,
          searchFields: ['title'],
          perPage: 10,
        });
        const match = findResult.saved_objects.find(
          (o: any) => o.attributes?.title === ref
        );
        if (match && !bundledKeys.has(`index-pattern:${match.id}`)) {
          additional.push({
            id: match.id,
            type: match.type,
            attributes: match.attributes,
            references: match.references ?? [],
            ...(match.migrationVersion ? { migrationVersion: match.migrationVersion } : {}),
          });
          bundledKeys.add(`index-pattern:${match.id}`);
          bundledPatternTitles.add(ref);
          logger.info(`Resolved inline index-pattern '${ref}' (by title) into export bundle`);
        } else if (!match) {
          logger.warn(`Could not find inline-referenced index-pattern '${ref}' by ID or title`);
        }
      } catch (e2) {
        logger.warn(`Could not resolve inline-referenced index-pattern '${ref}': ${(e2 as Error).message}`);
      }
    }
  }

  if (additional.length === 0) return exportedObjects;

  // Insert additional objects before the export details line (last line)
  const lastObj = exportedObjects[exportedObjects.length - 1];
  const isExportDetails = lastObj && !lastObj.type && (lastObj as any).exportedCount !== undefined;

  if (isExportDetails) {
    const withoutDetails = exportedObjects.slice(0, -1);
    (lastObj as any).exportedCount = (lastObj as any).exportedCount + additional.length;
    return [...withoutDetails, ...additional, lastObj];
  }

  return [...exportedObjects, ...additional];
}

export function registerExportRoute(router: IRouter, logger: Logger) {
  router.post(
    {
      path: `${API_BASE}/export`,
      validate: {
        body: schema.object({
          objects: schema.arrayOf(
            schema.object({
              type: schema.string(),
              id: schema.string(),
            })
          ),
        }),
      },
    },
    async (context, req, res) => {
      const { objects } = req.body;

      // Handle empty objects array
      if (objects.length === 0) {
        return res.ok({ body: { ndjson: '' } });
      }

      const client = context.core.savedObjects.client;

      try {
        const exportStream = await exportSavedObjectsToStream({
          savedObjectsClient: client,
          objects,
          exportSizeLimit: 10000,
          includeReferencesDeep: true,
          excludeExportDetails: false,
        });

        let exportedObjects = await streamToArray(exportStream);

        // Resolve inline index-pattern references that the core export missed
        exportedObjects = await resolveInlineIndexPatterns(
          exportedObjects as Array<Record<string, unknown>>,
          client,
          logger
        );

        const ndjson = exportedObjects.map((obj) => JSON.stringify(obj)).join('\n');

        return res.ok({ body: { ndjson } });
      } catch (e) {
        logger.error(`Failed to export: ${e.message}`);
        // Boom errors from core have statusCode on output
        const statusCode = e.isBoom ? e.output.statusCode : 500;
        return res.customError({ statusCode, body: { message: e.message } });
      }
    }
  );
}
