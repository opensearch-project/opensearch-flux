import { Readable } from 'stream';
import { schema } from '@osd/config-schema';
import { IRouter, Logger, importSavedObjectsFromStream } from '../../../../src/core/server';
import { API_BASE } from '../../common';

/**
 * Convert an NDJSON string into a Readable objectMode stream of parsed SavedObjects.
 * Filters out the export details metadata line (objects without type+id).
 * This matches what collectSavedObjects() inside importSavedObjectsFromStream expects:
 * a stream that yields individual SavedObject items.
 */
function ndjsonToSavedObjectStream(ndjson: string): Readable {
  const objects = ndjson
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((obj: Record<string, unknown>) => obj.type && obj.id);

  let index = 0;
  return new Readable({
    objectMode: true,
    read() {
      if (index < objects.length) {
        this.push(objects[index++]);
      } else {
        this.push(null);
      }
    },
  });
}

export function registerImportRoute(router: IRouter, logger: Logger) {
  router.post(
    {
      path: `${API_BASE}/import`,
      options: {
        body: {
          maxBytes: 100 * 1024 * 1024, // 100MB
        },
      },
      validate: {
        body: schema.object(
          {
            ndjson: schema.string(),
            overwrite: schema.boolean({ defaultValue: false }),
            createNewCopies: schema.boolean({ defaultValue: false }),
            dataSourceId: schema.maybe(schema.string()),
            workspaceId: schema.maybe(schema.string()),
          },
          {
            validate: (body) => {
              if (body.overwrite && body.createNewCopies) {
                return 'cannot use [overwrite] with [createNewCopies]';
              }
            },
          }
        ),
      },
    },
    async (context, req, res) => {
      const { ndjson, overwrite, createNewCopies, dataSourceId, workspaceId } = req.body;
      const client = context.core.savedObjects.client;
      const typeRegistry = context.core.savedObjects.typeRegistry;

      // Handle empty NDJSON
      if (!ndjson.trim()) {
        return res.ok({ body: { success: true, successCount: 0 } });
      }

      // Validate NDJSON is parseable before creating stream
      try {
        ndjson
          .trim()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => JSON.parse(line));
      } catch (e) {
        return res.badRequest({ body: { message: `Malformed NDJSON: ${e.message}` } });
      }

      try {
        // Resolve data source title if dataSourceId is provided
        let dataSourceTitle: string | undefined;
        if (dataSourceId) {
          const dsObj = await client.get<{ title: string }>('data-source', dataSourceId);
          dataSourceTitle = dsObj.attributes.title;
        }

        const readStream = ndjsonToSavedObjectStream(ndjson);

        const result = await importSavedObjectsFromStream({
          readStream,
          objectLimit: 10000,
          overwrite,
          createNewCopies,
          savedObjectsClient: client,
          typeRegistry,
          ...(dataSourceId ? { dataSourceId, dataSourceTitle, dataSourceEnabled: true } : {}),
          ...(workspaceId ? { workspaces: [workspaceId] } : {}),
        });

        return res.ok({ body: result });
      } catch (e) {
        logger.error(`Failed to import: ${e.message}`);
        return res.customError({ statusCode: 500, body: { message: e.message } });
      }
    }
  );
}
