export type PlatformType = 'aos' | 'aoss' | 'opensearch-ui' | 'unknown';

export interface SavedObjectReference {
  name: string;
  type: string;
  id: string;
}

export interface SavedObject {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  references: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * A single issue found during inspection.
 */
export interface InspectionIssue {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  type: string;
  objectId: string;
  objectType: string;
  message: string;
  remediation?: string;
  /** Migration phase this issue belongs to */
  phase?: 'PRE_EXPORT' | 'TRANSFORM' | 'PRE_IMPORT';
}

/**
 * Full inspection report.
 */
export interface InspectionReport {
  summary: {
    totalObjects: number;
    errors: number;
    warnings: number;
    info: number;
  };
  objectsByType: Record<string, number>;
  issues: InspectionIssue[];
  /** Detected target platform, null when no target provided */
  targetPlatform?: PlatformType | null;
  /** Count of objects with types that may not render in the UI frontend, grouped by type */
  nonRenderableTypeSummary?: Record<string, number> | null;
}

export interface RepairConfig {
  stripDataSourcePrefixes: boolean;
  remapDataSources: { enabled: boolean; targetId?: string; targetTitle?: string };
  stripDashboardDatasets: boolean;
  remapIndexPatterns: { enabled: boolean; mappings?: Record<string, string> };
  disableMissingFieldFilters: boolean;
}

export interface RepairResult {
  ndjson: string;
  changes: string[];
}
