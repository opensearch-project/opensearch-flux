import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { detectPlatformType } from '../config.js';

describe('detectPlatformType', () => {
  // Property 1: Platform detection correctness
  // For any endpoint URL, the return value is mutually exclusive and exhaustive.

  const aosEndpointArb = fc.tuple(fc.webSegment(), fc.constantFrom('us-east-1', 'eu-west-1', 'ap-south-1')).map(
    ([sub, region]) => `https://search-${sub}.${region}.es.amazonaws.com`
  );

  const opensearchUiEndpointArb = fc.tuple(fc.webSegment(), fc.constantFrom('us-east-1', 'eu-central-1')).map(
    ([sub, region]) => `https://application-${sub}.${region}.opensearch.amazonaws.com`
  );

  const aossEndpointArb = fc.tuple(fc.stringMatching(/^[0-9a-f]{10,20}$/), fc.constantFrom('us-west-2', 'eu-west-1')).map(
    ([id, region]) => `https://${id}.${region}.aoss.amazonaws.com`
  );

  const unknownEndpointArb = fc.oneof(
    fc.constant('https://localhost:5601'),
    fc.constant('http://my-cluster.internal:9200'),
    fc.webUrl(),
    fc.constant(''),
  );

  it('should return "aos" for AOS domain endpoints', () => {
    fc.assert(fc.property(aosEndpointArb, (endpoint) => {
      expect(detectPlatformType(endpoint)).toBe('aos');
    }), { numRuns: 100 });
  });

  it('should return "opensearch-ui" for OpenSearch UI endpoints', () => {
    fc.assert(fc.property(opensearchUiEndpointArb, (endpoint) => {
      expect(detectPlatformType(endpoint)).toBe('opensearch-ui');
    }), { numRuns: 100 });
  });

  it('should return "aoss" for AOSS endpoints', () => {
    fc.assert(fc.property(aossEndpointArb, (endpoint) => {
      expect(detectPlatformType(endpoint)).toBe('aoss');
    }), { numRuns: 100 });
  });

  it('should return "unknown" for non-AWS endpoints', () => {
    fc.assert(fc.property(unknownEndpointArb, (endpoint) => {
      expect(detectPlatformType(endpoint)).toBe('unknown');
    }), { numRuns: 100 });
  });

  // Unit tests for edge cases
  it('should return "unknown" for empty string', () => {
    expect(detectPlatformType('')).toBe('unknown');
  });

  it('should return "unknown" for localhost', () => {
    expect(detectPlatformType('https://localhost:5601')).toBe('unknown');
  });

  it('should handle endpoints with trailing paths', () => {
    expect(detectPlatformType('https://search-test.us-east-1.es.amazonaws.com/_dashboards')).toBe('aos');
    expect(detectPlatformType('https://application-test.us-east-1.opensearch.amazonaws.com/app')).toBe('opensearch-ui');
  });
});
