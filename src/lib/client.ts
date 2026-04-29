import axios, { AxiosInstance } from 'axios';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { ConnectionConfig, SavedObject, ExportResult } from './types.js';
import { log } from './logger.js';

/**
 * Client for interacting with OpenSearch Dashboards saved objects API.
 * Uses native AWS SigV4 signing for all IAM-authenticated requests.
 *
 * API-ONLY CONSTRAINT: This client interacts with source and target instances
 * exclusively through the OSD saved objects API (/api/saved_objects/*) and the
 * workspace API (/api/workspaces/*). It MUST NOT make direct calls to S3 buckets
 * or the OpenSearch metadata_index on the target.
 *
 * EXCEPTION: The curlDataSource() method calls the user's data cluster endpoints
 * (_cat/indices, _mapping) for index pattern validation. This is acceptable because
 * it resolves the endpoint from a data-source saved object via the OSD API first
 * (data source proxy pattern). It does NOT access the metadata storage layer.
 */
export class OSDClient {
  private http: AxiosInstance;
  private config: ConnectionConfig;
  private signer: SignatureV4 | null = null;
  private detectedBasePath: string = '/_dashboards';

  constructor(config: ConnectionConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.endpoint,
      headers: {
        'osd-xsrf': 'true',
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });

    this.setupAuth();
  }

  private setupAuth(): void {
    if (this.config.auth.type === 'basic') {
      const { username, password } = this.config.auth;
      this.http.defaults.auth = { username, password };
    }
    if (this.config.auth.type === 'cookie') {
      const { cookie } = this.config.auth;
      this.http.defaults.headers.common['Cookie'] = cookie;
    }
    if (this.config.auth.type === 'iam') {
      const auth = this.config.auth;
      this.signer = new SignatureV4({
        credentials: fromNodeProviderChain(),
        region: auth.region,
        service: auth.service ?? 'opensearch',
        sha256: Sha256,
      });
    }
  }

  // ── Core HTTP methods with SigV4 signing ──────────────────────────────────

  /**
   * Make a signed GET request.
   */
  private async signedGet(
    apiPath: string,
    params?: Record<string, string | number>
  ): Promise<{ status: number; data: any }> {
    if (!this.signer) {
      const res = await this.http.get(apiPath, { params });
      return { status: res.status, data: res.data };
    }

    const url = new URL(apiPath, this.config.endpoint);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }

    const request = new HttpRequest({
      method: 'GET',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: {
        'osd-xsrf': 'true',
        host: url.hostname,
      },
    });

    const signed = await this.signer.sign(request);
    const res = await axios({
      method: 'GET',
      url: `${url.origin}${url.pathname}`,
      params: Object.fromEntries(url.searchParams),
      headers: signed.headers as Record<string, string>,
      validateStatus: () => true,
    });

    return { status: res.status, data: res.data };
  }

  /**
   * Make a signed POST request with a JSON or form body.
   */
  private async signedPost(
    apiPath: string,
    body: string,
    contentType: string
  ): Promise<{ status: number; data: any }> {
    if (!this.signer) {
      const res = await this.http.post(apiPath, JSON.parse(body));
      return { status: res.status, data: res.data };
    }

    const url = new URL(apiPath, this.config.endpoint);

    const request = new HttpRequest({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': contentType,
        'osd-xsrf': 'true',
        host: url.hostname,
      },
      body,
    });

    const signed = await this.signer.sign(request);
    const res = await axios({
      method: 'POST',
      url: url.toString(),
      data: body,
      headers: signed.headers as Record<string, string>,
      validateStatus: () => true,
    });

    return { status: res.status, data: res.data };
  }

  /**
   * Make a signed DELETE request.
   */
  private async signedDelete(apiPath: string): Promise<{ status: number; data: any }> {
    if (!this.signer) {
      const res = await this.http.delete(apiPath);
      return { status: res.status, data: res.data };
    }

    const url = new URL(apiPath, this.config.endpoint);
    const request = new HttpRequest({
      method: 'DELETE',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname + url.search,
      headers: {
        'osd-xsrf': 'true',
        host: url.hostname,
      },
    });

    const signed = await this.signer.sign(request);
    const res = await axios({
      method: 'DELETE',
      url: url.toString(),
      headers: signed.headers as Record<string, string>,
      validateStatus: () => true,
    });

    return { status: res.status, data: res.data };
  }

  /**
   * Import NDJSON via multipart form upload with SigV4 signing.
   * Native SigV4 signing for multipart form data doesn't work with the OpenSearch
   * service (the body hash never matches). We use curl --aws-sigv4 which handles
   * multipart signing correctly, but resolve credentials from the SDK chain first
   * so it works with SSO, instance roles, etc. — not just env vars.
   */
  private async signedMultipartImport(
    apiPath: string,
    ndjson: string
  ): Promise<{ status: number; data: any }> {
    if (!this.signer) {
      // Non-IAM auth (basic, cookie, none) — use axios directly
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', Buffer.from(ndjson, 'utf-8'), {
        filename: 'export.ndjson',
        contentType: 'application/x-ndjson',
      });
      const res = await this.http.post(apiPath, form, {
        headers: { ...form.getHeaders(), 'osd-xsrf': 'true' },
      });
      return { status: res.status, data: res.data };
    }

    // IAM auth — resolve credentials from SDK chain, then use curl for multipart signing
    const auth = this.config.auth as { type: 'iam'; region: string; service?: string };
    const credentials = await fromNodeProviderChain()();
    const url = new URL(apiPath, this.config.endpoint);
    const tmpFile = `/tmp/osd-migrate-import-${Date.now()}.ndjson`;
    const { writeFileSync, unlinkSync } = await import('fs');
    const { execSync } = await import('child_process');
    writeFileSync(tmpFile, ndjson);

    try {
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        ...(credentials.sessionToken ? { AWS_SESSION_TOKEN: credentials.sessionToken } : {}),
      };

      const result = execSync(
        `curl -s -X POST "${url.toString()}" ` +
        `--aws-sigv4 "aws:amz:${auth.region}:${auth.service ?? 'opensearch'}" ` +
        `--user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" ` +
        `${credentials.sessionToken ? '-H "x-amz-security-token: $AWS_SESSION_TOKEN"' : ''} ` +
        `-H "osd-xsrf: true" ` +
        `-F "file=@${tmpFile}"`,
        { encoding: 'utf-8', timeout: 60000, env }
      );
      return { status: 200, data: JSON.parse(result) };
    } catch (err: any) {
      return { status: 500, data: { error: err.message } };
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  // ── Public API methods ──────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const basePaths = this.config.workspaceId
      ? ['', '/_dashboards']
      : ['/_dashboards', '', '/api'];

    for (const basePath of basePaths) {
      try {
        const url = `${basePath}/api/saved_objects/_find`;
        log(`  Trying ${url}...`);
        const res = await this.signedGet(url, { type: 'dashboard', per_page: 1 });
        log(`  -> HTTP ${res.status}`);
        if (res.status === 200) {
          this.detectedBasePath = basePath;
          return { ok: true, message: `Connected (basePath: ${basePath || '/'}). Found ${res.data.total} dashboards.` };
        }
      } catch (err: any) {
        log(`  -> Error: ${err.message}`);
      }
    }

    try {
      const res = await this.signedGet('/');
      return { ok: false, message: `All API paths failed. Root returned HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 500)}` };
    } catch (err: any) {
      return { ok: false, message: `All API paths failed. Root error: ${err.message}` };
    }
  }

  async listDashboards(): Promise<Array<{ id: string; title: string }>> {
    const basePath = this.getBasePath();
    const dashboards: Array<{ id: string; title: string }> = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const res = await this.signedGet(`${basePath}/api/saved_objects/_find`, {
        type: 'dashboard', per_page: perPage, page,
      });

      if (res.status !== 200) {
        throw new Error(`Failed to list dashboards: HTTP ${res.status}`);
      }

      for (const obj of res.data.saved_objects) {
        dashboards.push({ id: obj.id, title: obj.attributes?.title ?? '(untitled)' });
      }

      if (dashboards.length >= res.data.total) break;
      page++;
    }

    return dashboards;
  }

  async exportDashboard(dashboardId: string): Promise<ExportResult> {
    const basePath = this.getBasePath();
    const apiPath = `${basePath}/api/saved_objects/_export`;
    const body = JSON.stringify({
      objects: [{ type: 'dashboard', id: dashboardId }],
      includeReferencesDeep: true,
    });

    log(`  POST ${apiPath}`);
    const res = await this.signedPost(apiPath, body, 'application/json');
    log(`  -> HTTP ${res.status}`);

    if (res.status === 200) {
      const ndjson: string = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      return this.parseNdjson(ndjson);
    }

    log('  POST failed, trying GET-based find as fallback...');
    return this.exportDashboardViaFind(dashboardId);
  }

  private async exportDashboardViaFind(dashboardId: string): Promise<ExportResult> {
    const basePath = this.getBasePath();
    const objects: SavedObject[] = [];
    const visited = new Set<string>();

    const fetchObject = async (type: string, id: string) => {
      const key = `${type}:${id}`;
      if (visited.has(key)) return;
      visited.add(key);

      const res = await this.signedGet(`${basePath}/api/saved_objects/${type}/${id}`);
      if (res.status !== 200) {
        log(`  Warning: Could not fetch ${type}/${id} (HTTP ${res.status})`);
        return;
      }

      const raw = res.data;
      const obj: SavedObject = {
        id: raw.id,
        type: raw.type,
        attributes: raw.attributes,
        references: raw.references ?? [],
      };
      if (raw.migrationVersion) obj.migrationVersion = raw.migrationVersion;
      objects.push(obj);

      if (raw.references) {
        for (const ref of raw.references) {
          await fetchObject(ref.type, ref.id);
        }
      }
    };

    log('  Fetching dashboard and dependencies via individual GET requests...');
    await fetchObject('dashboard', dashboardId);
    log(`  Fetched ${objects.length} objects.`);

    const lines = objects.map((obj) => JSON.stringify(obj));
    lines.push(JSON.stringify({ exportedCount: objects.length, missingRefCount: 0 }));
    const ndjson = lines.join('\n') + '\n';

    return { objects, ndjson };
  }

  async importNdjson(
    ndjson: string,
    options: { createNewCopies?: boolean; overwrite?: boolean; dataSourceId?: string } = {}
  ): Promise<{
    success: boolean;
    successCount: number;
    errors: Array<{ id: string; type: string; error: { type: string; message: string } }>;
  }> {
    const basePath = this.getBasePath();
    const params = new URLSearchParams();
    if (options.createNewCopies) params.set('createNewCopies', 'true');
    if (options.overwrite) params.set('overwrite', 'true');
    if (options.dataSourceId) params.set('dataSourceId', options.dataSourceId);

    const queryString = params.toString();
    const apiPath = `${basePath}/api/saved_objects/_import${queryString ? '?' + queryString : ''}`;

    const res = await this.signedMultipartImport(apiPath, ndjson);

    if (res.status !== 200) {
      throw new Error(`Import failed: HTTP ${res.status} - ${JSON.stringify(res.data)}`);
    }

    // Handle API returning 200 with an error body (e.g., conflicting query params)
    if (res.data.statusCode && res.data.statusCode >= 400) {
      throw new Error(`Import failed: ${res.data.message ?? JSON.stringify(res.data)}`);
    }

    return {
      success: res.data.success ?? false,
      successCount: res.data.successCount ?? 0,
      errors: res.data.errors ?? [],
    };
  }

  async getSavedObject(type: string, id: string): Promise<SavedObject | null> {
    const basePath = this.getBasePath();
    const res = await this.signedGet(`${basePath}/api/saved_objects/${type}/${id}`);
    if (res.status === 404 || res.status === 403) return null;
    if (res.status !== 200) {
      throw new Error(`Failed to get ${type}/${id}: HTTP ${res.status}`);
    }
    return res.data as SavedObject;
  }

  async listWorkspaces(): Promise<Array<{ id: string; name: string; description?: string }>> {
    const basePath = this.detectedBasePath;
    const res = await this.signedPost(`${basePath}/api/workspaces/_list`, '{}', 'application/json');

    if (res.status === 200) {
      const workspaces = res.data.result?.workspaces ?? res.data.workspaces ?? [];
      return workspaces.map((ws: any) => ({
        id: ws.id,
        name: ws.name,
        description: ws.description,
      }));
    }

    if (res.status === 403 || res.status === 404) {
      log('  Workspace list API returned ' + res.status + ', trying saved_objects fallback...');
      const fallback = await this.signedGet(`${basePath}/api/saved_objects/_find`, {
        type: 'workspace', per_page: 100,
      });
      if (fallback.status === 200 && fallback.data.saved_objects?.length > 0) {
        return fallback.data.saved_objects.map((obj: any) => ({
          id: obj.id,
          name: obj.attributes?.name ?? '(untitled)',
          description: obj.attributes?.description,
        }));
      }
    }

    return [];
  }

  async createWorkspace(
    name: string,
    description?: string,
    features?: string[]
  ): Promise<{ id: string }> {
    const basePath = this.detectedBasePath;
    const body = JSON.stringify({
      attributes: {
        name,
        description: description ?? '',
        features: features ?? ['use-case-all'],
      },
    });

    const res = await this.signedPost(`${basePath}/api/workspaces`, body, 'application/json');

    if (res.status === 403 || (res.data?.success === false && res.data?.error?.includes?.('permission'))) {
      const errorMsg = res.data?.error ?? `HTTP ${res.status}`;
      throw new Error(
        `Workspace creation failed due to insufficient permissions: ${errorMsg}\n` +
        `  Your IAM identity may not be configured as a dashboard admin on this OpenSearch UI application.\n` +
        `  To fix: add your IAM identity as admin via the AWS console (OpenSearch Service → Applications → your app → Admin settings)\n` +
        `  Or via CLI: aws opensearch update-application --id <app-id> --app-configs '[{"key":"opensearchDashboards.dashboardAdmin.users","value":"[\\"<your-arn>\\"]"}]'`
      );
    }

    if (res.status !== 200) {
      throw new Error(`Failed to create workspace: HTTP ${res.status} - ${JSON.stringify(res.data)}`);
    }

    const id = res.data.result?.id ?? res.data.id;
    if (!id) {
      const errorMsg = res.data?.error ?? JSON.stringify(res.data);
      if (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('permission')) {
        throw new Error(
          `Workspace creation failed: ${errorMsg}\n` +
          `  Your IAM identity may not be configured as a dashboard admin on this OpenSearch UI application.\n` +
          `  To fix: add your IAM identity as admin via the AWS console (OpenSearch Service → Applications → your app → Admin settings)`
        );
      }
      throw new Error(`Workspace created but no ID returned: ${JSON.stringify(res.data)}`);
    }
    return { id };
  }

  async listDataSources(workspaceId?: string): Promise<Array<{ id: string; title: string }>> {
    const basePath = workspaceId
      ? `${this.detectedBasePath}/w/${workspaceId}`
      : this.detectedBasePath;

    const res = await this.signedGet(`${basePath}/api/saved_objects/_find`, {
      type: 'data-source', per_page: 100,
    });

    if (res.status !== 200) {
      throw new Error(`Failed to list data sources: HTTP ${res.status}`);
    }

    return (res.data.saved_objects ?? []).map((obj: any) => ({
      id: obj.id,
      title: obj.attributes?.title ?? obj.attributes?.dataSourceEngineType ?? '(untitled)',
    }));
  }

  async validateIndexPatterns(
      patterns: string[],
      dataSourceId: string
    ): Promise<Array<{ pattern: string; matched: boolean; indices?: string[] }>> {
      const ds = await this.resolveDataSourceEndpoint(dataSourceId);
      if (!ds) {
        log('  Could not retrieve data source endpoint. Skipping index validation.');
        return patterns.map((p) => ({ pattern: p, matched: false }));
      }

      log(`  Data source endpoint: ${ds.endpoint}`);

      let allIndices: string[] = [];
      try {
        const result = await this.curlDataSource(ds, '_cat/indices?format=json&h=index');
        const parsed = JSON.parse(result);
        if (!Array.isArray(parsed)) {
          log(`  Data source returned non-array response (possibly a permissions error). Skipping index validation.`);
          return patterns.map((p) => ({ pattern: p, matched: false }));
        }
        allIndices = parsed.map((i: any) => i.index as string);
      } catch (err: any) {
        log(`  Could not fetch indices from data source: ${err.message}`);
        return patterns.map((p) => ({ pattern: p, matched: false }));
      }

      const results: Array<{ pattern: string; matched: boolean; indices?: string[] }> = [];
      for (const pattern of patterns) {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        const matched = allIndices.filter((idx) => regex.test(idx));
        results.push({
          pattern,
          matched: matched.length > 0,
          indices: matched.length > 0 ? matched.slice(0, 5) : undefined,
        });
      }

      return results;
    }
  /**
   * Resolve a data source's endpoint, region, signing service, and auth credentials.
   */
  private async resolveDataSourceEndpoint(
    dataSourceId: string
  ): Promise<{ endpoint: string; region: string; service: string; auth?: { username: string; password: string } } | null> {
    const dsObj = await this.getSavedObject('data-source', dataSourceId);
    if (!dsObj?.attributes?.endpoint) return null;

    const endpoint = dsObj.attributes.endpoint as string;
    const service = endpoint.includes('.aoss.amazonaws.com') ? 'aoss' : 'es';
    const region = endpoint.match(/\.([a-z]{2}-[a-z]+-\d)\./)?.[1];
    if (!region) return null;

    // Check if the data source has stored credentials
    const authObj = dsObj.attributes?.auth as Record<string, unknown> | undefined;
    const authType = authObj?.type as string | undefined;
    const credentials = authObj?.credentials as { username?: string; password?: string } | undefined;

    return {
      endpoint,
      region,
      service,
      ...(authType === 'username_password' && credentials?.username && credentials?.password
        ? { auth: { username: credentials.username, password: credentials.password } }
        : {}),
    };
  }

  /**
   * Execute a curl command against a data source endpoint.
   * Uses basic auth if the data source has stored credentials, otherwise IAM SigV4.
   */
  private async curlDataSource(
    ds: { endpoint: string; region: string; service: string; auth?: { username: string; password: string } },
    path: string
  ): Promise<string> {
    // Use basic auth if the data source has credentials
    if (ds.auth) {
      const { execSync } = await import('child_process');
      return execSync(
        `curl -s -X GET "${ds.endpoint}/${path}" ` +
        `-u "${ds.auth.username}:${ds.auth.password}"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
    }

    if (this.signer) {
      const { execSync } = await import('child_process');
      return execSync(
        `curl -s -X GET "${ds.endpoint}/${path}" ` +
        `--aws-sigv4 "aws:amz:${ds.region}:${ds.service}" ` +
        `--user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" ` +
        `-H "x-amz-security-token: $AWS_SESSION_TOKEN"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
    }
    const res = await axios.get(`${ds.endpoint}/${path}`);
    return JSON.stringify(res.data);
  }

  /**
   * Build the index pattern `fields` attribute by querying the target cluster's _mapping.
   * Resolves a wildcard pattern to a concrete index, fetches its mapping,
   * and transforms it into the format expected by index pattern saved objects.
   */
  async buildFieldsFromMapping(
    indexPattern: string,
    dataSourceId: string
  ): Promise<string | null> {
    const ds = await this.resolveDataSourceEndpoint(dataSourceId);
    if (!ds) return null;

    // Resolve wildcard to a concrete index
    let queryIndex = indexPattern;
    if (indexPattern.includes('*')) {
      try {
        const catResult = await this.curlDataSource(ds, '_cat/indices?format=json&h=index');
        const allIndices: string[] = JSON.parse(catResult).map((i: any) => i.index as string);
        const regex = new RegExp('^' + indexPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        const match = allIndices.find((idx) => regex.test(idx));
        if (!match) return null;
        queryIndex = match;
      } catch {
        return null;
      }
    }

    // Fetch mapping
    try {
      const mappingResult = await this.curlDataSource(ds, `${queryIndex}/_mapping`);
      const mappings = JSON.parse(mappingResult);

      // Collect fields from all matching indices (union)
      const fieldMap = new Map<string, { type: string; esTypes: string[] }>();
      for (const indexData of Object.values(mappings) as any[]) {
        const props = indexData.mappings?.properties ?? {};
        collectMappingFields(props, '', fieldMap);
      }

      // Build the fields array in index pattern format
      const fields = [
        // Always include meta fields
        { count: 0, name: '_id', type: 'string', esTypes: ['_id'], scripted: false, searchable: true, aggregatable: true, readFromDocValues: false },
        { count: 0, name: '_index', type: 'string', esTypes: ['_index'], scripted: false, searchable: true, aggregatable: true, readFromDocValues: false },
        { count: 0, name: '_score', type: 'number', scripted: false, searchable: false, aggregatable: false, readFromDocValues: false },
        { count: 0, name: '_source', type: '_source', esTypes: ['_source'], scripted: false, searchable: false, aggregatable: false, readFromDocValues: false },
        { count: 0, name: '_type', type: 'string', scripted: false, searchable: false, aggregatable: false, readFromDocValues: false },
      ];

      for (const [name, info] of fieldMap) {
        fields.push({
          count: 0,
          name,
          type: esTypeToFieldType(info.esTypes[0]),
          esTypes: info.esTypes,
          scripted: false,
          searchable: isSearchable(info.esTypes[0]),
          aggregatable: isAggregatable(info.esTypes[0]),
          readFromDocValues: isDocValues(info.esTypes[0]),
        });
      }

      return JSON.stringify(fields);
    } catch {
      return null;
    }
  }

  setWorkspace(workspaceId: string): void {
    this.config.workspaceId = workspaceId;
  }

  async associateDataSource(workspaceId: string, dataSourceId: string): Promise<void> {
    const basePath = this.detectedBasePath;
    const body = JSON.stringify({
      workspaceId,
      savedObjects: [{ type: 'data-source', id: dataSourceId }],
    });

    const res = await this.signedPost(`${basePath}/api/workspaces/_associate`, body, 'application/json');

    if (res.status !== 200 || res.data.success === false) {
      throw new Error(`Failed to associate data source: HTTP ${res.status} - ${JSON.stringify(res.data)}`);
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const basePath = this.detectedBasePath;
    const res = await this.signedDelete(`${basePath}/api/workspaces/${workspaceId}`);
    if (res.status !== 200 || res.data?.success === false) {
      throw new Error(`Failed to delete workspace ${workspaceId}: HTTP ${res.status} - ${JSON.stringify(res.data)}`);
    }
  }

  private getBasePath(): string {
    if (this.config.workspaceId) {
      return `${this.detectedBasePath}/w/${this.config.workspaceId}`;
    }
    return this.detectedBasePath;
  }

  private parseNdjson(ndjson: string): ExportResult {
    const lines = ndjson.trim().split('\n').filter(Boolean);
    const objects: SavedObject[] = [];
    let exportDetails: Record<string, unknown> | undefined;

    for (const line of lines) {
      const parsed = JSON.parse(line);
      if (parsed.exportedCount !== undefined || parsed.missingRefCount !== undefined) {
        exportDetails = parsed;
      } else {
        objects.push(parsed as SavedObject);
      }
    }

    return { objects, ndjson, exportDetails };
  }
}

// ── Helper functions for field mapping ─────────────────────────────────────

/**
 * Recursively collect fields from an OpenSearch mapping `properties` object.
 */
function collectMappingFields(
  props: Record<string, any>,
  prefix: string,
  fieldMap: Map<string, { type: string; esTypes: string[] }>
): void {
  for (const [name, value] of Object.entries(props)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    const esType = value.type ?? 'object';
    fieldMap.set(fullName, { type: esType, esTypes: [esType] });

    // Add keyword sub-fields (e.g. field.keyword)
    if (value.fields) {
      for (const [subName, subValue] of Object.entries(value.fields) as Array<[string, any]>) {
        const subType = subValue.type ?? 'keyword';
        fieldMap.set(`${fullName}.${subName}`, { type: subType, esTypes: [subType] });
      }
    }

    // Recurse into nested properties
    if (value.properties) {
      collectMappingFields(value.properties, fullName, fieldMap);
    }
  }
}

/**
 * Map an OpenSearch field type to the simplified type used by index patterns.
 */
function esTypeToFieldType(esType: string): string {
  const typeMap: Record<string, string> = {
    text: 'string',
    keyword: 'string',
    long: 'number',
    integer: 'number',
    short: 'number',
    byte: 'number',
    double: 'number',
    float: 'number',
    half_float: 'number',
    scaled_float: 'number',
    date: 'date',
    date_nanos: 'date',
    boolean: 'boolean',
    ip: 'ip',
    geo_point: 'geo_point',
    geo_shape: 'geo_shape',
    binary: 'attachment',
    nested: 'nested',
    object: 'object',
  };
  return typeMap[esType] ?? 'string';
}

function isSearchable(esType: string): boolean {
  const nonSearchable = new Set(['binary', 'object', 'nested']);
  return !nonSearchable.has(esType);
}

function isAggregatable(esType: string): boolean {
  // text fields are not aggregatable by default
  const nonAggregatable = new Set(['text', 'binary', 'object', 'nested']);
  return !nonAggregatable.has(esType);
}

function isDocValues(esType: string): boolean {
  // text and binary fields don't use doc_values by default
  const noDocValues = new Set(['text', 'binary', 'object', 'nested']);
  return !noDocValues.has(esType);
}
