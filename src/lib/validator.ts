/**
 * Index pattern validation, field compatibility checking, and smart remapping suggestions.
 */
import { OSDClient } from './client.js';
import { log } from './logger.js';

/**
 * Suggest index pattern mappings by finding the best match between
 * source patterns and target indices using structural similarity.
 */
export function suggestIndexPatternMappings(
  sourcePatterns: string[],
  targetIndices: string[]
): Array<{ source: string; suggested: string | null; confidence: 'high' | 'medium' | 'low' }> {
  const targetPrefixes = new Set<string>();
  for (const idx of targetIndices) {
    if (idx.startsWith('.')) continue;
    const prefix = idx.replace(/-\d{4}[-.].*$/, '').replace(/\.\d{4}[-.].*$/, '');
    targetPrefixes.add(prefix);
  }

  const suggestions: Array<{ source: string; suggested: string | null; confidence: 'high' | 'medium' | 'low' }> = [];

  for (const srcPattern of sourcePatterns) {
    const srcBase = srcPattern.replace(/\*$/, '').replace(/\.$/, '');
    const srcParts = srcBase.split(/[.\-_]/).filter(Boolean);

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const tgtPrefix of targetPrefixes) {
      const tgtParts = tgtPrefix.split(/[.\-_]/).filter(Boolean);
      let score = 0;
      for (const sp of srcParts) {
        if (sp.length < 3) continue;
        for (const tp of tgtParts) {
          if (tp.length < 3) continue;
          if (sp.toLowerCase() === tp.toLowerCase()) score += 3;
          else if (sp.toLowerCase().includes(tp.toLowerCase()) || tp.toLowerCase().includes(sp.toLowerCase())) score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = srcPattern.endsWith('*') ? tgtPrefix + '*' : tgtPrefix;
      }
    }

    suggestions.push({
      source: srcPattern,
      suggested: bestScore > 0 ? bestMatch : null,
      confidence: bestScore >= 3 ? 'high' : bestScore >= 1 ? 'medium' : 'low',
    });
  }

  return suggestions;
}

/**
 * Validate index patterns against target data source and suggest remappings.
 */
export async function validateAndSuggestIndexMappings(
  client: OSDClient,
  objects: Array<{ type: string; attributes?: Record<string, unknown> }>,
  targetDataSourceId: string,
  explicitMappings: Map<string, string>,
  interactive: boolean,
  confirmFn?: (question: string) => Promise<boolean>
): Promise<Map<string, string>> {
  const mappings = new Map(explicitMappings);

  const indexPatterns = objects
    .filter((o) => o.type === 'index-pattern')
    .map((o) => o.attributes?.title as string)
    .filter(Boolean);

  if (indexPatterns.length === 0) return mappings;

  log('\n=== Index Pattern Validation ===');
  log(`Checking ${indexPatterns.length} index pattern(s) against target data source...`);
  const validationResults = await client.validateIndexPatterns(indexPatterns, targetDataSourceId);

  let unmatchedCount = 0;
  const unmatchedPatterns: string[] = [];
  for (const r of validationResults) {
    if (mappings.has(r.pattern)) {
      log(`  ↔ ${r.pattern} -> ${mappings.get(r.pattern)} (explicit remap)`);
    } else if (r.matched) {
      log(`  ✓ ${r.pattern}${r.indices ? ` (matches: ${r.indices.join(', ')}${r.indices.length >= 5 ? '...' : ''})` : ''}`);
    } else {
      log(`  ✗ ${r.pattern} — no matching indices found in target`);
      unmatchedCount++;
      unmatchedPatterns.push(r.pattern);
    }
  }

  if (unmatchedCount > 0) {
    log('\n  Analyzing target indices for possible mappings...');
    const fullValidation = await client.validateIndexPatterns(['*'], targetDataSourceId);
    const targetIndices = fullValidation[0]?.indices ?? [];

    if (targetIndices.length > 0) {
      const suggestions = suggestIndexPatternMappings(unmatchedPatterns, targetIndices);
      const hasSuggestions = suggestions.some((s) => s.suggested);

      if (hasSuggestions) {
        log('\n  Suggested index pattern mappings:');
        for (const s of suggestions) {
          if (s.suggested) log(`    ${s.source} -> ${s.suggested} (${s.confidence} confidence)`);
          else log(`    ${s.source} -> ? (no match found)`);
        }

        if (interactive && confirmFn) {
          const apply = await confirmFn('\n  Apply suggested mappings?');
          if (apply) {
            for (const s of suggestions) {
              if (s.suggested) mappings.set(s.source, s.suggested);
            }
            log(`  Applied ${[...mappings.keys()].length} mapping(s).`);
          }
        }
      }
    }

    const stillUnmapped = unmatchedPatterns.filter((p) => !mappings.has(p));
    if (stillUnmapped.length > 0) {
      log(`\n  Warning: ${stillUnmapped.length} index pattern(s) have no matching indices in the target.`);
      log('  Visualizations using these patterns will show "No data" until the indices exist.');
      if (!interactive) {
        log('  To remap manually: --remap-index-pattern "old-pattern*=new-pattern*"');
      }
    }
  }

  return mappings;
}

/**
 * Rebuild the `fields` attribute for remapped index patterns from target _mapping.
 */
export async function rebuildIndexPatternFields(
  ndjson: string,
  mappings: Map<string, string>,
  client: OSDClient,
  dataSourceId: string
): Promise<string> {
  if (mappings.size === 0) return ndjson;

  const lines = ndjson.trim().split('\n').filter(Boolean);
  const rebuilt: string[] = [];

  for (const line of lines) {
    const obj = JSON.parse(line);
    if (!obj.type || !obj.id || obj.type !== 'index-pattern') {
      rebuilt.push(line);
      continue;
    }

    const title = obj.attributes?.title as string;
    if (!title) { rebuilt.push(line); continue; }

    const wasRemapped = [...mappings.values()].includes(title);
    if (!wasRemapped) { rebuilt.push(line); continue; }

    log(`  Rebuilding fields for "${title}" from target _mapping...`);
    const fields = await client.buildFieldsFromMapping(title, dataSourceId);
    if (fields) {
      obj.attributes.fields = fields;
      log(`    Found ${JSON.parse(fields).length} fields.`);
    } else {
      log('    Could not fetch mapping — keeping original fields.');
    }

    rebuilt.push(JSON.stringify(obj));
  }

  return rebuilt.join('\n') + '\n';
}

/**
 * Extract fields referenced by visualizations, grouped by index pattern ID.
 */
export function extractFieldsUsedByVisualizations(
  objects: Array<{ type: string; attributes?: Record<string, unknown>; references?: Array<{ id: string; name: string; type: string }> }>
): Map<string, Set<string>> {
  const fieldsByPatternId = new Map<string, Set<string>>();

  for (const obj of objects) {
    if (obj.type !== 'visualization' || !obj.attributes?.visState) continue;

    const indexPatternRef = obj.references?.find((r) => r.type === 'index-pattern');
    const patternId = indexPatternRef?.id ?? '_unknown';

    if (!fieldsByPatternId.has(patternId)) fieldsByPatternId.set(patternId, new Set());
    const fields = fieldsByPatternId.get(patternId)!;

    try {
      const visState = JSON.parse(obj.attributes.visState as string);
      if (visState.aggs) {
        for (const agg of visState.aggs) {
          if (agg.params?.field) fields.add(agg.params.field);
          if (agg.params?.orderBy) fields.add(agg.params.orderBy);
        }
      }
    } catch {}

    try {
      const meta = obj.attributes.kibanaSavedObjectMeta as Record<string, unknown> | undefined;
      if (meta?.searchSourceJSON) {
        const ss = JSON.parse(meta.searchSourceJSON as string);
        if (ss.filter) {
          for (const f of ss.filter) {
            if (f.meta?.key) fields.add(f.meta.key);
          }
        }
      }
    } catch {}
  }

  return fieldsByPatternId;
}

/**
 * Validate that fields used by visualizations exist in the target index.
 */
export async function validateFieldCompatibility(
  client: OSDClient,
  objects: Array<{ type: string; id: string; attributes?: Record<string, unknown>; references?: Array<{ id: string; name: string; type: string }> }>,
  targetDataSourceId: string
): Promise<void> {
  const fieldsByPatternId = extractFieldsUsedByVisualizations(objects);
  if (fieldsByPatternId.size === 0) return;

  const patternTitles = new Map<string, string>();
  for (const obj of objects) {
    if (obj.type === 'index-pattern' && obj.attributes?.title) {
      patternTitles.set(obj.id, obj.attributes.title as string);
    }
  }

  const dsObj = await client.getSavedObject('data-source', targetDataSourceId);
  if (!dsObj?.attributes?.endpoint) return;

  const dsEndpoint = dsObj.attributes.endpoint as string;
  const dsRegion = dsEndpoint.match(/\.([a-z]{2}-[a-z]+-\d)\./)?.[1];
  if (!dsRegion) return;

  let dsService = 'es';
  if (dsEndpoint.includes('.aoss.amazonaws.com')) dsService = 'aoss';

  let allIndices: string[] = [];
  try {
    const { execSync } = await import('child_process');
    const catResult = execSync(
      `curl -s -X GET "${dsEndpoint}/_cat/indices?format=json&h=index" ` +
      `--aws-sigv4 "aws:amz:${dsRegion}:${dsService}" ` +
      `--user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" ` +
      `-H "x-amz-security-token: $AWS_SESSION_TOKEN"`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    allIndices = JSON.parse(catResult).map((i: any) => i.index as string);
  } catch {}

  log('\n=== Field Compatibility Check ===');

  for (const [patternId, usedFields] of fieldsByPatternId) {
    if (usedFields.size === 0) continue;

    const patternTitle = patternTitles.get(patternId) ?? patternId;

    let queryIndex = patternTitle;
    if (patternTitle.includes('*')) {
      const regex = new RegExp('^' + patternTitle.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      const match = allIndices.find((idx) => regex.test(idx));
      if (!match) {
        log(`  ${patternTitle}: no matching indices found, skipping field check`);
        continue;
      }
      queryIndex = match;
    }

    try {
      const { execSync } = await import('child_process');
      const result = execSync(
        `curl -s -X GET "${dsEndpoint}/${queryIndex}/_mapping" ` +
        `--aws-sigv4 "aws:amz:${dsRegion}:${dsService}" ` +
        `--user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" ` +
        `-H "x-amz-security-token: $AWS_SESSION_TOKEN"`,
        { encoding: 'utf-8', timeout: 15000 }
      );

      const mappingData = JSON.parse(result);
      const targetFields = new Set<string>();
      for (const indexData of Object.values(mappingData) as any[]) {
        const props = indexData.mappings?.properties ?? {};
        collectFieldNames(props, '', targetFields);
      }

      if (targetFields.size === 0) {
        log(`  ${patternTitle}: could not retrieve field mappings`);
        continue;
      }

      const missing = [...usedFields].filter((f) => !targetFields.has(f) && !f.startsWith('_'));
      const matched = [...usedFields].filter((f) => targetFields.has(f) || f.startsWith('_'));

      if (missing.length === 0) {
        log(`  ✓ ${patternTitle}: all ${usedFields.size} fields found`);
      } else {
        log(`  ⚠ ${patternTitle}: ${matched.length}/${usedFields.size} fields found, ${missing.length} missing`);
        for (const f of missing) log(`      missing: ${f}`);
      }
    } catch {
      log(`  ${patternTitle}: could not validate fields (index may not exist yet)`);
    }
  }
}

function collectFieldNames(props: Record<string, any>, prefix: string, fields: Set<string>): void {
  for (const [name, value] of Object.entries(props)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    fields.add(fullName);
    if (value.properties) collectFieldNames(value.properties, fullName, fields);
    if (value.fields) {
      for (const subName of Object.keys(value.fields)) fields.add(`${fullName}.${subName}`);
    }
  }
}
