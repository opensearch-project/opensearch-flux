import { ConnectionConfig, PlatformType } from './types.js';
import { log } from './logger.js';

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

/**
 * Normalize a cookie value for use in the Cookie header.
 * Accepts either:
 *   - Full cookie string: "security_authentication=Fe26.2**..."
 *   - Raw value only:     "Fe26.2**..."
 * If the value doesn't contain '=' (i.e. no key=value format),
 * auto-prefixes with "security_authentication=".
 */
export function normalizeCookie(raw: string): string {
  const trimmed = raw.trim();
  // If it already looks like key=value, use as-is
  if (trimmed.includes('=')) return trimmed;
  // Otherwise, prefix with the default OSD session cookie name
  return `security_authentication=${trimmed}`;
}

export function buildConnectionConfig(
  endpoint: string,
  opts: { auth?: string; username?: string; password?: string; region?: string; service?: string; cookie?: string }
): ConnectionConfig {
  const auth = opts.auth ?? 'none';
  if (auth === 'cookie') {
    const cookie = opts.cookie;
    if (!cookie) {
      throw new Error('Cookie auth requires --cookie');
    }
    return { endpoint, auth: { type: 'cookie', cookie: normalizeCookie(cookie) } };
  }
  if (auth === 'basic') {
    if (!opts.username || !opts.password) {
      throw new Error('Basic auth requires --username and --password');
    }
    return { endpoint, auth: { type: 'basic', username: opts.username, password: opts.password } };
  }
  if (auth === 'iam') {
    const region = opts.region ?? detectRegionFromEndpoint(endpoint);
    if (!region) {
      throw new Error('Could not detect AWS region from endpoint URL. Please provide --region.');
    }
    const service = opts.service ?? detectServiceFromEndpoint(endpoint);
    log(`Using IAM auth (region: ${region}, service: ${service}, credentials from AWS credential chain)`);
    return { endpoint, auth: { type: 'iam', region, service } };
  }
  return { endpoint, auth: { type: 'none' } };
}
