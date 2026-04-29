import * as fc from 'fast-check';
import {
  detectPlatformType,
  detectServiceFromEndpoint,
  detectRegionFromEndpoint,
  WORKSPACE_TYPES,
} from '../../common/config';

describe('detectPlatformType', () => {
  const aosEndpointArb = fc
    .tuple(fc.webSegment(), fc.constantFrom('us-east-1', 'eu-west-1', 'ap-south-1'))
    .map(([sub, region]) => `https://search-${sub}.${region}.es.amazonaws.com`);

  const opensearchUiEndpointArb = fc
    .tuple(fc.webSegment(), fc.constantFrom('us-east-1', 'eu-central-1'))
    .map(([sub, region]) => `https://application-${sub}.${region}.opensearch.amazonaws.com`);

  const aossEndpointArb = fc
    .tuple(fc.stringMatching(/^[0-9a-f]{10,20}$/), fc.constantFrom('us-west-2', 'eu-west-1'))
    .map(([id, region]) => `https://${id}.${region}.aoss.amazonaws.com`);

  const unknownEndpointArb = fc.oneof(
    fc.constant('https://localhost:5601'),
    fc.constant('http://my-cluster.internal:9200'),
    fc.webUrl(),
    fc.constant('')
  );

  it('should return "aos" for AOS domain endpoints', () => {
    fc.assert(
      fc.property(aosEndpointArb, (endpoint) => {
        expect(detectPlatformType(endpoint)).toBe('aos');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "opensearch-ui" for OpenSearch UI endpoints', () => {
    fc.assert(
      fc.property(opensearchUiEndpointArb, (endpoint) => {
        expect(detectPlatformType(endpoint)).toBe('opensearch-ui');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "aoss" for AOSS endpoints', () => {
    fc.assert(
      fc.property(aossEndpointArb, (endpoint) => {
        expect(detectPlatformType(endpoint)).toBe('aoss');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "unknown" for non-AWS endpoints', () => {
    fc.assert(
      fc.property(unknownEndpointArb, (endpoint) => {
        expect(detectPlatformType(endpoint)).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });

  it('should return "unknown" for empty string', () => {
    expect(detectPlatformType('')).toBe('unknown');
  });

  it('should handle endpoints with trailing paths', () => {
    expect(detectPlatformType('https://search-test.us-east-1.es.amazonaws.com/_dashboards')).toBe('aos');
    expect(detectPlatformType('https://application-test.us-east-1.opensearch.amazonaws.com/app')).toBe('opensearch-ui');
  });
});

describe('detectServiceFromEndpoint', () => {
  it('should return "opensearch" for OpenSearch UI endpoints', () => {
    expect(detectServiceFromEndpoint('https://application-test.us-east-1.opensearch.amazonaws.com')).toBe('opensearch');
  });

  it('should return "aoss" for AOSS endpoints', () => {
    expect(detectServiceFromEndpoint('https://abc123.us-west-2.aoss.amazonaws.com')).toBe('aoss');
    expect(detectServiceFromEndpoint('https://collection.us-west-2.opensearch.amazonaws.com')).toBe('aoss');
  });

  it('should return "es" for AOS endpoints', () => {
    expect(detectServiceFromEndpoint('https://search-domain.us-east-1.es.amazonaws.com')).toBe('es');
  });

  it('should return "es" for unknown endpoints', () => {
    expect(detectServiceFromEndpoint('https://localhost:5601')).toBe('es');
  });
});

describe('detectRegionFromEndpoint', () => {
  it('should extract region from AOS endpoints', () => {
    expect(detectRegionFromEndpoint('https://search-test.us-east-1.es.amazonaws.com')).toBe('us-east-1');
    expect(detectRegionFromEndpoint('https://search-test.eu-west-1.es.amazonaws.com')).toBe('eu-west-1');
  });

  it('should extract region from AOSS endpoints', () => {
    expect(detectRegionFromEndpoint('https://abc123.us-west-2.aoss.amazonaws.com')).toBe('us-west-2');
  });

  it('should extract region from OpenSearch endpoints', () => {
    expect(detectRegionFromEndpoint('https://collection.ap-south-1.opensearch.amazonaws.com')).toBe('ap-south-1');
  });

  it('should return undefined for endpoints without region', () => {
    expect(detectRegionFromEndpoint('https://localhost:5601')).toBeUndefined();
    expect(detectRegionFromEndpoint('')).toBeUndefined();
  });
});

describe('WORKSPACE_TYPES', () => {
  it('should contain expected workspace type mappings', () => {
    expect(WORKSPACE_TYPES.analytics).toEqual(['use-case-all']);
    expect(WORKSPACE_TYPES.essentials).toEqual(['use-case-essentials']);
    expect(WORKSPACE_TYPES.observability).toEqual(['use-case-observability']);
    expect(WORKSPACE_TYPES['security-analytics']).toEqual(['use-case-security-analytics']);
    expect(WORKSPACE_TYPES.search).toEqual(['use-case-search']);
  });
});
