/**
 * Configuration for connecting to an OpenSearch Dashboards instance.
 */
export interface ConnectionConfig {
  /** Full endpoint URL, e.g. https://my-domain.us-east-1.es.amazonaws.com */
  endpoint: string;
  /** Authentication method */
  auth:
    | { type: 'iam'; region: string; service?: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'cookie'; cookie: string }
    | { type: 'none' };
  /** Optional workspace ID (for OpenSearch UI workspace-based instances) */
  workspaceId?: string;
}

/**
 * A saved object as represented in NDJSON export format.
 */
export interface SavedObject {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  references: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SavedObjectReference {
  id: string;
  name: string;
  type: string;
}

/**
 * Result of exporting saved objects.
 */
export interface ExportResult {
  objects: SavedObject[];
  /** Raw NDJSON string */
  ndjson: string;
  /** Export metadata line (last line of NDJSON) */
  exportDetails?: Record<string, unknown>;
}

/**
 * Platform type detected from an endpoint URL.
 */
export type PlatformType = 'aos' | 'opensearch-ui' | 'aoss' | 'unknown';

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
