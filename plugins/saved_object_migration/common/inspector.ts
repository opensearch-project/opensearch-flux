import { SavedObject, InspectionReport, InspectionIssue, PlatformType } from './types';

/**
 * Types known to render correctly in the OpenSearch UI frontend.
 * The backend API accepts any type string (Smithy model only requires NonTraversalString),
 * but only these types have confirmed frontend rendering support.
 */
export const UI_RENDERABLE_TYPES = new Set([
  'dashboard', 'visualization', 'index-pattern', 'search', 'config', 'data-source',
]);

/**
 * Optional context for target-aware inspection.
 * When provided, the inspector runs additional platform-specific checks.
 */
export interface InspectionContext {
  sourcePlatform?: PlatformType;
  targetPlatform?: PlatformType;
  /** Override the default UI_RENDERABLE_TYPES set */
  customRenderableTypes?: Set<string>;
  /** IDs that exist on the target instance (e.g., remapped data-source IDs) — skip missing reference errors for these */
  knownExternalIds?: Set<string>;
}

/**
 * Inspects an array of saved objects for issues before import.
 * Detects broken references, conflicts, missing dependencies, etc.
 * When context is provided, also checks type renderability and permissions gaps.
 */
export function inspect(objects: SavedObject[], context?: InspectionContext): InspectionReport {
  const issues: InspectionIssue[] = [];
  const objectIndex = new Map<string, SavedObject>();

  // Build index of all objects by "type:id"
  for (const obj of objects) {
    objectIndex.set(`${obj.type}:${obj.id}`, obj);
  }

  // Structural check: missing references
  for (const obj of objects) {
    if (obj.references && obj.references.length > 0) {
      for (const ref of obj.references) {
        const refKey = `${ref.type}:${ref.id}`;
        if (!objectIndex.has(refKey)) {
          // Skip if this ID is known to exist on the target instance
          if (context?.knownExternalIds?.has(ref.id)) continue;
          issues.push({
            severity: 'ERROR',
            type: 'MISSING_REFERENCE',
            objectId: obj.id,
            objectType: obj.type,
            message: `References ${ref.type} '${ref.id}' (name: '${ref.name}') which is not included in the export`,
            remediation: `Include ${ref.type} '${ref.id}' in the export, or remap to an existing object in the target`,
            phase: 'PRE_EXPORT',
          });
        }
      }
    }
  }

  // Build a title→key lookup for index-patterns so we can match inline references
  // that use the pattern title (e.g. TSVB params.index_pattern) rather than the object ID.
  const indexPatternTitleIndex = new Map<string, string>();
  for (const obj of objects) {
    if (obj.type === 'index-pattern' && obj.attributes?.title) {
      indexPatternTitleIndex.set(obj.attributes.title as string, `${obj.type}:${obj.id}`);
    }
  }

  // Embedded reference check: detect index patterns referenced inline rather than via `references`
  // Covers searchSourceJSON.index, TSVB params.index_pattern, and Vega data URLs
  for (const obj of objects) {
    if (!obj.attributes) continue;
    const title = (obj.attributes.title as string) ?? obj.id;
    const embeddedIds = extractEmbeddedIndexPatternRefs(obj);

    for (const embeddedId of embeddedIds) {
      // Already covered by a formal reference — skip
      if (obj.references?.some((r) => r.type === 'index-pattern' && r.id === embeddedId)) continue;

      // Check by ID first, then fall back to matching by title
      const inBundle = objectIndex.has(`index-pattern:${embeddedId}`) || indexPatternTitleIndex.has(embeddedId);
      const inFormalRefs = obj.references?.length > 0;

      if (!inBundle) {
        issues.push({
          severity: 'WARNING',
          type: 'EMBEDDED_INDEX_REFERENCE',
          objectId: obj.id,
          objectType: obj.type,
          message: `${obj.type} "${title}" references index-pattern '${embeddedId}' inline (not via references array) and it is missing from the export`,
          remediation: 'Manually include this index-pattern in the export, or verify it already exists on the target instance',
          phase: 'PRE_EXPORT',
        });
      } else if (!inFormalRefs) {
        issues.push({
          severity: 'INFO',
          type: 'EMBEDDED_INDEX_REFERENCE',
          objectId: obj.id,
          objectType: obj.type,
          message: `${obj.type} "${title}" references index-pattern '${embeddedId}' inline rather than via the references array (object is present in export)`,
          phase: 'PRE_EXPORT',
        });
      }
    }
  }

  // Structural check: duplicate IDs
  const idCounts = new Map<string, number>();
  for (const obj of objects) {
    const key = `${obj.type}:${obj.id}`;
    idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of idCounts) {
    if (count > 1) {
      const [type, id] = key.split(':');
      issues.push({
        severity: 'ERROR',
        type: 'DUPLICATE_ID',
        objectId: id,
        objectType: type,
        message: `Object ${type}/${id} appears ${count} times in the export`,
        remediation: 'Remove duplicate entries from the NDJSON file',
        phase: 'PRE_EXPORT',
      });
    }
  }

  // Build type distribution
  const objectsByType: Record<string, number> = {};
  for (const obj of objects) {
    objectsByType[obj.type] = (objectsByType[obj.type] ?? 0) + 1;
  }

  // Size/complexity info
  issues.push({
    severity: 'INFO',
    type: 'OBJECT_COUNT',
    objectId: '',
    objectType: '',
    message: `Export contains ${objects.length} objects across ${Object.keys(objectsByType).length} types`,
    phase: 'PRE_EXPORT',
  });

  // Target-aware checks (only when context is provided)
  let nonRenderableTypeSummary: Record<string, number> | null = null;
  const targetPlatform = context?.targetPlatform ?? null;

  if (context?.targetPlatform) {
    // Type renderability check
    const renderableTypes = context.customRenderableTypes ?? UI_RENDERABLE_TYPES;
    const nonRenderableCounts: Record<string, number> = {};

    for (const obj of objects) {
      if (!renderableTypes.has(obj.type)) {
        nonRenderableCounts[obj.type] = (nonRenderableCounts[obj.type] ?? 0) + 1;
        const title = (obj.attributes?.title as string) ?? '';
        issues.push({
          severity: 'WARNING',
          type: 'NON_RENDERABLE_TYPE',
          objectId: obj.id,
          objectType: obj.type,
          message: `Object type '${obj.type}' may not render in the OpenSearch UI frontend${title ? ` (title: "${title}")` : ''}`,
          remediation: 'The object will be stored by the backend API but may not be visible in the UI. Verify rendering after import.',
          phase: 'PRE_IMPORT',
        });
      }
    }

    nonRenderableTypeSummary = Object.keys(nonRenderableCounts).length > 0 ? nonRenderableCounts : null;

    // Permissions warning (AOS/AOSS → OpenSearch UI)
    if ((context.sourcePlatform === 'aos' || context.sourcePlatform === 'aoss') && context.targetPlatform === 'opensearch-ui') {
      const platformLabel = context.sourcePlatform === 'aoss' ? 'AOSS' : 'AOS';
      issues.push({
        severity: 'WARNING',
        type: 'MISSING_PERMISSIONS',
        objectId: '',
        objectType: '',
        message: `Imported objects will have empty permissions. ${platformLabel} does not support per-object permissions, but OpenSearch UI uses read, write, library_read, library_write permission types.`,
        remediation: 'Assign permissions to imported objects after migration via the OpenSearch UI admin interface.',
        phase: 'PRE_IMPORT',
      });
    }

    // AOSS-specific warnings (AOSS → OpenSearch UI)
    if (context.sourcePlatform === 'aoss' && context.targetPlatform === 'opensearch-ui') {
      issues.push({
        severity: 'INFO',
        type: 'AOSS_COLLECTION_SEMANTICS',
        objectId: '',
        objectType: '',
        message: 'Source is an AOSS collection. AOSS uses collection-level access control (IAM policies) rather than index-level FGAC. Verify that the target data source has appropriate access to the backing indices.',
        phase: 'PRE_IMPORT',
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'ERROR').length;
  const warnings = issues.filter((i) => i.severity === 'WARNING').length;
  const info = issues.filter((i) => i.severity === 'INFO').length;

  return {
    summary: { totalObjects: objects.length, errors, warnings, info },
    objectsByType,
    issues,
    targetPlatform,
    nonRenderableTypeSummary,
  };
}

/**
 * Extract index-pattern IDs embedded inline in a saved object's attributes.
 * These are references that bypass the formal `references` array.
 *
 * Covers:
 *  1. searchSourceJSON.index — standard visualizations & saved searches
 *  2. visState.params.index_pattern — TSVB (Visual Builder) visualizations
 *  3. visState.params (Vega) — %opensearch%.index in Vega spec URLs
 */
export function extractEmbeddedIndexPatternRefs(obj: SavedObject): string[] {
  const ids: string[] = [];
  const attrs = obj.attributes ?? {};
  const meta = attrs.kibanaSavedObjectMeta as Record<string, unknown> | undefined;

  // 1. searchSourceJSON → "index" field
  if (meta?.searchSourceJSON && typeof meta.searchSourceJSON === 'string') {
    try {
      const parsed = JSON.parse(meta.searchSourceJSON);
      if (typeof parsed.index === 'string' && parsed.index.length > 0) {
        ids.push(parsed.index);
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // 2. visState → params.index_pattern (TSVB)
  const visStateRaw = attrs.visState;
  if (typeof visStateRaw === 'string') {
    try {
      const visState = JSON.parse(visStateRaw);
      if (visState?.params?.index_pattern && typeof visState.params.index_pattern === 'string') {
        ids.push(visState.params.index_pattern);
      }
      // Also check per-series index_pattern overrides in TSVB
      if (Array.isArray(visState?.params?.series)) {
        for (const series of visState.params.series) {
          if (series.override_index_pattern && typeof series.series_index_pattern === 'string' && series.series_index_pattern.length > 0) {
            ids.push(series.series_index_pattern);
          }
        }
      }
    } catch {
      // malformed JSON — skip
    }
  }

  // 3. Vega specs — look for index references in the spec string
  if (typeof visStateRaw === 'string') {
    try {
      const visState = JSON.parse(visStateRaw);
      if (visState?.type === 'vega' || visState?.type === 'vega-lite') {
        const spec = visState?.params?.spec;
        if (typeof spec === 'string') {
          // Match patterns like: index: "my-index-*" or "index": "my-index-*"
          const vegaIndexRegex = /["']?index["']?\s*:\s*["']([^"'\s,}]+)["']/g;
          let match;
          while ((match = vegaIndexRegex.exec(spec)) !== null) {
            const candidate = match[1];
            // Skip Vega schema keywords and URLs
            if (!candidate.startsWith('http') && !candidate.startsWith('$') && !candidate.startsWith('%')) {
              ids.push(candidate);
            }
          }
        }
      }
    } catch {
      // already handled above
    }
  }

  // Deduplicate
  return [...new Set(ids)];
}
