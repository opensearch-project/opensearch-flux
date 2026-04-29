import { InspectionReport, PlatformType, RepairConfig, RepairResult } from './types';

// GET /api/saved_object_migration/dashboards
export interface DashboardsRequestQuery {
  page?: number;
  perPage?: number;
  search?: string;
}

export interface DashboardsResponse {
  dashboards: Array<{ id: string; title: string; description?: string }>;
  total: number;
  page: number;
  perPage: number;
}

// POST /api/saved_object_migration/export
export interface ExportRequestBody {
  objects: Array<{ type: string; id: string }>;
}

export interface ExportResponse {
  ndjson: string;
}

// POST /api/saved_object_migration/inspect
export interface InspectRequestBody {
  ndjson: string;
  sourcePlatform?: PlatformType;
  targetPlatform?: PlatformType;
}

export type InspectResponse = InspectionReport;

// POST /api/saved_object_migration/repair
export interface RepairRequestBody {
  ndjson: string;
  config: RepairConfig;
}

export type RepairResponse = RepairResult;

// POST /api/saved_object_migration/import
export interface ImportRequestBody {
  ndjson: string;
  overwrite?: boolean;
  createNewCopies?: boolean;
  dataSourceId?: string;
  workspaceId?: string;
}

export interface ImportResponse {
  success: boolean;
  successCount: number;
  successResults?: Array<{ type: string; id: string; meta?: { title?: string } }>;
  successByType?: Record<string, number>;
  errors?: Array<{
    id: string;
    type: string;
    error: { type: string; message?: string };
  }>;
  dashboardUrl?: string;
}
