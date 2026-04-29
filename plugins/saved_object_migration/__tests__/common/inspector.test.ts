import * as fc from 'fast-check';
import { inspect, UI_RENDERABLE_TYPES } from '../../common/inspector';
import { SavedObject, PlatformType } from '../../common/types';

const RENDERABLE = [...UI_RENDERABLE_TYPES];
const NON_RENDERABLE = ['query', 'observability-notebook', 'observability-panel', 'visualization-visbuilder', 'custom-type'];
const ALL_TYPES = [...RENDERABLE, ...NON_RENDERABLE];
const PLATFORMS: PlatformType[] = ['aos', 'opensearch-ui', 'aoss', 'unknown'];

function makeSavedObject(type: string, id?: string): SavedObject {
  return {
    id: id ?? `id-${Math.random().toString(36).slice(2)}`,
    type,
    attributes: { title: `Test ${type}` },
    references: [],
  };
}

const savedObjectArb = fc.constantFrom(...ALL_TYPES).map((type) => makeSavedObject(type));
const platformArb = fc.constantFrom(...PLATFORMS);

describe('UI_RENDERABLE_TYPES', () => {
  it('should contain expected types', () => {
    expect(UI_RENDERABLE_TYPES.has('dashboard')).toBe(true);
    expect(UI_RENDERABLE_TYPES.has('visualization')).toBe(true);
    expect(UI_RENDERABLE_TYPES.has('index-pattern')).toBe(true);
    expect(UI_RENDERABLE_TYPES.has('search')).toBe(true);
    expect(UI_RENDERABLE_TYPES.has('config')).toBe(true);
    expect(UI_RENDERABLE_TYPES.has('data-source')).toBe(true);
  });
});

describe('inspect - basic structure', () => {
  it('should return report with correct structure', () => {
    const report = inspect([]);
    expect(report.summary).toBeDefined();
    expect(report.objectsByType).toBeDefined();
    expect(report.issues).toBeDefined();
    expect(Array.isArray(report.issues)).toBe(true);
  });

  it('should count objects correctly', () => {
    const objects = [makeSavedObject('dashboard'), makeSavedObject('visualization')];
    const report = inspect(objects);
    expect(report.summary.totalObjects).toBe(2);
  });

  it('should build objectsByType correctly', () => {
    const objects = [
      makeSavedObject('dashboard'),
      makeSavedObject('dashboard'),
      makeSavedObject('visualization'),
    ];
    const report = inspect(objects);
    expect(report.objectsByType.dashboard).toBe(2);
    expect(report.objectsByType.visualization).toBe(1);
  });
});

describe('inspect - missing references', () => {
  it('should detect missing references', () => {
    const objects: SavedObject[] = [
      {
        id: 'dash1',
        type: 'dashboard',
        attributes: {},
        references: [{ name: 'ref1', type: 'visualization', id: 'vis1' }],
      },
    ];
    const report = inspect(objects);
    const missingRefIssues = report.issues.filter((i) => i.type === 'MISSING_REFERENCE');
    expect(missingRefIssues.length).toBe(1);
    expect(missingRefIssues[0].severity).toBe('ERROR');
    expect(missingRefIssues[0].objectId).toBe('dash1');
  });

  it('should not report error when reference exists', () => {
    const objects: SavedObject[] = [
      {
        id: 'dash1',
        type: 'dashboard',
        attributes: {},
        references: [{ name: 'ref1', type: 'visualization', id: 'vis1' }],
      },
      { id: 'vis1', type: 'visualization', attributes: {}, references: [] },
    ];
    const report = inspect(objects);
    const missingRefIssues = report.issues.filter((i) => i.type === 'MISSING_REFERENCE');
    expect(missingRefIssues.length).toBe(0);
  });
});

describe('inspect - duplicate IDs', () => {
  it('should detect duplicate IDs', () => {
    const objects: SavedObject[] = [
      makeSavedObject('dashboard', 'dup1'),
      makeSavedObject('dashboard', 'dup1'),
    ];
    const report = inspect(objects);
    const dupIssues = report.issues.filter((i) => i.type === 'DUPLICATE_ID');
    expect(dupIssues.length).toBe(1);
    expect(dupIssues[0].severity).toBe('ERROR');
  });
});

describe('inspect - type renderability check', () => {
  it('should warn for every non-renderable type and not for renderable types', () => {
    fc.assert(
      fc.property(fc.array(savedObjectArb, { minLength: 0, maxLength: 20 }), (objects) => {
        const report = inspect(objects, { targetPlatform: 'opensearch-ui' });
        const nonRenderableIssues = report.issues.filter((i) => i.type === 'NON_RENDERABLE_TYPE');

        const expectedCount = objects.filter((o) => !UI_RENDERABLE_TYPES.has(o.type)).length;
        expect(nonRenderableIssues.length).toBe(expectedCount);

        for (const issue of nonRenderableIssues) {
          expect(issue.severity).toBe('WARNING');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should populate nonRenderableTypeSummary correctly', () => {
    fc.assert(
      fc.property(fc.array(savedObjectArb, { minLength: 1, maxLength: 20 }), (objects) => {
        const report = inspect(objects, { targetPlatform: 'opensearch-ui' });
        const expectedCounts: Record<string, number> = {};
        for (const obj of objects) {
          if (!UI_RENDERABLE_TYPES.has(obj.type)) {
            expectedCounts[obj.type] = (expectedCounts[obj.type] ?? 0) + 1;
          }
        }
        if (Object.keys(expectedCounts).length === 0) {
          expect(report.nonRenderableTypeSummary).toBeNull();
        } else {
          expect(report.nonRenderableTypeSummary).toEqual(expectedCounts);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should respect customRenderableTypes override', () => {
    const objects = [makeSavedObject('query'), makeSavedObject('dashboard')];
    const customTypes = new Set(['dashboard', 'query']);
    const report = inspect(objects, { targetPlatform: 'opensearch-ui', customRenderableTypes: customTypes });
    const nonRenderableIssues = report.issues.filter((i) => i.type === 'NON_RENDERABLE_TYPE');
    expect(nonRenderableIssues.length).toBe(0);
  });
});

describe('inspect - permissions warning', () => {
  it('should emit MISSING_PERMISSIONS when source is aos or aoss AND target is opensearch-ui', () => {
    fc.assert(
      fc.property(
        fc.array(savedObjectArb, { minLength: 0, maxLength: 5 }),
        platformArb,
        platformArb,
        (objects, source, target) => {
          const report = inspect(objects, { sourcePlatform: source, targetPlatform: target });
          const permIssues = report.issues.filter((i) => i.type === 'MISSING_PERMISSIONS');
          if ((source === 'aos' || source === 'aoss') && target === 'opensearch-ui') {
            expect(permIssues.length).toBe(1);
          } else {
            expect(permIssues.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include all four permission types in the warning message', () => {
    const report = inspect([makeSavedObject('dashboard')], {
      sourcePlatform: 'aos',
      targetPlatform: 'opensearch-ui',
    });
    const permIssue = report.issues.find((i) => i.type === 'MISSING_PERMISSIONS');
    expect(permIssue).toBeDefined();
    expect(permIssue!.message).toContain('read');
    expect(permIssue!.message).toContain('write');
    expect(permIssue!.message).toContain('library_read');
    expect(permIssue!.message).toContain('library_write');
  });
});

describe('inspect - backward compatibility', () => {
  it('should produce no target-specific fields or issues when called without context', () => {
    fc.assert(
      fc.property(fc.array(savedObjectArb, { minLength: 0, maxLength: 10 }), (objects) => {
        const report = inspect(objects);
        expect(report.targetPlatform).toBeNull();
        expect(report.nonRenderableTypeSummary).toBeNull();
        const targetIssues = report.issues.filter(
          (i) => i.type === 'NON_RENDERABLE_TYPE' || i.type === 'MISSING_PERMISSIONS'
        );
        expect(targetIssues.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe('inspect - issue phase categorization', () => {
  it('should assign correct phase to every issue', () => {
    fc.assert(
      fc.property(
        fc.array(savedObjectArb, { minLength: 0, maxLength: 10 }),
        fc.option(
          fc.record({
            sourcePlatform: platformArb,
            targetPlatform: platformArb,
          })
        ),
        (objects, ctxOpt) => {
          const context = ctxOpt ?? undefined;
          const report = inspect(objects, context);
          for (const issue of report.issues) {
            expect(issue.phase).toBeDefined();
            expect(['PRE_EXPORT', 'TRANSFORM', 'PRE_IMPORT']).toContain(issue.phase);

            if (['MISSING_REFERENCE', 'DUPLICATE_ID', 'OBJECT_COUNT', 'EMBEDDED_INDEX_REFERENCE'].includes(issue.type)) {
              expect(issue.phase).toBe('PRE_EXPORT');
            }
            if (['NON_RENDERABLE_TYPE', 'MISSING_PERMISSIONS', 'AOSS_COLLECTION_SEMANTICS'].includes(issue.type)) {
              expect(issue.phase).toBe('PRE_IMPORT');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('inspect - AOSS migration', () => {
  it('should emit MISSING_PERMISSIONS with AOSS label for aoss→opensearch-ui', () => {
    const report = inspect([makeSavedObject('dashboard')], {
      sourcePlatform: 'aoss',
      targetPlatform: 'opensearch-ui',
    });
    const permIssue = report.issues.find((i) => i.type === 'MISSING_PERMISSIONS');
    expect(permIssue).toBeDefined();
    expect(permIssue!.message).toContain('AOSS');
  });

  it('should emit AOS label for aos→opensearch-ui', () => {
    const report = inspect([makeSavedObject('dashboard')], {
      sourcePlatform: 'aos',
      targetPlatform: 'opensearch-ui',
    });
    const permIssue = report.issues.find((i) => i.type === 'MISSING_PERMISSIONS');
    expect(permIssue).toBeDefined();
    expect(permIssue!.message).toContain('AOS');
    expect(permIssue!.message).not.toContain('AOSS');
  });

  it('should emit AOSS_COLLECTION_SEMANTICS for aoss→opensearch-ui', () => {
    const report = inspect([makeSavedObject('dashboard')], {
      sourcePlatform: 'aoss',
      targetPlatform: 'opensearch-ui',
    });
    const collectionIssue = report.issues.find((i) => i.type === 'AOSS_COLLECTION_SEMANTICS');
    expect(collectionIssue).toBeDefined();
    expect(collectionIssue!.severity).toBe('INFO');
  });

  it('should NOT emit AOSS_COLLECTION_SEMANTICS for aos→opensearch-ui', () => {
    const report = inspect([makeSavedObject('dashboard')], {
      sourcePlatform: 'aos',
      targetPlatform: 'opensearch-ui',
    });
    const collectionIssue = report.issues.find((i) => i.type === 'AOSS_COLLECTION_SEMANTICS');
    expect(collectionIssue).toBeUndefined();
  });
});

describe('inspect - embedded index-pattern references', () => {
  it('should warn when searchSourceJSON.index references a missing index-pattern', () => {
    const vis: SavedObject = {
      id: 'vis1',
      type: 'visualization',
      attributes: {
        title: 'My Vis',
        kibanaSavedObjectMeta: {
          searchSourceJSON: JSON.stringify({ index: 'ip-missing', query: { language: 'kuery', query: '' } }),
        },
      },
      references: [],
    };
    const report = inspect([vis]);
    const embedded = report.issues.filter((i) => i.type === 'EMBEDDED_INDEX_REFERENCE');
    expect(embedded.length).toBe(1);
    expect(embedded[0].severity).toBe('WARNING');
    expect(embedded[0].message).toContain('ip-missing');
    expect(embedded[0].phase).toBe('PRE_EXPORT');
  });

  it('should emit INFO when inline-referenced index-pattern IS in the export', () => {
    const vis: SavedObject = {
      id: 'vis1',
      type: 'visualization',
      attributes: {
        title: 'My Vis',
        kibanaSavedObjectMeta: {
          searchSourceJSON: JSON.stringify({ index: 'ip-present' }),
        },
      },
      references: [],
    };
    const ip: SavedObject = {
      id: 'ip-present',
      type: 'index-pattern',
      attributes: { title: 'logs-*' },
      references: [],
    };
    const report = inspect([vis, ip]);
    const embedded = report.issues.filter((i) => i.type === 'EMBEDDED_INDEX_REFERENCE');
    expect(embedded.length).toBe(1);
    expect(embedded[0].severity).toBe('INFO');
  });

  it('should skip when the same ID is already in the formal references array', () => {
    const vis: SavedObject = {
      id: 'vis1',
      type: 'visualization',
      attributes: {
        title: 'My Vis',
        kibanaSavedObjectMeta: {
          searchSourceJSON: JSON.stringify({ index: 'ip1' }),
        },
      },
      references: [{ name: 'indexpattern-datasource', type: 'index-pattern', id: 'ip1' }],
    };
    const ip: SavedObject = {
      id: 'ip1',
      type: 'index-pattern',
      attributes: { title: 'logs-*' },
      references: [],
    };
    const report = inspect([vis, ip]);
    const embedded = report.issues.filter((i) => i.type === 'EMBEDDED_INDEX_REFERENCE');
    expect(embedded.length).toBe(0);
  });

  it('should detect TSVB params.index_pattern', () => {
    const vis: SavedObject = {
      id: 'tsvb1',
      type: 'visualization',
      attributes: {
        title: 'TSVB Vis',
        visState: JSON.stringify({
          type: 'metrics',
          params: { index_pattern: 'tsvb-pattern-id' },
        }),
      },
      references: [],
    };
    const report = inspect([vis]);
    const embedded = report.issues.filter((i) => i.type === 'EMBEDDED_INDEX_REFERENCE');
    expect(embedded.length).toBe(1);
    expect(embedded[0].message).toContain('tsvb-pattern-id');
  });

  it('should detect TSVB per-series index_pattern overrides', () => {
    const vis: SavedObject = {
      id: 'tsvb2',
      type: 'visualization',
      attributes: {
        title: 'TSVB Series Override',
        visState: JSON.stringify({
          type: 'metrics',
          params: {
            index_pattern: 'main-pattern',
            series: [
              { override_index_pattern: true, series_index_pattern: 'override-pattern' },
              { override_index_pattern: false, series_index_pattern: 'ignored-pattern' },
            ],
          },
        }),
      },
      references: [],
    };
    const report = inspect([vis]);
    const embedded = report.issues.filter((i) => i.type === 'EMBEDDED_INDEX_REFERENCE');
    // Should find main-pattern and override-pattern (not ignored-pattern)
    expect(embedded.length).toBe(2);
    const messages = embedded.map((i) => i.message).join(' ');
    expect(messages).toContain('main-pattern');
    expect(messages).toContain('override-pattern');
    expect(messages).not.toContain('ignored-pattern');
  });

  it('should not crash on malformed searchSourceJSON', () => {
    const vis: SavedObject = {
      id: 'bad1',
      type: 'visualization',
      attributes: {
        title: 'Bad JSON',
        kibanaSavedObjectMeta: { searchSourceJSON: '{not valid json' },
      },
      references: [],
    };
    expect(() => inspect([vis])).not.toThrow();
  });

  it('should not crash on malformed visState', () => {
    const vis: SavedObject = {
      id: 'bad2',
      type: 'visualization',
      attributes: {
        title: 'Bad visState',
        visState: 'not json at all',
      },
      references: [],
    };
    expect(() => inspect([vis])).not.toThrow();
  });
});

describe('inspect - targetPlatform on report', () => {
  it('should set targetPlatform on report from context', () => {
    const report = inspect([], { targetPlatform: 'aoss' });
    expect(report.targetPlatform).toBe('aoss');
  });

  it('should set targetPlatform to null when no context', () => {
    const report = inspect([]);
    expect(report.targetPlatform).toBeNull();
  });
});
