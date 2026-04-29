import {
  parseNdjsonFile,
  extractDataSourceIds,
  extractDataSourceDetails,
  stripDataSourcePrefixes,
  remapDataSources,
  stripDashboardDatasetBlocks,
  remapIndexPatterns,
  disableMissingFieldFilters,
  applyRepairPipeline,
} from '../../common/repair';

describe('parseNdjsonFile', () => {
  it('should parse valid NDJSON', () => {
    const ndjson = `{"id":"1","type":"dashboard","attributes":{},"references":[]}
{"id":"2","type":"visualization","attributes":{},"references":[]}`;
    const objects = parseNdjsonFile(ndjson);
    expect(objects.length).toBe(2);
    expect(objects[0].id).toBe('1');
    expect(objects[1].id).toBe('2');
  });

  it('should filter out metadata lines without type and id', () => {
    const ndjson = `{"exportedCount":2}
{"id":"1","type":"dashboard","attributes":{},"references":[]}`;
    const objects = parseNdjsonFile(ndjson);
    expect(objects.length).toBe(1);
    expect(objects[0].id).toBe('1');
  });

  it('should handle empty input', () => {
    expect(parseNdjsonFile('')).toEqual([]);
    expect(parseNdjsonFile('\n\n')).toEqual([]);
  });
});

describe('extractDataSourceIds', () => {
  it('should extract data source IDs from references', () => {
    const objects = [
      {
        references: [
          { type: 'data-source', id: 'ds1' },
          { type: 'index-pattern', id: 'ip1' },
        ],
      },
    ];
    const ids = extractDataSourceIds(objects);
    expect(ids.has('ds1')).toBe(true);
    expect(ids.has('ip1')).toBe(false);
  });

  it('should extract data source IDs from nested attributes', () => {
    const objects = [
      {
        attributes: {
          kibanaSavedObjectMeta: {
            searchSourceJSON: JSON.stringify({
              dataSource: { id: 'ds2' },
            }),
          },
        },
      },
    ];
    const ids = extractDataSourceIds(objects);
    expect(ids.has('ds2')).toBe(true);
  });

  it('should return empty set when no data sources', () => {
    const objects = [{ attributes: {}, references: [] }];
    const ids = extractDataSourceIds(objects);
    expect(ids.size).toBe(0);
  });
});

describe('extractDataSourceDetails', () => {
  it('should extract details from data-source objects', () => {
    const objects = [
      {
        type: 'data-source',
        id: 'ds1',
        attributes: { title: 'My Data Source', endpoint: 'https://example.com' },
      },
      { type: 'dashboard', id: 'dash1', attributes: {} },
    ];
    const details = extractDataSourceDetails(objects);
    expect(details.length).toBe(1);
    expect(details[0].id).toBe('ds1');
    expect(details[0].title).toBe('My Data Source');
    expect(details[0].endpoint).toBe('https://example.com');
  });

  it('should use fallback title when title is missing', () => {
    const objects = [
      {
        type: 'data-source',
        id: 'ds1',
        attributes: { dataSourceEngineType: 'OpenSearch' },
      },
    ];
    const details = extractDataSourceDetails(objects);
    expect(details[0].title).toBe('OpenSearch');
  });
});

describe('stripDataSourcePrefixes', () => {
  it('should strip data source prefixes from object IDs', () => {
    const ndjson = `{"id":"ds1_dash1","type":"dashboard","attributes":{},"references":[]}`;
    const result = stripDataSourcePrefixes(ndjson, new Set(['ds1']));
    const obj = JSON.parse(result.trim());
    expect(obj.id).toBe('dash1');
  });

  it('should strip data source prefixes from references', () => {
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{},"references":[{"type":"visualization","id":"ds1_vis1","name":"ref1"}]}`;
    const result = stripDataSourcePrefixes(ndjson, new Set(['ds1']));
    const obj = JSON.parse(result.trim());
    expect(obj.references[0].id).toBe('vis1');
  });

  it('should remove data-source objects', () => {
    const ndjson = `{"id":"ds1","type":"data-source","attributes":{}}
{"id":"dash1","type":"dashboard","attributes":{},"references":[]}`;
    const result = stripDataSourcePrefixes(ndjson, new Set(['ds1']));
    const lines = result.trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).type).toBe('dashboard');
  });
});

describe('remapDataSources', () => {
  it('should remap data source references to target ID', () => {
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{},"references":[{"type":"data-source","id":"ds1","name":"dataSource"}]}`;
    const result = remapDataSources(ndjson, new Set(['ds1']), 'target-ds');
    const obj = JSON.parse(result.trim());
    expect(obj.references[0].id).toBe('target-ds');
  });

  it('should inject data source reference when none exists (AOS export)', () => {
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{},"references":[]}`;
    const result = remapDataSources(ndjson, new Set(), 'target-ds');
    const obj = JSON.parse(result.trim());
    expect(obj.references.length).toBe(1);
    expect(obj.references[0].type).toBe('data-source');
    expect(obj.references[0].id).toBe('target-ds');
  });

  it('should inject data_source_id into TSVB visualizations', () => {
    const visState = JSON.stringify({ type: 'metrics', params: {} });
    const ndjson = `{"id":"vis1","type":"visualization","attributes":{"visState":${JSON.stringify(visState)}},"references":[]}`;
    const result = remapDataSources(ndjson, new Set(), 'target-ds');
    const obj = JSON.parse(result.trim());
    const parsedVisState = JSON.parse(obj.attributes.visState);
    expect(parsedVisState.params.data_source_id).toBe('target-ds');
  });

  it('should inject data_source_name into Vega visualizations', () => {
    const spec = `{
  data: {
    url: {
      index: my-index
    }
  }
}`;
    const visState = JSON.stringify({ type: 'vega', params: { spec } });
    const ndjson = `{"id":"vis1","type":"visualization","attributes":{"visState":${JSON.stringify(visState)}},"references":[]}`;
    const result = remapDataSources(ndjson, new Set(), 'target-ds', 'Target DS');
    const obj = JSON.parse(result.trim());
    const parsedVisState = JSON.parse(obj.attributes.visState);
    expect(parsedVisState.params.spec).toContain('data_source_name: Target DS');
  });

  it('should remap nested data source IDs in attributes', () => {
    const searchSourceJSON = JSON.stringify({ dataSource: { id: 'ds1' } });
    const ndjson = `{"id":"vis1","type":"visualization","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[]}`;
    const result = remapDataSources(ndjson, new Set(['ds1']), 'target-ds');
    const obj = JSON.parse(result.trim());
    const parsed = JSON.parse(obj.attributes.kibanaSavedObjectMeta.searchSourceJSON);
    expect(parsed.dataSource.id).toBe('target-ds');
  });
});

describe('stripDashboardDatasetBlocks', () => {
  it('should strip dataset block from dashboard searchSourceJSON', () => {
    const searchSourceJSON = JSON.stringify({
      query: { dataset: { id: 'some-dataset' }, query: 'test' },
    });
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[]}`;
    const result = stripDashboardDatasetBlocks(ndjson);
    const obj = JSON.parse(result.trim());
    const parsed = JSON.parse(obj.attributes.kibanaSavedObjectMeta.searchSourceJSON);
    expect(parsed.query.dataset).toBeUndefined();
    expect(parsed.query.query).toBe('test');
  });

  it('should not modify non-dashboard objects', () => {
    const ndjson = `{"id":"vis1","type":"visualization","attributes":{},"references":[]}`;
    const result = stripDashboardDatasetBlocks(ndjson);
    expect(result).toBe(ndjson + '\n');
  });

  it('should handle dashboards without dataset', () => {
    const searchSourceJSON = JSON.stringify({ query: { query: 'test' } });
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[]}`;
    const result = stripDashboardDatasetBlocks(ndjson);
    const obj = JSON.parse(result.trim());
    const parsed = JSON.parse(obj.attributes.kibanaSavedObjectMeta.searchSourceJSON);
    expect(parsed.query.query).toBe('test');
  });
});

describe('remapIndexPatterns', () => {
  it('should remap index-pattern titles', () => {
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"title":"old-pattern"},"references":[]}`;
    const mappings = new Map([['old-pattern', 'new-pattern']]);
    const result = remapIndexPatterns(ndjson, mappings);
    const obj = JSON.parse(result.trim());
    expect(obj.attributes.title).toBe('new-pattern');
  });

  it('should remap index patterns in visualization attributes', () => {
    const ndjson = `{"id":"vis1","type":"visualization","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"index\\":\\"old-pattern\\"}"}},"references":[]}`;
    const mappings = new Map([['old-pattern', 'new-pattern']]);
    const result = remapIndexPatterns(ndjson, mappings);
    const obj = JSON.parse(result.trim());
    expect(obj.attributes.kibanaSavedObjectMeta.searchSourceJSON).toContain('new-pattern');
  });

  it('should return unchanged NDJSON when mappings are empty', () => {
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"title":"pattern"},"references":[]}`;
    const result = remapIndexPatterns(ndjson, new Map());
    expect(result).toBe(ndjson);
  });
});

describe('disableMissingFieldFilters', () => {
  it('should disable filters referencing missing fields', () => {
    const fields = JSON.stringify([{ name: 'field1' }, { name: 'field2' }]);
    const searchSourceJSON = JSON.stringify({
      filter: [
        { meta: { key: 'field1', disabled: false } },
        { meta: { key: 'field3', disabled: false } },
      ],
    });
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"fields":${JSON.stringify(fields)}},"references":[]}
{"id":"vis1","type":"visualization","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ip1"}]}`;
    const result = disableMissingFieldFilters(ndjson);
    const lines = result.trim().split('\n');
    const vis = JSON.parse(lines[1]);
    const parsed = JSON.parse(vis.attributes.kibanaSavedObjectMeta.searchSourceJSON);
    expect(parsed.filter[0].meta.disabled).toBe(false);
    expect(parsed.filter[1].meta.disabled).toBe(true);
  });

  it('should not modify filters that are already disabled', () => {
    const fields = JSON.stringify([{ name: 'field1' }]);
    const searchSourceJSON = JSON.stringify({
      filter: [{ meta: { key: 'field2', disabled: true } }],
    });
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"fields":${JSON.stringify(fields)}},"references":[]}
{"id":"vis1","type":"visualization","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ip1"}]}`;
    const result = disableMissingFieldFilters(ndjson);
    const lines = result.trim().split('\n');
    const vis = JSON.parse(lines[1]);
    const parsed = JSON.parse(vis.attributes.kibanaSavedObjectMeta.searchSourceJSON);
    expect(parsed.filter[0].meta.disabled).toBe(true);
  });

  it('should skip filters with key "query"', () => {
    const fields = JSON.stringify([{ name: 'field1' }]);
    const searchSourceJSON = JSON.stringify({
      filter: [{ meta: { key: 'query', disabled: false } }],
    });
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"fields":${JSON.stringify(fields)}},"references":[]}
{"id":"vis1","type":"visualization","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ip1"}]}`;
    const result = disableMissingFieldFilters(ndjson);
    const lines = result.trim().split('\n');
    const vis = JSON.parse(lines[1]);
    const parsed = JSON.parse(vis.attributes.kibanaSavedObjectMeta.searchSourceJSON);
    expect(parsed.filter[0].meta.disabled).toBe(false);
  });
});

describe('applyRepairPipeline', () => {
  it('should apply all enabled repairs in order', () => {
    const ndjson = `{"id":"ds1","type":"data-source","attributes":{}}
{"id":"ds1_dash1","type":"dashboard","attributes":{},"references":[{"type":"data-source","id":"ds1","name":"dataSource"}]}`;
    const config = {
      stripDataSourcePrefixes: true,
      remapDataSources: { enabled: true, targetId: 'target-ds' },
      stripDashboardDatasets: false,
      remapIndexPatterns: { enabled: false },
      disableMissingFieldFilters: false,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.changes.length).toBe(2);
    expect(result.changes[0]).toContain('Stripped data-source prefixes');
    expect(result.changes[1]).toContain('Remapped data sources');

    const obj = JSON.parse(result.ndjson.trim());
    expect(obj.id).toBe('dash1');
    expect(obj.references[0].id).toBe('target-ds');
  });

  it('should skip disabled repairs', () => {
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{},"references":[]}`;
    const config = {
      stripDataSourcePrefixes: false,
      remapDataSources: { enabled: false },
      stripDashboardDatasets: false,
      remapIndexPatterns: { enabled: false },
      disableMissingFieldFilters: false,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.changes.length).toBe(0);
  });

  it('should apply stripDashboardDatasets when enabled', () => {
    const searchSourceJSON = JSON.stringify({ query: { dataset: { id: 'ds' } } });
    const ndjson = `{"id":"dash1","type":"dashboard","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[]}`;
    const config = {
      stripDataSourcePrefixes: false,
      remapDataSources: { enabled: false },
      stripDashboardDatasets: true,
      remapIndexPatterns: { enabled: false },
      disableMissingFieldFilters: false,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.changes).toContain('Stripped dataset blocks from dashboard objects');
  });

  it('should apply remapIndexPatterns when enabled', () => {
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"title":"old"},"references":[]}`;
    const config = {
      stripDataSourcePrefixes: false,
      remapDataSources: { enabled: false },
      stripDashboardDatasets: false,
      remapIndexPatterns: { enabled: true, mappings: { old: 'new' } },
      disableMissingFieldFilters: false,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.changes).toContain('Remapped 1 index pattern(s)');
  });

  it('should apply disableMissingFieldFilters when enabled', () => {
    const fields = JSON.stringify([{ name: 'field1' }]);
    const searchSourceJSON = JSON.stringify({
      filter: [{ meta: { key: 'field2', disabled: false } }],
    });
    const ndjson = `{"id":"ip1","type":"index-pattern","attributes":{"fields":${JSON.stringify(fields)}},"references":[]}
{"id":"vis1","type":"visualization","attributes":{"kibanaSavedObjectMeta":{"searchSourceJSON":${JSON.stringify(searchSourceJSON)}}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ip1"}]}`;
    const config = {
      stripDataSourcePrefixes: false,
      remapDataSources: { enabled: false },
      stripDashboardDatasets: false,
      remapIndexPatterns: { enabled: false },
      disableMissingFieldFilters: true,
    };
    const result = applyRepairPipeline(ndjson, config);
    expect(result.changes).toContain('Disabled filters referencing missing fields');
  });
});
