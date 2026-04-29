import { Readable } from 'stream';
import { API_BASE } from '../../common/constants';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFind = jest.fn();
const mockGet = jest.fn();
const mockSavedObjectsClient = { find: mockFind, get: mockGet, bulkGet: jest.fn() };
const mockTypeRegistry = {
  getImportableAndExportableTypes: jest.fn().mockReturnValue([
    { name: 'dashboard' },
    { name: 'visualization' },
    { name: 'index-pattern' },
    { name: 'search' },
  ]),
  getType: jest.fn().mockReturnValue({ management: { icon: 'dashboardApp' } }),
  isImportableAndExportable: jest.fn().mockReturnValue(true),
};

const mockExportStream = jest.fn();
jest.mock('../../../../src/core/server', () => {
  const actual = jest.requireActual('../../../../src/core/server');
  return {
    ...actual,
    exportSavedObjectsToStream: (...args: unknown[]) => mockExportStream(...args),
    importSavedObjectsFromStream: jest.fn().mockResolvedValue({
      success: true,
      successCount: 2,
    }),
  };
});

import { importSavedObjectsFromStream } from '../../../../src/core/server';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockRouter() {
  const routes: Record<string, { validate: unknown; handler: Function; options?: unknown }> = {};
  return {
    get: jest.fn((config: { path: string; validate: unknown }, handler: Function) => {
      routes[`GET ${config.path}`] = { validate: config.validate, handler };
    }),
    post: jest.fn((config: { path: string; validate: unknown; options?: unknown }, handler: Function) => {
      routes[`POST ${config.path}`] = { validate: config.validate, handler, options: (config as Record<string, unknown>).options };
    }),
    routes,
  };
}

function createMockContext() {
  return {
    core: {
      savedObjects: {
        client: mockSavedObjectsClient,
        typeRegistry: mockTypeRegistry,
      },
    },
  };
}

function createMockResponse() {
  return {
    ok: jest.fn((opts: { body: unknown }) => ({ status: 200, body: opts.body })),
    badRequest: jest.fn((opts: { body: unknown }) => ({ status: 400, body: opts.body })),
    customError: jest.fn((opts: { statusCode: number; body: unknown }) => ({
      status: opts.statusCode,
      body: opts.body,
    })),
  };
}

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  get: jest.fn(),
};

const allDisabledConfig = {
  stripDataSourcePrefixes: false,
  remapDataSources: { enabled: false },
  stripDashboardDatasets: false,
  remapIndexPatterns: { enabled: false },
  disableMissingFieldFilters: false,
};

// ─── Import route registrations ──────────────────────────────────────────────

import { registerDashboardsRoute } from '../../server/routes/dashboards';
import { registerExportRoute } from '../../server/routes/export';
import { registerInspectRoute } from '../../server/routes/inspect';
import { registerRepairRoute } from '../../server/routes/repair';
import { registerImportRoute } from '../../server/routes/import';
import { registerRoutes } from '../../server/routes';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('savedObjectMigration server routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerRoutes', () => {
    it('registers all 5 routes', () => {
      const router = createMockRouter();
      registerRoutes(router as unknown as Parameters<typeof registerRoutes>[0], mockLogger as unknown as Parameters<typeof registerRoutes>[1]);

      expect(router.get).toHaveBeenCalledTimes(1);
      expect(router.post).toHaveBeenCalledTimes(4);
    });
  });

  describe('GET /dashboards', () => {
    let handler: Function;

    beforeEach(() => {
      const router = createMockRouter();
      registerDashboardsRoute(router as unknown as Parameters<typeof registerDashboardsRoute>[0], mockLogger as unknown as Parameters<typeof registerDashboardsRoute>[1]);
      handler = router.routes[`GET ${API_BASE}/dashboards`].handler;
    });

    it('returns paginated dashboard list', async () => {
      mockFind.mockResolvedValue({
        saved_objects: [
          { id: 'd1', type: 'dashboard', attributes: { title: 'Dashboard 1', description: 'Desc 1' } },
          { id: 'd2', type: 'dashboard', attributes: { title: 'Dashboard 2', description: '' } },
        ],
        total: 2,
        page: 1,
        per_page: 20,
      });

      const context = createMockContext();
      const req = { query: { page: 1, perPage: 20 } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(mockFind).toHaveBeenCalledWith({
        type: ['dashboard'],
        perPage: 20,
        page: 1,
        fields: ['title', 'description'],
      });
      expect(res.ok).toHaveBeenCalledWith({
        body: {
          dashboards: [
            { id: 'd1', title: 'Dashboard 1', description: 'Desc 1' },
            { id: 'd2', title: 'Dashboard 2', description: '' },
          ],
          total: 2,
          page: 1,
          perPage: 20,
        },
      });
    });

    it('passes search parameter when provided', async () => {
      mockFind.mockResolvedValue({ saved_objects: [], total: 0, page: 1, per_page: 20 });

      const context = createMockContext();
      const req = { query: { page: 1, perPage: 10, search: 'test' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(mockFind).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test', searchFields: ['title'] })
      );
    });

    it('returns 500 on error', async () => {
      mockFind.mockRejectedValue(new Error('OpenSearch unavailable'));

      const context = createMockContext();
      const req = { query: { page: 1, perPage: 20 } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.customError).toHaveBeenCalledWith({
        statusCode: 500,
        body: { message: 'OpenSearch unavailable' },
      });
    });
  });

  describe('POST /export', () => {
    let handler: Function;

    beforeEach(() => {
      const router = createMockRouter();
      registerExportRoute(router as unknown as Parameters<typeof registerExportRoute>[0], mockLogger as unknown as Parameters<typeof registerExportRoute>[1]);
      handler = router.routes[`POST ${API_BASE}/export`].handler;
    });

    it('exports objects as NDJSON string', async () => {
      const obj1 = { type: 'dashboard', id: 'd1', attributes: { title: 'Test' }, references: [] };
      const obj2 = { type: 'visualization', id: 'v1', attributes: { title: 'Viz' }, references: [] };
      const exportDetails = { exportedCount: 2, missingRefCount: 0, missingReferences: [] };

      mockExportStream.mockResolvedValue(Readable.from([obj1, obj2, exportDetails]));

      const context = createMockContext();
      const req = { body: { objects: [{ type: 'dashboard', id: 'd1' }] } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(mockExportStream).toHaveBeenCalledWith(
        expect.objectContaining({
          objects: [{ type: 'dashboard', id: 'd1' }],
          includeReferencesDeep: true,
          exportSizeLimit: 10000,
          excludeExportDetails: false,
        })
      );
      expect(res.ok).toHaveBeenCalled();
      const body = res.ok.mock.calls[0][0].body;
      const lines = body.ndjson.split('\n');
      expect(lines.length).toBe(3);
      lines.forEach((line: string) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('returns empty NDJSON for empty objects array', async () => {
      const context = createMockContext();
      const req = { body: { objects: [] } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(mockExportStream).not.toHaveBeenCalled();
      expect(res.ok).toHaveBeenCalledWith({ body: { ndjson: '' } });
    });

    it('returns error status from Boom errors', async () => {
      const boomError = new Error('Not found') as Error & { isBoom: boolean; output: { statusCode: number } };
      boomError.isBoom = true;
      boomError.output = { statusCode: 400 };
      mockExportStream.mockRejectedValue(boomError);

      const context = createMockContext();
      const req = { body: { objects: [{ type: 'dashboard', id: 'missing' }] } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.customError).toHaveBeenCalledWith({
        statusCode: 400,
        body: { message: 'Not found' },
      });
    });
  });

  describe('POST /inspect', () => {
    let handler: Function;

    beforeEach(() => {
      const router = createMockRouter();
      registerInspectRoute(router as unknown as Parameters<typeof registerInspectRoute>[0], mockLogger as unknown as Parameters<typeof registerInspectRoute>[1]);
      handler = router.routes[`POST ${API_BASE}/inspect`].handler;
    });

    it('returns inspection report for valid NDJSON', async () => {
      const obj1 = { type: 'dashboard', id: 'd1', attributes: { title: 'Test' }, references: [] };
      const obj2 = { type: 'visualization', id: 'v1', attributes: {}, references: [{ type: 'index-pattern', id: 'ip1', name: 'idx' }] };
      const ndjson = [JSON.stringify(obj1), JSON.stringify(obj2)].join('\n');

      const context = createMockContext();
      const req = { body: { ndjson } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalled();
      const report = res.ok.mock.calls[0][0].body;
      expect(report.summary.totalObjects).toBe(2);
      expect(report.summary.errors).toBeGreaterThanOrEqual(1);
      expect(report.issues.some((i: { type: string }) => i.type === 'MISSING_REFERENCE')).toBe(true);
    });

    it('accepts optional platform parameters', async () => {
      const obj = { type: 'dashboard', id: 'd1', attributes: {}, references: [] };
      const ndjson = JSON.stringify(obj);

      const context = createMockContext();
      const req = { body: { ndjson, sourcePlatform: 'aos', targetPlatform: 'opensearch-ui' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalled();
      const report = res.ok.mock.calls[0][0].body;
      expect(report.targetPlatform).toBe('opensearch-ui');
    });

    it('returns empty report for empty NDJSON', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: '' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalledWith({
        body: {
          summary: { totalObjects: 0, errors: 0, warnings: 0, info: 0 },
          objectsByType: {},
          issues: [],
        },
      });
    });

    it('returns empty report for whitespace-only NDJSON', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: '   \n  \n  ' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalled();
      const report = res.ok.mock.calls[0][0].body;
      expect(report.summary.totalObjects).toBe(0);
    });

    it('returns 400 for malformed NDJSON', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: 'not valid json' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.badRequest).toHaveBeenCalled();
      const body = res.badRequest.mock.calls[0][0].body;
      expect(body.message).toContain('Malformed NDJSON');
    });

    it('returns 400 for partially malformed NDJSON', async () => {
      const valid = JSON.stringify({ type: 'dashboard', id: 'd1', attributes: {}, references: [] });
      const ndjson = `${valid}\nnot json`;

      const context = createMockContext();
      const req = { body: { ndjson } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.badRequest).toHaveBeenCalled();
    });
  });

  describe('POST /repair', () => {
    let handler: Function;

    beforeEach(() => {
      const router = createMockRouter();
      registerRepairRoute(router as unknown as Parameters<typeof registerRepairRoute>[0], mockLogger as unknown as Parameters<typeof registerRepairRoute>[1]);
      handler = router.routes[`POST ${API_BASE}/repair`].handler;
    });

    it('applies repair pipeline and returns result', async () => {
      const obj = {
        type: 'dashboard',
        id: 'd1',
        attributes: {
          title: 'Test',
          kibanaSavedObjectMeta: {
            searchSourceJSON: JSON.stringify({ query: { dataset: { id: 'x' }, language: 'kuery' } }),
          },
        },
        references: [],
      };
      const ndjson = JSON.stringify(obj);

      const context = createMockContext();
      const req = {
        body: {
          ndjson,
          config: { ...allDisabledConfig, stripDashboardDatasets: true },
        },
      };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalled();
      const result = res.ok.mock.calls[0][0].body;
      expect(result.changes).toContain('Stripped dataset blocks from dashboard objects');
      const repaired = JSON.parse(result.ndjson.trim());
      const ssj = JSON.parse(repaired.attributes.kibanaSavedObjectMeta.searchSourceJSON);
      expect(ssj.query.dataset).toBeUndefined();
    });

    it('returns empty changes when nothing to repair', async () => {
      const obj = { type: 'visualization', id: 'v1', attributes: { title: 'Viz' }, references: [] };
      const ndjson = JSON.stringify(obj);

      const context = createMockContext();
      const req = { body: { ndjson, config: allDisabledConfig } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalled();
      const result = res.ok.mock.calls[0][0].body;
      expect(result.changes).toEqual([]);
    });

    it('returns no-op result for empty NDJSON', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: '', config: allDisabledConfig } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.ok).toHaveBeenCalledWith({ body: { ndjson: '', changes: [] } });
    });

    it('returns 400 for malformed NDJSON', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: '{bad json', config: allDisabledConfig } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.badRequest).toHaveBeenCalled();
      const body = res.badRequest.mock.calls[0][0].body;
      expect(body.message).toContain('Malformed NDJSON');
    });
  });

  describe('POST /import', () => {
    let handler: Function;

    beforeEach(() => {
      const router = createMockRouter();
      registerImportRoute(router as unknown as Parameters<typeof registerImportRoute>[0], mockLogger as unknown as Parameters<typeof registerImportRoute>[1]);
      handler = router.routes[`POST ${API_BASE}/import`].handler;
    });

    it('calls importSavedObjectsFromStream with correct params', async () => {
      const obj = { type: 'dashboard', id: 'd1', attributes: { title: 'Test' }, references: [] };
      const ndjson = JSON.stringify(obj);

      const context = createMockContext();
      const req = { body: { ndjson, overwrite: true, createNewCopies: false } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(importSavedObjectsFromStream).toHaveBeenCalledWith(
        expect.objectContaining({
          objectLimit: 10000,
          overwrite: true,
          createNewCopies: false,
          savedObjectsClient: mockSavedObjectsClient,
          typeRegistry: mockTypeRegistry,
        })
      );
      expect(res.ok).toHaveBeenCalledWith({
        body: { success: true, successCount: 2 },
      });
    });

    it('resolves data source title when dataSourceId is provided', async () => {
      mockGet.mockResolvedValue({
        id: 'ds-1',
        type: 'data-source',
        attributes: { title: 'My DataSource' },
      });

      const obj = { type: 'dashboard', id: 'd1', attributes: {}, references: [] };
      const ndjson = JSON.stringify(obj);

      const context = createMockContext();
      const req = { body: { ndjson, overwrite: false, createNewCopies: false, dataSourceId: 'ds-1' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(mockGet).toHaveBeenCalledWith('data-source', 'ds-1');
      expect(importSavedObjectsFromStream).toHaveBeenCalledWith(
        expect.objectContaining({
          dataSourceId: 'ds-1',
          dataSourceTitle: 'My DataSource',
          dataSourceEnabled: true,
        })
      );
    });

    it('passes workspace when workspaceId is provided', async () => {
      const obj = { type: 'dashboard', id: 'd1', attributes: {}, references: [] };
      const ndjson = JSON.stringify(obj);

      const context = createMockContext();
      const req = { body: { ndjson, overwrite: false, createNewCopies: false, workspaceId: 'ws-1' } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(importSavedObjectsFromStream).toHaveBeenCalledWith(
        expect.objectContaining({ workspaces: ['ws-1'] })
      );
    });

    it('returns success for empty NDJSON without calling import', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: '', overwrite: false, createNewCopies: false } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(importSavedObjectsFromStream).not.toHaveBeenCalled();
      expect(res.ok).toHaveBeenCalledWith({
        body: { success: true, successCount: 0 },
      });
    });

    it('returns 400 for malformed NDJSON', async () => {
      const context = createMockContext();
      const req = { body: { ndjson: 'not json', overwrite: false, createNewCopies: false } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(importSavedObjectsFromStream).not.toHaveBeenCalled();
      expect(res.badRequest).toHaveBeenCalled();
      const body = res.badRequest.mock.calls[0][0].body;
      expect(body.message).toContain('Malformed NDJSON');
    });

    it('returns 500 on import failure', async () => {
      (importSavedObjectsFromStream as jest.Mock).mockRejectedValueOnce(new Error('import boom'));

      const obj = { type: 'dashboard', id: 'd1', attributes: {}, references: [] };
      const context = createMockContext();
      const req = { body: { ndjson: JSON.stringify(obj), overwrite: false, createNewCopies: false } };
      const res = createMockResponse();

      await handler(context, req, res);

      expect(res.customError).toHaveBeenCalledWith({
        statusCode: 500,
        body: { message: 'import boom' },
      });
    });

    it('filters out export details line from NDJSON stream', async () => {
      const obj = { type: 'dashboard', id: 'd1', attributes: {}, references: [] };
      const exportDetails = { exportedCount: 1, missingRefCount: 0, missingReferences: [] };
      const ndjson = [JSON.stringify(obj), JSON.stringify(exportDetails)].join('\n');

      const context = createMockContext();
      const req = { body: { ndjson, overwrite: false, createNewCopies: false } };
      const res = createMockResponse();

      await handler(context, req, res);

      // Should succeed — the export details line is filtered out, only the dashboard is imported
      expect(importSavedObjectsFromStream).toHaveBeenCalled();
      expect(res.ok).toHaveBeenCalled();
    });
  });

  describe('body size limits', () => {
    it('inspect route has 100MB limit', () => {
      const router = createMockRouter();
      registerInspectRoute(router as unknown as Parameters<typeof registerInspectRoute>[0], mockLogger as unknown as Parameters<typeof registerInspectRoute>[1]);
      const config = router.post.mock.calls[0][0];
      expect(config.options.body.maxBytes).toBe(100 * 1024 * 1024);
    });

    it('repair route has 100MB limit', () => {
      const router = createMockRouter();
      registerRepairRoute(router as unknown as Parameters<typeof registerRepairRoute>[0], mockLogger as unknown as Parameters<typeof registerRepairRoute>[1]);
      const config = router.post.mock.calls[0][0];
      expect(config.options.body.maxBytes).toBe(100 * 1024 * 1024);
    });

    it('import route has 100MB limit', () => {
      const router = createMockRouter();
      registerImportRoute(router as unknown as Parameters<typeof registerImportRoute>[0], mockLogger as unknown as Parameters<typeof registerImportRoute>[1]);
      const config = router.post.mock.calls[0][0];
      expect(config.options.body.maxBytes).toBe(100 * 1024 * 1024);
    });
  });
});
