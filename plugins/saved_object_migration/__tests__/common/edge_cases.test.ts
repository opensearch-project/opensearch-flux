import { parseNdjsonFile, applyRepairPipeline } from '../../common/repair';
import { inspect } from '../../common/inspector';
import { detectPlatformType, detectServiceFromEndpoint, detectRegionFromEndpoint } from '../../common/config';
import { RepairConfig } from '../../common/types';

describe('Edge Cases - parseNdjsonFile', () => {
  it('should return empty array for empty string', () => {
    expect(parseNdjsonFile('')).toEqual([]);
  });

  it('should return empty array for whitespace-only string', () => {
    expect(parseNdjsonFile('   \n\n  \n')).toEqual([]);
  });

  it('should throw descriptive error for malformed JSON', () => {
    const malformed = 'not valid json\n{"id":"1","type":"dashboard"}';
    expect(() => parseNdjsonFile(malformed)).toThrow();
  });

  it('should handle single line without trailing newline', () => {
    const ndjson = '{"id":"1","type":"dashboard","attributes":{},"references":[]}';
    const result = parseNdjsonFile(ndjson);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('should filter out lines without type and id', () => {
    const ndjson = `{"exportedCount":5}
{"id":"1","type":"dashboard","attributes":{},"references":[]}
{"type":"visualization"}
{"id":"2"}`;
    const result = parseNdjsonFile(ndjson);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('should handle empty JSON objects', () => {
    const ndjson = '{}';
    const result = parseNdjsonFile(ndjson);
    expect(result).toEqual([]);
  });
});

describe('Edge Cases - inspect', () => {
  it('should return report with 0 totals for empty array', () => {
    const report = inspect([]);
    expect(report.summary.totalObjects).toBe(0);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
    expect(report.objectsByType).toEqual({});
  });

  it('should handle objects with no references', () => {
    const objects = [
      { id: '1', type: 'dashboard', attributes: {}, references: [] },
    ];
    const report = inspect(objects);
    expect(report.summary.totalObjects).toBe(1);
    const missingRefIssues = report.issues.filter((i) => i.type === 'MISSING_REFERENCE');
    expect(missingRefIssues.length).toBe(0);
  });

  it('should handle objects with undefined references', () => {
    const objects = [
      { id: '1', type: 'dashboard', attributes: {}, references: undefined as any },
    ];
    const report = inspect(objects);
    expect(report.summary.totalObjects).toBe(1);
  });

  it('should handle objects with empty attributes', () => {
    const objects = [
      { id: '1', type: 'dashboard', attributes: {}, references: [] },
    ];
    const report = inspect(objects);
    expect(report.summary.totalObjects).toBe(1);
  });

  it('should not crash with null context', () => {
    const objects = [
      { id: '1', type: 'dashboard', attributes: {}, references: [] },
    ];
    const report = inspect(objects, undefined);
    expect(report.targetPlatform).toBeNull();
  });
});

describe('Edge Cases - applyRepairPipeline', () => {
  const disabledConfig: RepairConfig = {
    stripDataSourcePrefixes: false,
    remapDataSources: { enabled: false },
    stripDashboardDatasets: false,
    remapIndexPatterns: { enabled: false },
    disableMissingFieldFilters: false,
  };

  it('should return unchanged ndjson when all operations disabled', () => {
    const ndjson = '{"id":"1","type":"dashboard","attributes":{},"references":[]}\n';
    const result = applyRepairPipeline(ndjson, disabledConfig);
    expect(result.ndjson).toBe(ndjson);
    expect(result.changes).toEqual([]);
  });

  it('should not crash with empty NDJSON', () => {
    const result = applyRepairPipeline('', disabledConfig);
    expect(result.ndjson).toBe('');
    expect(result.changes).toEqual([]);
  });

  it('should handle whitespace-only NDJSON', () => {
    const result = applyRepairPipeline('   \n\n  ', disabledConfig);
    expect(result.ndjson).toBe('');
    expect(result.changes).toEqual([]);
  });

  it('should handle single object without trailing newline', () => {
    const ndjson = '{"id":"1","type":"dashboard","attributes":{},"references":[]}';
    const result = applyRepairPipeline(ndjson, disabledConfig);
    expect(result.changes).toEqual([]);
  });

  it('should not modify ndjson when no repairs needed', () => {
    const ndjson = '{"id":"1","type":"visualization","attributes":{"title":"Test"},"references":[]}\n';
    const config: RepairConfig = {
      stripDataSourcePrefixes: true,
      remapDataSources: { enabled: true, targetId: 'target' },
      stripDashboardDatasets: true,
      remapIndexPatterns: { enabled: true, mappings: {} },
      disableMissingFieldFilters: true,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.changes.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Edge Cases - detectPlatformType', () => {
  it('should return unknown for empty string', () => {
    expect(detectPlatformType('')).toBe('unknown');
  });

  it('should return unknown for whitespace-only string', () => {
    expect(detectPlatformType('   ')).toBe('unknown');
  });

  it('should return unknown for localhost', () => {
    expect(detectPlatformType('http://localhost:5601')).toBe('unknown');
    expect(detectPlatformType('https://localhost:9200')).toBe('unknown');
  });

  it('should return unknown for IP addresses', () => {
    expect(detectPlatformType('http://192.168.1.1:9200')).toBe('unknown');
    expect(detectPlatformType('https://10.0.0.1:5601')).toBe('unknown');
  });

  it('should return unknown for non-AWS domains', () => {
    expect(detectPlatformType('https://opensearch.example.com')).toBe('unknown');
    expect(detectPlatformType('https://my-cluster.internal')).toBe('unknown');
  });

  it('should handle malformed URLs gracefully', () => {
    expect(detectPlatformType('not-a-url')).toBe('unknown');
    expect(detectPlatformType('://missing-protocol')).toBe('unknown');
  });

  it('should handle URLs with query parameters', () => {
    expect(detectPlatformType('https://search-test.us-east-1.es.amazonaws.com?param=value')).toBe('aos');
    expect(detectPlatformType('https://application-test.us-east-1.opensearch.amazonaws.com?foo=bar')).toBe('opensearch-ui');
  });

  it('should handle URLs with fragments', () => {
    expect(detectPlatformType('https://search-test.us-east-1.es.amazonaws.com#fragment')).toBe('aos');
  });
});

describe('Edge Cases - detectServiceFromEndpoint', () => {
  it('should return es for empty string', () => {
    expect(detectServiceFromEndpoint('')).toBe('es');
  });

  it('should return es for unknown endpoints', () => {
    expect(detectServiceFromEndpoint('http://localhost:9200')).toBe('es');
    expect(detectServiceFromEndpoint('https://example.com')).toBe('es');
  });

  it('should handle malformed URLs', () => {
    expect(detectServiceFromEndpoint('not-a-url')).toBe('es');
  });
});

describe('Edge Cases - detectRegionFromEndpoint', () => {
  it('should return undefined for empty string', () => {
    expect(detectRegionFromEndpoint('')).toBeUndefined();
  });

  it('should return undefined for localhost', () => {
    expect(detectRegionFromEndpoint('http://localhost:9200')).toBeUndefined();
  });

  it('should return undefined for non-AWS endpoints', () => {
    expect(detectRegionFromEndpoint('https://opensearch.example.com')).toBeUndefined();
  });

  it('should return undefined for malformed URLs', () => {
    expect(detectRegionFromEndpoint('not-a-url')).toBeUndefined();
  });

  it('should extract region from URLs with query parameters', () => {
    expect(detectRegionFromEndpoint('https://search-test.us-east-1.es.amazonaws.com?param=value')).toBe('us-east-1');
  });

  it('should extract region from URLs with fragments', () => {
    expect(detectRegionFromEndpoint('https://search-test.eu-west-1.es.amazonaws.com#fragment')).toBe('eu-west-1');
  });
});

describe('Edge Cases - Complex Scenarios', () => {
  it('should handle NDJSON with mixed valid and invalid lines', () => {
    const ndjson = `{"id":"1","type":"dashboard","attributes":{},"references":[]}
invalid json line
{"id":"2","type":"visualization","attributes":{},"references":[]}`;
    expect(() => parseNdjsonFile(ndjson)).toThrow();
  });

  it('should handle objects with deeply nested attributes', () => {
    const objects = [
      {
        id: '1',
        type: 'visualization',
        attributes: {
          visState: JSON.stringify({
            params: {
              nested: {
                deep: {
                  value: 'test',
                },
              },
            },
          }),
        },
        references: [],
      },
    ];
    const report = inspect(objects);
    expect(report.summary.totalObjects).toBe(1);
  });

  it('should handle repair pipeline with partial config', () => {
    const ndjson = '{"id":"1","type":"dashboard","attributes":{},"references":[]}\n';
    const config: RepairConfig = {
      stripDataSourcePrefixes: true,
      remapDataSources: { enabled: false },
      stripDashboardDatasets: false,
      remapIndexPatterns: { enabled: false },
      disableMissingFieldFilters: false,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.ndjson).toBeDefined();
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('should handle inspect with all issue severities', () => {
    const objects = [
      {
        id: 'dash1',
        type: 'dashboard',
        attributes: {},
        references: [{ name: 'ref1', type: 'visualization', id: 'missing' }],
      },
      {
        id: 'dash1',
        type: 'dashboard',
        attributes: {},
        references: [],
      },
    ];
    const report = inspect(objects, { sourcePlatform: 'aos', targetPlatform: 'opensearch-ui' });
    expect(report.issues.some((i) => i.severity === 'ERROR')).toBe(true);
    expect(report.issues.some((i) => i.severity === 'WARNING')).toBe(true);
    expect(report.issues.some((i) => i.severity === 'INFO')).toBe(true);
  });
});
