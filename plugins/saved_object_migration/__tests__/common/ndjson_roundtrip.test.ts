import * as fc from 'fast-check';
import { parseNdjsonFile } from '../../common/repair';
import { SavedObject } from '../../common/types';

function serializeToNdjson(objects: SavedObject[]): string {
  if (objects.length === 0) return '';
  return objects.map((obj) => JSON.stringify(obj)).join('\n') + '\n';
}

const savedObjectArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  type: fc.constantFrom('dashboard', 'visualization', 'index-pattern', 'search', 'config'),
  attributes: fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))),
  references: fc.array(
    fc.record({
      name: fc.string({ minLength: 1 }),
      type: fc.string({ minLength: 1 }),
      id: fc.string({ minLength: 1 }),
    }),
    { maxLength: 5 }
  ),
});

describe('NDJSON round-trip property', () => {
  it('should preserve objects through parse(serialize(objects))', () => {
    fc.assert(
      fc.property(fc.array(savedObjectArb, { maxLength: 10 }), (objects) => {
        const ndjson = serializeToNdjson(objects);
        const parsed = parseNdjsonFile(ndjson);
        expect(parsed).toEqual(objects);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve NDJSON through serialize(parse(ndjson))', () => {
    fc.assert(
      fc.property(fc.array(savedObjectArb, { maxLength: 10 }), (objects) => {
        const ndjson = serializeToNdjson(objects);
        const parsed = parseNdjsonFile(ndjson);
        const reserialized = serializeToNdjson(parsed);
        expect(reserialized).toBe(ndjson);
      }),
      { numRuns: 100 }
    );
  });

  it('should round-trip empty array', () => {
    const ndjson = serializeToNdjson([]);
    const parsed = parseNdjsonFile(ndjson);
    expect(parsed).toEqual([]);
  });

  it('should round-trip objects with nested JSON in attributes', () => {
    const objects: SavedObject[] = [
      {
        id: 'vis1',
        type: 'visualization',
        attributes: {
          visState: JSON.stringify({ type: 'line', params: { nested: { deep: 'value' } } }),
        },
        references: [],
      },
    ];
    const ndjson = serializeToNdjson(objects);
    const parsed = parseNdjsonFile(ndjson);
    expect(parsed).toEqual(objects);
  });

  it('should round-trip objects with special characters', () => {
    const objects: SavedObject[] = [
      {
        id: 'test-id',
        type: 'dashboard',
        attributes: {
          title: 'Test "quotes" and \\backslashes\\ and \nnewlines',
          description: 'Unicode: 你好 🎉',
        },
        references: [],
      },
    ];
    const ndjson = serializeToNdjson(objects);
    const parsed = parseNdjsonFile(ndjson);
    expect(parsed).toEqual(objects);
  });

  it('should filter out metadata lines without type and id', () => {
    const ndjson = `{"exportedCount":2}\n{"id":"1","type":"dashboard","attributes":{},"references":[]}\n`;
    const parsed = parseNdjsonFile(ndjson);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('1');
  });
});
