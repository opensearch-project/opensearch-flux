/**
 * NDJSON repair and transformation functions.
 * All functions take NDJSON strings and return transformed NDJSON strings.
 */
import { RepairConfig, RepairResult } from './types';

/**
 * Parse an NDJSON string into an array of saved objects (skipping metadata lines).
 */
export function parseNdjsonFile(ndjson: string) {
  return ndjson
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((obj: Record<string, unknown>) => obj.type && obj.id);
}

/**
 * Scan objects for all data source IDs, including those embedded in nested JSON strings.
 */
export function extractDataSourceIds(objects: Array<{ references?: Array<{ type: string; id: string }>; attributes?: Record<string, unknown> }>): Set<string> {
  const ids = new Set<string>();

  for (const obj of objects) {
    if (obj.references) {
      for (const ref of obj.references) {
        if (ref.type === 'data-source') ids.add(ref.id);
      }
    }
    if (obj.attributes) {
      scanForDataSourceIds(obj.attributes, ids);
    }
  }

  return ids;
}

function scanForDataSourceIds(value: unknown, ids: Set<string>): void {
  if (typeof value === 'string') {
    try {
      scanForDataSourceIds(JSON.parse(value), ids);
    } catch { /* not JSON */ }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.dataSource && typeof record.dataSource === 'object') {
      const ds = record.dataSource as Record<string, unknown>;
      if (typeof ds.id === 'string' && ds.id) ids.add(ds.id);
    }
    for (const v of Object.values(record)) {
      scanForDataSourceIds(v, ids);
    }
    if (Array.isArray(value)) {
      for (const item of value) scanForDataSourceIds(item, ids);
    }
  }
}

/**
 * Extract data source details from exported data-source objects.
 */
export function extractDataSourceDetails(objects: Array<{ type: string; id: string; attributes?: Record<string, unknown> }>): Array<{ id: string; title: string; endpoint?: string }> {
  return objects
    .filter((o) => o.type === 'data-source')
    .map((o) => ({
      id: o.id,
      title: (o.attributes?.title ?? o.attributes?.dataSourceEngineType ?? '(untitled)') as string,
      endpoint: o.attributes?.endpoint as string | undefined,
    }));
}

/**
 * Strip data-source ID prefixes from object IDs and references.
 * Also removes data-source objects (the target has its own).
 */
export function stripDataSourcePrefixes(ndjson: string, sourceDataSourceIds: Set<string>): string {
  const lines = ndjson.trim().split('\n').filter(Boolean);
  const cleaned = lines
    .map((line) => {
      const obj = JSON.parse(line);
      if (!obj.type || !obj.id) return line;
      if (obj.type === 'data-source') return null;

      for (const dsId of sourceDataSourceIds) {
        const prefix = dsId + '_';
        if (obj.id.startsWith(prefix)) {
          obj.id = obj.id.slice(prefix.length);
          break;
        }
      }

      if (obj.references) {
        for (const ref of obj.references) {
          for (const dsId of sourceDataSourceIds) {
            const prefix = dsId + '_';
            if (ref.id.startsWith(prefix)) {
              ref.id = ref.id.slice(prefix.length);
              break;
            }
          }
        }
      }

      return JSON.stringify(obj);
    })
    .filter(Boolean);

  return cleaned.join('\n') + '\n';
}

/**
 * Remap all data source references in NDJSON, including nested JSON strings.
 * If no data source references exist (e.g., AOS exports), injects a reference
 * to the target data source into each object.
 */
export function remapDataSources(ndjson: string, sourceIds: Set<string>, targetId: string, targetDsTitle?: string): string {
  const lines = ndjson.trim().split('\n').filter(Boolean);
  const hasAnyDsRefs = sourceIds.size > 0;

  const remapped = lines.map((line) => {
    const obj = JSON.parse(line);
    if (!obj.type || !obj.id) return line;

    if (hasAnyDsRefs) {
      // Remap existing data source references
      if (obj.references) {
        for (const ref of obj.references) {
          if (ref.type === 'data-source' && sourceIds.has(ref.id)) {
            ref.id = targetId;
          }
        }
      }
      if (obj.attributes) {
        obj.attributes = deepRemapDataSourceIds(obj.attributes, sourceIds, targetId);
      }
    } else if (targetId) {
      // No source data source refs (AOS export) — inject a reference to the target data source
      if (!obj.references) obj.references = [];
      const alreadyHasDsRef = obj.references.some((r: Record<string, unknown>) => r.type === 'data-source');
      if (!alreadyHasDsRef) {
        obj.references.push({
          id: targetId,
          type: 'data-source',
          name: 'dataSource',
        });
      }
    }

    // Inject data_source_id into TSVB (metrics) visualizations' visState params.
    // TSVB uses a different data fetching path (api/metrics/vis/data-raw) and
    // resolves data source from params.data_source_id, not from the references array.
    if (targetId && obj.type === 'visualization' && obj.attributes?.visState) {
      try {
        const visState = JSON.parse(obj.attributes.visState as string);
        if (visState.type === 'metrics' && !visState.params?.data_source_id) {
          if (!visState.params) visState.params = {};
          visState.params.data_source_id = targetId;
          obj.attributes.visState = JSON.stringify(visState);
        }
        // Inject data_source_name into Vega visualizations' spec url block.
        // Vega uses its own DSL and resolves data source from url.data_source_name.
        if (visState.type === 'vega' && visState.params?.spec) {
          const spec = visState.params.spec as string;
          if (!spec.includes('data_source_name') && targetDsTitle) {
            visState.params.spec = spec.replace(
              /(\n\s*index:\s*.+)/,
              `$1\n        data_source_name: ${targetDsTitle}`
            );
            obj.attributes.visState = JSON.stringify(visState);
          }
        }
      } catch { /* skip if visState isn't valid JSON */ }
    }

    return JSON.stringify(obj);
  });

  return remapped.join('\n') + '\n';
}

/**
 * Recursively remap data source IDs in an object, including inside nested JSON strings.
 */
export function deepRemapDataSourceIds(value: unknown, sourceIds: Set<string>, targetId: string): unknown {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      const remapped = deepRemapDataSourceIds(parsed, sourceIds, targetId);
      return JSON.stringify(remapped);
    } catch {
      let result = value;
      for (const sourceId of sourceIds) {
        result = result.split(sourceId).join(targetId);
      }
      return result;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRemapDataSourceIds(item, sourceIds, targetId));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepRemapDataSourceIds(v, sourceIds, targetId);
    }
    return result;
  }
  return value;
}

/**
 * Strip the `dataset` block from dashboard objects' searchSourceJSON.
 *
 * The `dataset` block embeds index-pattern and data-source IDs directly in the query.
 * After import with createNewCopies, these IDs become stale because new UUIDs are generated.
 * Stripping forces OSD to resolve via the `references` array instead.
 *
 * TODO: The proper fix is in OSD core's importSavedObjectsFromStream (create_saved_objects.ts)
 * — it should remap dataset.id via importIdMap and dataset.dataSource.id to the target data source.
 * Once that's done, this strip step can be removed.
 */
export function stripDashboardDatasetBlocks(ndjson: string): string {
  const lines = ndjson.trim().split('\n').filter(Boolean);
  const stripped = lines.map((line) => {
    const obj = JSON.parse(line);
    if (!obj.type || !obj.id) return line;

    // Strip dataset from searchSourceJSON (dashboards, visualizations, searches)
    const ssj = obj.attributes?.kibanaSavedObjectMeta?.searchSourceJSON;
    if (typeof ssj === 'string') {
      try {
        const parsed = JSON.parse(ssj);
        if (parsed.query?.dataset) {
          delete parsed.query.dataset;
          obj.attributes.kibanaSavedObjectMeta.searchSourceJSON = JSON.stringify(parsed);
          return JSON.stringify(obj);
        }
      } catch { /* skip malformed JSON */ }
    }

    // Strip dataset from visState (TSVB and other visualization types)
    const visState = obj.attributes?.visState;
    if (typeof visState === 'string') {
      try {
        const parsed = JSON.parse(visState);
        let changed = false;
        if (parsed.params?.query?.dataset) {
          delete parsed.params.query.dataset;
          changed = true;
        }
        // TSVB stores query in series items
        if (Array.isArray(parsed.params?.series)) {
          for (const series of parsed.params.series) {
            if (series.query?.dataset) {
              delete series.query.dataset;
              changed = true;
            }
          }
        }
        if (changed) {
          obj.attributes.visState = JSON.stringify(parsed);
          return JSON.stringify(obj);
        }
      } catch { /* skip malformed JSON */ }
    }

    return line;
  });

  return stripped.join('\n') + '\n';
}

/**
 * Apply index pattern remappings to NDJSON.
 * Updates index-pattern titles and any hardcoded references in visualization attributes.
 */
export function remapIndexPatterns(ndjson: string, mappings: Map<string, string>): string {
  if (mappings.size === 0) return ndjson;

  const lines = ndjson.trim().split('\n').filter(Boolean);
  const remapped = lines.map((line) => {
    const obj = JSON.parse(line);
    if (!obj.type || !obj.id) return line;

    if (obj.type === 'index-pattern' && obj.attributes?.title) {
      const oldTitle = obj.attributes.title as string;
      if (mappings.has(oldTitle)) {
        obj.attributes.title = mappings.get(oldTitle);
      }
    }

    if (obj.attributes) {
      let attrs = JSON.stringify(obj.attributes);
      for (const [oldPattern, newPattern] of mappings) {
        attrs = attrs.split(oldPattern).join(newPattern);
      }
      obj.attributes = JSON.parse(attrs);
    }

    return JSON.stringify(obj);
  });

  return remapped.join('\n') + '\n';
}

/**
 * Disable filters in visualizations that reference fields not present in the
 * target index pattern's field list.
 */
export function disableMissingFieldFilters(ndjson: string): string {
  const lines = ndjson.trim().split('\n').filter(Boolean);

  // First pass: collect field sets per index pattern ID
  const fieldsByPattern = new Map<string, Set<string>>();
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.type !== 'index-pattern') continue;
    const fieldsJson = obj.attributes?.fields as string;
    if (!fieldsJson) continue;
    try {
      const fields = JSON.parse(fieldsJson);
      fieldsByPattern.set(obj.id, new Set(fields.map((f: Record<string, unknown>) => f.name)));
    } catch { /* skip */ }
  }

  // Second pass: check filters in visualizations
  const updated = lines.map((line) => {
    const obj = JSON.parse(line);
    if (!obj.type || !obj.id || obj.type === 'index-pattern' || obj.type === 'dashboard') return line;

    const ssj = obj.attributes?.kibanaSavedObjectMeta?.searchSourceJSON;
    if (typeof ssj !== 'string') return line;

    try {
      const parsed = JSON.parse(ssj);
      if (!parsed.filter || !Array.isArray(parsed.filter)) return line;

      const indexRef = (obj.references || []).find(
        (ref: Record<string, unknown>) => ref.name === 'kibanaSavedObjectMeta.searchSourceJSON.index' && ref.type === 'index-pattern'
      );
      const fieldSet = indexRef ? fieldsByPattern.get(indexRef.id as string) : undefined;
      if (!fieldSet) return line;

      let changed = false;
      for (const filter of parsed.filter) {
        if (!filter.meta || filter.meta.disabled) continue;
        const key = filter.meta.key as string;
        // Skip non-field filter keys (e.g., "query" is a filter type, not a field name)
        if (!key || key === 'query') continue;
        if (!fieldSet.has(key)) {
          filter.meta.disabled = true;
          changed = true;
        }
      }

      if (changed) {
        obj.attributes.kibanaSavedObjectMeta.searchSourceJSON = JSON.stringify(parsed);
      }
    } catch { /* skip */ }

    return JSON.stringify(obj);
  });

  return updated.join('\n') + '\n';
}

/**
 * Apply the full repair pipeline in order, collecting change descriptions.
 * Steps: stripDataSourcePrefixes → remapDataSources → stripDashboardDatasetBlocks →
 *        remapIndexPatterns → disableMissingFieldFilters
 */
export function applyRepairPipeline(ndjson: string, config: RepairConfig): RepairResult {
  const changes: string[] = [];
  let result = ndjson;

  if (config.stripDataSourcePrefixes) {
    const objects = parseNdjsonFile(result);
    const dsIds = extractDataSourceIds(objects);
    if (dsIds.size > 0) {
      result = stripDataSourcePrefixes(result, dsIds);
      changes.push(`Stripped data-source prefixes for ${dsIds.size} data source(s)`);
    }
  }

  if (config.remapDataSources.enabled && config.remapDataSources.targetId) {
    const objects = parseNdjsonFile(result);
    const sourceIds = extractDataSourceIds(objects);
    result = remapDataSources(result, sourceIds, config.remapDataSources.targetId, config.remapDataSources.targetTitle);
    changes.push(`Remapped data sources to target ${config.remapDataSources.targetId}`);
  }

  if (config.stripDashboardDatasets) {
    const before = result;
    result = stripDashboardDatasetBlocks(result);
    if (result !== before) {
      changes.push('Stripped dataset blocks from dashboard objects');
    }
  }

  if (config.remapIndexPatterns.enabled && config.remapIndexPatterns.mappings) {
    const mappings = new Map(Object.entries(config.remapIndexPatterns.mappings));
    if (mappings.size > 0) {
      result = remapIndexPatterns(result, mappings);
      changes.push(`Remapped ${mappings.size} index pattern(s)`);
    }
  }

  if (config.disableMissingFieldFilters) {
    const before = result;
    result = disableMissingFieldFilters(result);
    if (result !== before) {
      changes.push('Disabled filters referencing missing fields');
    }
  }

  return { ndjson: result, changes };
}
