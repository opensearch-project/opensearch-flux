#!/usr/bin/env node
/**
 * OpenSearch Flux MCP Server
 *
 * Exposes migration tools as MCP tools for AI agents (Kiro, Claude, etc.).
 * Run via: npx opensearch-flux-mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OSDClient } from './lib/client.js';
import { inspect } from './lib/inspector.js';
import { buildConnectionConfig, detectPlatformType, normalizeCookie } from './lib/config.js';
import {
  parseNdjsonFile,
  extractDataSourceIds,
  extractDataSourceDetails,
  stripDataSourcePrefixes,
  remapDataSources,
  stripDashboardDatasetBlocks,
  remapIndexPatterns,
  disableMissingFieldFilters,
} from './lib/repair.js';
import {
  validateAndSuggestIndexMappings,
  validateFieldCompatibility,
  rebuildIndexPatternFields,
} from './lib/validator.js';
import * as fs from 'fs';

const server = new McpServer({
  name: 'opensearch-flux',
  version: '0.1.0',
  description: 'OpenSearch dashboard migration tools. PREFERRED over CLI — call these tools directly for all migration operations. Auth defaults to IAM (auto-detects region and service from endpoint URL). Typical workflow: test_connection → list_dashboards → export_dashboard → inspect_ndjson → (repair tools) → create_workspace → import_ndjson.',
});

// ── Connection tools ────────────────────────────────────────────────────────

server.tool(
  'test_connection',
  'Test connectivity and authentication to an OpenSearch instance. START HERE — call this first before any other migration tool. Auth defaults to IAM; region and service are auto-detected from the endpoint URL.',
  {
    endpoint: z.string().describe('OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam').describe('Authentication type'),
    region: z.string().optional().describe('AWS region (auto-detected from URL if omitted)'),
    service: z.string().optional().describe('AWS signing service (auto-detected from URL if omitted)'),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools — the tool auto-prefixes the cookie name)'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    const client = new OSDClient(config);
    const result = await client.testConnection();
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, _hint: 'Connection verified. Next: call list_dashboards to find dashboard IDs, then export_dashboard.' }) }] };
  }
);

server.tool(
  'list_dashboards',
  'List all dashboards on an OpenSearch instance. Use after test_connection to find dashboard IDs for export.',
  {
    endpoint: z.string().describe('OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    workspaceId: z.string().optional().describe('Workspace ID to scope the query'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    if (params.workspaceId) config.workspaceId = params.workspaceId;
    const client = new OSDClient(config);
    await client.testConnection();
    const dashboards = await client.listDashboards();
    return { content: [{ type: 'text' as const, text: JSON.stringify(dashboards) }] };
  }
);

server.tool(
  'list_data_sources',
  'List available data sources on an OpenSearch instance',
  {
    endpoint: z.string().describe('OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    workspaceId: z.string().optional(),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    const client = new OSDClient(config);
    await client.testConnection();
    const dataSources = await client.listDataSources(params.workspaceId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(dataSources) }] };
  }
);

// ── Export tools ─────────────────────────────────────────────────────────────

server.tool(
  'export_dashboard',
  'Export a dashboard and all its dependencies as NDJSON. Use after list_dashboards. Next step: inspect_ndjson.',
  {
    endpoint: z.string().describe('Source OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    workspaceId: z.string().optional(),
    dashboardId: z.string().describe('Dashboard ID to export'),
    outputPath: z.string().default('./migration/export.ndjson').describe('Output file path'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    if (params.workspaceId) config.workspaceId = params.workspaceId;
    const client = new OSDClient(config);
    await client.testConnection();

    const result = await client.exportDashboard(params.dashboardId);
    const dir = params.outputPath.substring(0, params.outputPath.lastIndexOf('/'));
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(params.outputPath, result.ndjson, 'utf-8');

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          objectCount: result.objects.length,
          filePath: params.outputPath,
          exportDetails: result.exportDetails,
          _hint: 'Export complete. Next: call inspect_ndjson on the exported file, then create_workspace and import_ndjson.',
        }),
      }],
    };
  }
);

// ── Inspection tools ─────────────────────────────────────────────────────────

server.tool(
  'inspect_ndjson',
  'Inspect an NDJSON export file for issues (missing references, duplicates, type renderability, permissions gaps). Use after export_dashboard. Next: apply repair tools if needed, then create_workspace and import_ndjson.',
  {
    filePath: z.string().describe('Path to NDJSON file'),
    sourceEndpoint: z.string().optional().describe('Source endpoint URL (for platform-aware checks)'),
    targetEndpoint: z.string().optional().describe('Target endpoint URL (for platform-aware checks)'),
  },
  async (params) => {
    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const objects = parseNdjsonFile(ndjson);

    // If no sourceEndpoint provided, try to detect from data-source objects in the NDJSON
    let sourcePlatform = params.sourceEndpoint ? detectPlatformType(params.sourceEndpoint) : undefined;
    if (!sourcePlatform || sourcePlatform === 'unknown') {
      sourcePlatform = undefined;
      const dsDetails = extractDataSourceDetails(objects);
      if (dsDetails.length > 0 && dsDetails[0].endpoint) {
        const detected = detectPlatformType(dsDetails[0].endpoint);
        if (detected !== 'unknown') sourcePlatform = detected;
      }
    }

    const targetPlatform = params.targetEndpoint ? detectPlatformType(params.targetEndpoint) : undefined;
    const context = (sourcePlatform || (targetPlatform && targetPlatform !== 'unknown')) ? {
      ...(sourcePlatform ? { sourcePlatform } : {}),
      ...(targetPlatform && targetPlatform !== 'unknown' ? { targetPlatform } : {}),
    } : undefined;

    const report = inspect(objects, context);
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] };
  }
);

server.tool(
  'extract_data_source_info',
  'Extract data source IDs and details from an NDJSON export',
  {
    filePath: z.string().describe('Path to NDJSON file'),
  },
  async (params) => {
    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const objects = parseNdjsonFile(ndjson);
    const ids = extractDataSourceIds(objects);
    const details = extractDataSourceDetails(objects);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ dataSourceIds: [...ids], dataSourceDetails: details }),
      }],
    };
  }
);

server.tool(
  'validate_index_patterns',
  'Validate index patterns against a target data source cluster',
  {
    endpoint: z.string().describe('Target OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    dataSourceId: z.string().describe('Target data source ID'),
    filePath: z.string().describe('Path to NDJSON file'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    const client = new OSDClient(config);
    await client.testConnection();
    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const objects = parseNdjsonFile(ndjson);
    const patterns = objects.filter(o => o.type === 'index-pattern').map(o => o.attributes?.title as string).filter(Boolean);
    const results = await client.validateIndexPatterns(patterns, params.dataSourceId);
    return { content: [{ type: 'text' as const, text: JSON.stringify(results) }] };
  }
);

// ── Repair tools ─────────────────────────────────────────────────────────────

server.tool(
  'strip_data_source_prefixes',
  'Strip data source ID prefixes from object IDs and remove data-source objects',
  {
    filePath: z.string().describe('Path to input NDJSON file'),
    outputPath: z.string().describe('Path to write cleaned NDJSON'),
  },
  async (params) => {
    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const objects = parseNdjsonFile(ndjson);
    const dsIds = extractDataSourceIds(objects);
    const cleaned = stripDataSourcePrefixes(ndjson, dsIds);
    fs.writeFileSync(params.outputPath, cleaned, 'utf-8');
    const cleanedCount = cleaned.trim().split('\n').length;
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ outputPath: params.outputPath, objectCount: cleanedCount, strippedPrefixes: [...dsIds] }) }],
    };
  }
);

server.tool(
  'remap_data_sources',
  'Remap all data source references (including nested JSON) to a target data source ID',
  {
    filePath: z.string().describe('Path to input NDJSON file'),
    outputPath: z.string().describe('Path to write remapped NDJSON'),
    targetDataSourceId: z.string().describe('Target data source ID to remap to'),
  },
  async (params) => {
    let ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const objects = parseNdjsonFile(ndjson);
    const sourceIds = extractDataSourceIds(objects);
    ndjson = remapDataSources(ndjson, sourceIds, params.targetDataSourceId);
    fs.writeFileSync(params.outputPath, ndjson, 'utf-8');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ outputPath: params.outputPath, remappedFrom: [...sourceIds], remappedTo: params.targetDataSourceId }) }],
    };
  }
);

server.tool(
  'strip_dashboard_dataset',
  'Strip stale dataset blocks from dashboard searchSourceJSON',
  {
    filePath: z.string().describe('Path to input NDJSON file'),
    outputPath: z.string().describe('Path to write cleaned NDJSON'),
  },
  async (params) => {
    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const cleaned = stripDashboardDatasetBlocks(ndjson);
    fs.writeFileSync(params.outputPath, cleaned, 'utf-8');
    return { content: [{ type: 'text' as const, text: JSON.stringify({ outputPath: params.outputPath }) }] };
  }
);

server.tool(
  'remap_index_patterns',
  'Remap index pattern names in NDJSON and optionally rebuild fields from target mapping',
  {
    filePath: z.string().describe('Path to input NDJSON file'),
    outputPath: z.string().describe('Path to write remapped NDJSON'),
    mappings: z.record(z.string(), z.string()).describe('Map of old pattern name to new pattern name'),
    endpoint: z.string().optional().describe('Target endpoint (for field rebuild)'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    dataSourceId: z.string().optional().describe('Target data source ID (for field rebuild)'),
  },
  async (params) => {
    let ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const mappingMap = new Map<string, string>(Object.entries(params.mappings));
    ndjson = remapIndexPatterns(ndjson, mappingMap);

    if (params.endpoint && params.dataSourceId) {
      const config = buildConnectionConfig(params.endpoint, params);
      const client = new OSDClient(config);
      await client.testConnection();
      ndjson = await rebuildIndexPatternFields(ndjson, mappingMap, client, params.dataSourceId);
    }

    fs.writeFileSync(params.outputPath, ndjson, 'utf-8');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ outputPath: params.outputPath, remappedPatterns: Object.fromEntries(mappingMap) }) }],
    };
  }
);

server.tool(
  'disable_missing_field_filters',
  'Disable visualization filters that reference fields missing from the target index',
  {
    filePath: z.string().describe('Path to input NDJSON file'),
    outputPath: z.string().describe('Path to write cleaned NDJSON'),
  },
  async (params) => {
    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const cleaned = disableMissingFieldFilters(ndjson);
    fs.writeFileSync(params.outputPath, cleaned, 'utf-8');
    return { content: [{ type: 'text' as const, text: JSON.stringify({ outputPath: params.outputPath }) }] };
  }
);

// ── Workspace tools ──────────────────────────────────────────────────────────

server.tool(
  'list_workspaces',
  'List workspaces on an OpenSearch instance',
  {
    endpoint: z.string().describe('OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    const client = new OSDClient(config);
    await client.testConnection();
    const workspaces = await client.listWorkspaces();
    return { content: [{ type: 'text' as const, text: JSON.stringify(workspaces) }] };
  }
);

server.tool(
  'create_workspace',
  'Create a new workspace on the target instance. Use before import_ndjson. Pass dataSourceId to auto-associate.',
  {
    endpoint: z.string().describe('OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    name: z.string().describe('Workspace name'),
    type: z.enum(['analytics', 'essentials', 'observability', 'security-analytics', 'search']).default('analytics'),
    description: z.string().optional(),
    dataSourceId: z.string().optional().describe('Data source ID to associate with the workspace'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    const client = new OSDClient(config);
    await client.testConnection();

    const featureMap: Record<string, string[]> = {
      analytics: ['use-case-all'],
      essentials: ['use-case-essentials'],
      observability: ['use-case-observability'],
      'security-analytics': ['use-case-security-analytics'],
      search: ['use-case-search'],
    };

    const ws = await client.createWorkspace(params.name, params.description, featureMap[params.type]);

    if (params.dataSourceId) {
      await client.associateDataSource(ws.id, params.dataSourceId);
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: ws.id, name: params.name, type: params.type, dataSourceAssociated: !!params.dataSourceId }) }],
    };
  }
);

// ── Import tool ──────────────────────────────────────────────────────────────

server.tool(
  'import_ndjson',
  'Import an NDJSON file to a target OpenSearch instance. FINAL STEP — use after export, inspect, repair, and create_workspace.',
  {
    endpoint: z.string().describe('Target OpenSearch endpoint URL'),
    auth: z.enum(['none', 'basic', 'iam', 'cookie']).default('iam'),
    region: z.string().optional(),
    service: z.string().optional(),
    username: z.string().optional().describe('Basic auth username'),
    password: z.string().optional().describe('Basic auth password'),
    cookie: z.string().optional().describe('Session cookie value (just paste the value from browser dev tools)'),
    workspaceId: z.string().optional().describe('Target workspace ID'),
    filePath: z.string().describe('Path to NDJSON file to import'),
    createNewCopies: z.boolean().default(true).describe('Generate new IDs for all objects'),
    overwrite: z.boolean().default(false).describe('Overwrite existing objects'),
  },
  async (params) => {
    const config = buildConnectionConfig(params.endpoint, params);
    if (params.workspaceId) config.workspaceId = params.workspaceId;
    const client = new OSDClient(config);
    await client.testConnection();

    const ndjson = fs.readFileSync(params.filePath, 'utf-8');
    const result = await client.importNdjson(ndjson, {
      createNewCopies: params.createNewCopies,
      overwrite: params.overwrite,
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  }
);

// ── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
