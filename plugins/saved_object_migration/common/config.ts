import { PlatformType } from './types';

export const WORKSPACE_TYPES: Record<string, string[]> = {
  analytics: ['use-case-all'],
  essentials: ['use-case-essentials'],
  observability: ['use-case-observability'],
  'security-analytics': ['use-case-security-analytics'],
  search: ['use-case-search'],
};

/**
 * Auto-detect platform type from an endpoint URL.
 *   application-*.opensearch.amazonaws.com  -> 'opensearch-ui'
 *   *.aoss.amazonaws.com                   -> 'aoss'
 *   *.es.amazonaws.com                     -> 'aos'
 *   everything else                        -> 'unknown'
 */
export function detectPlatformType(endpoint: string): PlatformType {
  if (endpoint.match(/application-.*\.opensearch\.amazonaws\.com/)) return 'opensearch-ui';
  if (endpoint.includes('.aoss.amazonaws.com')) return 'aoss';
  if (endpoint.includes('.es.amazonaws.com')) return 'aos';
  return 'unknown';
}

/**
 * Auto-detect AWS signing service from an endpoint URL.
 *   application-*.opensearch.amazonaws.com  -> 'opensearch' (OpenSearch UI application)
 *   *.aoss.amazonaws.com or AOSS patterns   -> 'aoss' (serverless)
 *   *.es.amazonaws.com                      -> 'es'   (managed domains)
 */
export function detectServiceFromEndpoint(endpoint: string): string {
  if (endpoint.match(/application-.*\.opensearch\.amazonaws\.com/)) return 'opensearch';
  if (endpoint.includes('.aoss.amazonaws.com')) return 'aoss';
  if (endpoint.includes('.opensearch.amazonaws.com')) return 'aoss';
  return 'es';
}

/**
 * Auto-detect AWS region from an endpoint URL like:
 *   https://xxx.eu-central-1.opensearch.amazonaws.com
 *   https://xxx.us-west-2.es.amazonaws.com
 */
export function detectRegionFromEndpoint(endpoint: string): string | undefined {
  const match = endpoint.match(/\.([a-z]{2}-[a-z]+-\d)\.(?:opensearch|es|aoss)\.amazonaws\.com/);
  return match?.[1];
}
