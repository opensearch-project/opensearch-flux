import { SavedObject, InspectionReport, InspectionIssue, PlatformType } from './types.js';

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
