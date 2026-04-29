import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { inspect, UI_RENDERABLE_TYPES, InspectionContext } from '../inspector.js';
import { SavedObject, PlatformType } from '../types.js';

// Helpers
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

describe('inspect - Property 2: Type renderability check correctness', () => {
  it('should warn for every non-renderable type and not for renderable types', () => {
    fc.assert(fc.property(fc.array(savedObjectArb, { minLength: 0, maxLength: 20 }), (objects) => {
      const report = inspect(objects, { targetPlatform: 'opensearch-ui' });
      const nonRenderableIssues = report.issues.filter((i) => i.type === 'NON_RENDERABLE_TYPE');

      const expectedCount = objects.filter((o) => !UI_RENDERABLE_TYPES.has(o.type)).length;
      expect(nonRenderableIssues.length).toBe(expectedCount);

      // No NON_RENDERABLE_TYPE issue should have severity ERROR
      for (const issue of nonRenderableIssues) {
        expect(issue.severity).toBe('WARNING');
      }
    }), { numRuns: 100 });
  });

  it('should populate nonRenderableTypeSummary correctly', () => {
    fc.assert(fc.property(fc.array(savedObjectArb, { minLength: 1, maxLength: 20 }), (objects) => {
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
    }), { numRuns: 100 });
  });

  it('should respect customRenderableTypes override', () => {
    const objects = [makeSavedObject('query'), makeSavedObject('dashboard')];
    const customTypes = new Set(['dashboard', 'query']);
    const report = inspect(objects, { targetPlatform: 'opensearch-ui', customRenderableTypes: customTypes });
    const nonRenderableIssues = report.issues.filter((i) => i.type === 'NON_RENDERABLE_TYPE');
    expect(nonRenderableIssues.length).toBe(0);
  });
});

describe('inspect - Property 3: Permissions warning conditional emission', () => {
  it('should emit MISSING_PERMISSIONS when source is aos or aoss AND target is opensearch-ui', () => {
    fc.assert(fc.property(
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
    ), { numRuns: 100 });
  });
});

describe('inspect - Property 4: Backward-compatible inspection', () => {
  it('should produce no target-specific fields or issues when called without context', () => {
    fc.assert(fc.property(fc.array(savedObjectArb, { minLength: 0, maxLength: 10 }), (objects) => {
      const report = inspect(objects);
      expect(report.targetPlatform).toBeNull();
      expect(report.nonRenderableTypeSummary).toBeNull();
      const targetIssues = report.issues.filter(
        (i) => i.type === 'NON_RENDERABLE_TYPE' || i.type === 'MISSING_PERMISSIONS'
      );
      expect(targetIssues.length).toBe(0);
    }), { numRuns: 100 });
  });
});

describe('inspect - Property 5: Issue phase categorization', () => {
  it('should assign correct phase to every issue', () => {
    fc.assert(fc.property(
      fc.array(savedObjectArb, { minLength: 0, maxLength: 10 }),
      fc.option(fc.record({
        sourcePlatform: platformArb,
        targetPlatform: platformArb,
      })),
      (objects, ctxOpt) => {
        const context = ctxOpt ?? undefined;
        const report = inspect(objects, context);
        for (const issue of report.issues) {
          expect(issue.phase).toBeDefined();
          expect(['PRE_EXPORT', 'TRANSFORM', 'PRE_IMPORT']).toContain(issue.phase);

          if (['MISSING_REFERENCE', 'DUPLICATE_ID', 'OBJECT_COUNT'].includes(issue.type)) {
            expect(issue.phase).toBe('PRE_EXPORT');
          }
          if (['NON_RENDERABLE_TYPE', 'MISSING_PERMISSIONS', 'AOSS_COLLECTION_SEMANTICS'].includes(issue.type)) {
            expect(issue.phase).toBe('PRE_IMPORT');
          }
        }
      }
    ), { numRuns: 100 });
  });
});

describe('inspect - unit tests', () => {
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

  it('should set targetPlatform on report from context', () => {
    const report = inspect([], { targetPlatform: 'aoss' });
    expect(report.targetPlatform).toBe('aoss');
  });
});

describe('inspect - AOSS→UI migration', () => {
  it('should emit MISSING_PERMISSIONS with AOSS label for aoss→opensearch-ui', () => {
    const report = inspect([makeSavedObject('dashboard')], {
      sourcePlatform: 'aoss',
      targetPlatform: 'opensearch-ui',
    });
    const permIssue = report.issues.find((i) => i.type === 'MISSING_PERMISSIONS');
    expect(permIssue).toBeDefined();
    expect(permIssue!.message).toContain('AOSS');
    expect(permIssue!.message).toContain('read');
    expect(permIssue!.message).toContain('write');
    expect(permIssue!.message).toContain('library_read');
    expect(permIssue!.message).toContain('library_write');
  });

  it('should emit AOS label (not AOSS) for aos→opensearch-ui', () => {
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
    expect(collectionIssue!.message).toContain('collection-level access control');
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
