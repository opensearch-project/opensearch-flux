#!/usr/bin/env node
import { Command } from 'commander';
import { OSDClient } from './lib/client.js';
import { inspect, InspectionContext } from './lib/inspector.js';
import { buildConnectionConfig, WORKSPACE_TYPES, detectPlatformType } from './lib/config.js';
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
import * as path from 'path';
import * as readline from 'readline';
import { setLogOutput } from './lib/logger.js';
setLogOutput(console.log);

/**
 * Prompt the user for input and return their answer.
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask a yes/no confirmation question. Returns true if user confirms.
 */
async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/n): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

const program = new Command();

program
  .name('osd-migrate')
  .description(
    'Migrate saved objects between OpenSearch Dashboards instances.\n\n' +
    'Authentication:\n' +
    '  For IAM auth (--auth iam), this tool uses the standard AWS credential chain.\n' +
    '  Configure credentials using any of these methods:\n' +
    '    - AWS SSO:          aws sso login --profile <profile>\n' +
    '    - Access keys:      aws configure\n' +
    '    - Environment vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY\n' +
    '    - Instance role:    automatic on EC2/ECS/Lambda\n' +
    '  No credential flags are needed — just ensure your AWS credentials are configured.'
  )
  .version('0.1.0');

// ── export command ──────────────────────────────────────────────────────────
program
  .command('export')
  .description('Export a dashboard and all its dependencies from a source instance')
  .requiredOption('--source <endpoint>', 'Source OSD endpoint URL')
  .option('--source-workspace <id>', 'Source workspace ID')
  .option('--auth <type>', 'Auth type: iam, basic, none, cookie (default: iam)', 'iam')
  .option('--username <user>', 'Basic auth username')
  .option('--password <pass>', 'Basic auth password')
  .option('--cookie <cookie>', 'Session cookie string (from browser dev tools, for SAML/Cognito auth)')
  .option('--region <region>', 'AWS region (auto-detected from endpoint URL if omitted)')
  .option('--service <service>', 'AWS signing service name: es or aoss (default: auto-detect from URL)')
  .option('--dashboard <id>', 'Dashboard ID to export (omit to list available dashboards)')
  .option('--out <dir>', 'Output directory', './migration')
  .action(async (opts) => {
    const config = buildConnectionConfig(opts.source, opts);
    if (opts.sourceWorkspace) config.workspaceId = opts.sourceWorkspace;

    const client = new OSDClient(config);

    console.log(`Connecting to ${config.endpoint}...`);
    const conn = await client.testConnection();
    if (!conn.ok) {
      console.error(`Connection failed: ${conn.message}`);
      process.exit(1);
    }
    console.log(conn.message);

    let dashboardId = opts.dashboard;
    if (!dashboardId) {
      console.log('\nAvailable dashboards:');
      const dashboards = await client.listDashboards();
      if (dashboards.length === 0) {
        console.log('  No dashboards found.');
        process.exit(0);
      }
      for (const d of dashboards) {
        console.log(`  ${d.id}  ${d.title}`);
      }
      console.log('\nRe-run with --dashboard <id> to export one.');
      process.exit(0);
    }

    console.log(`\nExporting dashboard ${dashboardId} with all dependencies...`);
    const result = await client.exportDashboard(dashboardId);
    console.log(`Exported ${result.objects.length} objects.`);

    // Write to disk
    const outDir = path.resolve(opts.out);
    fs.mkdirSync(outDir, { recursive: true });

    const ndjsonPath = path.join(outDir, 'export.ndjson');
    fs.writeFileSync(ndjsonPath, result.ndjson, 'utf-8');
    console.log(`Saved to ${ndjsonPath}`);

    // Run inspection
    console.log('\nRunning inspection...');
    const sourcePlatform = detectPlatformType(opts.source);
    const context = sourcePlatform !== 'unknown' ? { sourcePlatform } : undefined;
    const report = inspect(result.objects, context);
    const reportPath = path.join(outDir, 'inspection-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    printReport(report);
    console.log(`\nInspection report saved to ${reportPath}`);
  });

// ── inspect command ─────────────────────────────────────────────────────────
program
  .command('inspect')
  .description('Inspect an NDJSON export file for issues')
  .requiredOption('--file <path>', 'Path to NDJSON file')
  .option('--source <endpoint>', 'Source endpoint URL (for platform-aware checks)')
  .option('--target <endpoint>', 'Target endpoint URL (for platform-aware checks)')
  .action(async (opts) => {
    const ndjson = fs.readFileSync(opts.file, 'utf-8');
    const objects = parseNdjsonFile(ndjson);

    console.log(`Inspecting ${objects.length} objects from ${opts.file}...\n`);
    // Detect platforms from explicit flags, falling back to data-source objects in the NDJSON
    let src = opts.source ? detectPlatformType(opts.source) : undefined;
    if (!src || src === 'unknown') {
      src = undefined;
      const dsDetails = extractDataSourceDetails(objects);
      if (dsDetails.length > 0 && dsDetails[0].endpoint) {
        const detected = detectPlatformType(dsDetails[0].endpoint);
        if (detected !== 'unknown') src = detected;
      }
    }
    const tgt = opts.target ? detectPlatformType(opts.target) : undefined;
    const context = (src || (tgt && tgt !== 'unknown')) ? {
      ...(src ? { sourcePlatform: src } : {}),
      ...(tgt && tgt !== 'unknown' ? { targetPlatform: tgt } : {}),
    } : undefined;
    const report = inspect(objects, context);
    printReport(report);

    const reportPath = opts.file.replace(/\.ndjson$/, '') + '-inspection.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\nReport saved to ${reportPath}`);
  });

// ── import command ──────────────────────────────────────────────────────────



program
  .command('import')
  .description('Import an NDJSON file to a target instance')
  .requiredOption('--target <endpoint>', 'Target OSD endpoint URL')
  .option('--source <endpoint>', 'Source OSD endpoint URL (for data source validation — verifies the target data source points to the source cluster)')
  .option('--target-workspace <id>', 'Target workspace ID (omit to list and choose, "new" to create)')
  .option('--auth <type>', 'Auth type: iam, basic, none, cookie (default: iam)', 'iam')
  .option('--username <user>', 'Basic auth username')
  .option('--password <pass>', 'Basic auth password')
  .option('--cookie <cookie>', 'Session cookie string (from browser dev tools, for SAML/Cognito auth)')
  .option('--region <region>', 'AWS region (auto-detected from endpoint URL if omitted)')
  .option('--service <service>', 'AWS signing service name: es or aoss (default: auto-detect from URL)')
  .option('--data-source-id <id>', 'Target data source ID to remap references and associate with workspace')
  .requiredOption('--file <path>', 'Path to NDJSON file to import')
  .option('--create-new-copies', 'Generate new IDs for all objects', false)
  .option('--overwrite', 'Overwrite existing objects with same ID', false)
  .option('--workspace-name <name>', 'Name for new workspace (used with --target-workspace new)')
  .option('--workspace-type <type>', 'Workspace type: analytics, essentials, observability, security-analytics, search (default: analytics)', 'analytics')
  .option('-y, --yes', 'Skip confirmation prompts (for non-interactive/agent use)', false)
  .option('--json', 'Output results as JSON (for agent/programmatic use)', false)
  .option('--remap-index-pattern <mapping...>', 'Remap index patterns: "old-pattern*=new-pattern*" (repeatable)')
  .action(async (opts) => {
    const config = buildConnectionConfig(opts.target, opts);
    const client = new OSDClient(config);

    console.log(`Connecting to ${config.endpoint}...`);
    const conn = await client.testConnection();
    if (!conn.ok) {
      console.error(`Connection failed: ${conn.message}`);
      process.exit(1);
    }
    console.log(conn.message);

    // ── Step 1: Data source discovery (required for migration) ──
    let ndjson = fs.readFileSync(opts.file, 'utf-8');
    const objects = parseNdjsonFile(ndjson);

    // Collect source data source IDs from references and embedded attributes
    const sourceDataSourceIds = extractDataSourceIds(objects);

    // Extract source data source details from the export
    const sourceDataSources = extractDataSourceDetails(objects);

    let targetDataSourceId = opts.dataSourceId;

    // ── Platform detection and enhanced inspection ──
    const targetPlatform = detectPlatformType(opts.target);
    // Try to detect source platform from data-source objects' endpoints
    let sourcePlatform = sourceDataSources.length > 0 && sourceDataSources[0].endpoint
      ? detectPlatformType(sourceDataSources[0].endpoint)
      : undefined;

    const inspectionContext: InspectionContext = {
      ...(sourcePlatform ? { sourcePlatform } : {}),
      ...(targetPlatform !== 'unknown' ? { targetPlatform } : {}),
    };

    const inspectionReport = inspect(objects, Object.keys(inspectionContext).length > 0 ? inspectionContext : undefined);

    // Display type renderability warnings
    if (inspectionReport.nonRenderableTypeSummary) {
      console.log('\n=== Type Renderability Warnings ===');
      console.log('The following object types may not render in the OpenSearch UI frontend:');
      for (const [type, count] of Object.entries(inspectionReport.nonRenderableTypeSummary)) {
        console.log(`  ⚠ ${type}: ${count} object(s)`);
      }
      console.log('These objects will be stored by the backend API but may not be visible in the UI.');
    }

    // Display permissions warning
    const permissionsIssue = inspectionReport.issues.find((i) => i.type === 'MISSING_PERMISSIONS');
    if (permissionsIssue) {
      console.log(`\n⚠ ${permissionsIssue.message}`);
      if (permissionsIssue.remediation) console.log(`  -> ${permissionsIssue.remediation}`);
    }

    // Parse explicit index pattern remappings from --remap-index-pattern flags
    let indexPatternMappings = new Map<string, string>();
    if (opts.remapIndexPattern) {
      for (const mapping of opts.remapIndexPattern as string[]) {
        const [oldP, newP] = mapping.split('=');
        if (oldP && newP) {
          indexPatternMappings.set(oldP, newP);
        } else {
          console.error(`Invalid index pattern mapping: "${mapping}". Expected format: "old-pattern*=new-pattern*"`);
          process.exit(1);
        }
      }
      if (indexPatternMappings.size > 0) {
        console.log(`\nExplicit index pattern remappings: ${indexPatternMappings.size}`);
        for (const [old, newP] of indexPatternMappings) {
          console.log(`  ${old} -> ${newP}`);
        }
      }
    }

    if (sourceDataSourceIds.size > 0 && !targetDataSourceId) {
      console.log('\n=== Data Source Mapping Required ===');
      console.log('The exported objects reference data sources that need to be mapped to a target data source.');

      if (sourceDataSources.length > 0) {
        console.log('\nSource data sources (from export):');
        for (const ds of sourceDataSources) {
          console.log(`  ${ds.id}  ${ds.title}${ds.endpoint ? `  (${ds.endpoint})` : ''}`);
        }
      } else {
        console.log(`\nSource data source IDs referenced: ${[...sourceDataSourceIds].join(', ')}`);
      }

      console.log('\nLooking up available data sources on target...');
      const targetDataSources = await client.listDataSources();

      if (targetDataSources.length > 0) {
        console.log(`\nAvailable data sources on target:`);
        for (const ds of targetDataSources) {
          console.log(`  ${ds.id}  ${ds.title}`);
        }

        // Try to suggest a match based on title similarity
        if (sourceDataSources.length > 0) {
          for (const targetDs of targetDataSources) {
            for (const sourceDs of sourceDataSources) {
              const srcTitle = sourceDs.title.toLowerCase();
              const tgtTitle = targetDs.title.toLowerCase();
              if (srcTitle === tgtTitle || srcTitle.includes(tgtTitle) || tgtTitle.includes(srcTitle)) {
                console.log(`\n  Suggested match: source "${sourceDs.title}" -> target "${targetDs.title}" (${targetDs.id})`);
              }
            }
          }
        }

        console.log('\nRe-run with: --data-source-id <target-data-source-id>');
      } else {
        console.log('\nNo data sources found on target.');
        console.log('You need to register a data source on the target first, then re-run with --data-source-id.');
      }

      if (opts.json) {
        console.log(JSON.stringify({
          status: 'data_source_required',
          sourceDataSources,
          targetDataSources: targetDataSources.length > 0 ? targetDataSources : [],
        }));
      }
      process.exit(0);
    }

    // ── Step 1b: Pre-flight data source checks ──
    if (targetPlatform === 'opensearch-ui' && !targetDataSourceId) {
      // Check if any data sources exist on the target
      console.log('\nChecking for data sources on target OpenSearch UI instance...');
      const targetDataSources = await client.listDataSources();
      if (targetDataSources.length === 0) {
        console.error('\n⚠ No data sources found on the target OpenSearch UI instance.');
        console.error('  A data source must be registered before migration. Steps:');
        console.error('  1. Open the OpenSearch UI console');
        console.error('  2. Go to Management → Data Sources → Create data source');
        console.error('  3. Register your AOS domain or cluster as a data source');
        console.error('  4. Re-run with --data-source-id <id>');
        process.exit(1);
      }

      // AOS/AOSS export (no source data source refs) — require user to pick a target data source
      if (sourceDataSourceIds.size === 0) {
        const srcPlatform = opts.source ? detectPlatformType(opts.source) : undefined;
        const platformLabel = srcPlatform === 'aoss' ? 'AOSS collection' : 'AOS domain';
        console.log(`\n=== Data Source Required (${srcPlatform === 'aoss' ? 'AOSS' : 'AOS'} → OpenSearch UI) ===`);
        console.log(`The source is an ${platformLabel} (no data source references in export).`);
        console.log('OpenSearch UI requires a data source for objects to query data.\n');
        console.log('Available data sources on target:');
        for (const ds of targetDataSources) {
          // Fetch endpoint for each data source to help user decide
          const dsObj = await client.getSavedObject('data-source', ds.id);
          const dsEndpoint = dsObj?.attributes?.endpoint as string | undefined;
          console.log(`  ${ds.id}  ${ds.title}${dsEndpoint ? `  (${dsEndpoint})` : ''}`);
        }
        console.log('\nPlease choose a target data source and re-run with:');
        console.log('  --data-source-id <target-data-source-id>');
        console.log('\nIf none of these point to your source data, register a new data source first.');

        if (opts.json) {
          console.log(JSON.stringify({
            status: 'data_source_required',
            message: `${platformLabel} export has no data source references. A target data source must be specified.`,
            targetDataSources,
          }));
        }
        process.exit(0);
      }
    }

    let targetDsTitle: string | undefined;
    let targetDsEndpoint: string | undefined;
    let sourceMatchesTargetDs = false;

    if (targetDataSourceId) {
      // Verify the data source exists and is reachable
      console.log(`\nVerifying data source ${targetDataSourceId}...`);
      const dsObj = await client.getSavedObject('data-source', targetDataSourceId);
      if (!dsObj) {
        console.error(`\n✗ Data source '${targetDataSourceId}' not found on target.`);
        console.error('  Run without --data-source-id to see available data sources.');
        process.exit(1);
      }
      targetDsTitle = (dsObj.attributes?.title as string) ?? '(untitled)';
      targetDsEndpoint = dsObj.attributes?.endpoint as string;
      console.log(`  ✓ Data source found: "${targetDsTitle}"${targetDsEndpoint ? ` (${targetDsEndpoint})` : ''}`);

      // Check if the target data source points to the source cluster
      const sourceEndpoint = opts.source
        ?? (sourceDataSources.length > 0 ? sourceDataSources[0].endpoint : undefined);

      if (sourceEndpoint && targetDsEndpoint) {
        // Normalize endpoints for comparison (strip trailing slashes, /_dashboards, protocol)
        const normalize = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/_dashboards\/?$/, '').replace(/\/+$/, '');
        if (normalize(targetDsEndpoint) === normalize(sourceEndpoint)) {
          sourceMatchesTargetDs = true;
          console.log(`  ✓ Data source points to the source cluster — index patterns are guaranteed to exist.`);
        } else {
          console.log(`  ⚠ Data source endpoint (${targetDsEndpoint}) differs from source (${sourceEndpoint}).`);
          console.log(`    Index patterns from the source may not exist on this data source's cluster.`);
          // Warn if source and data source are on different platforms entirely
          const srcPlatform = detectPlatformType(sourceEndpoint);
          const dsPlatform = detectPlatformType(targetDsEndpoint);
          if (srcPlatform !== dsPlatform && srcPlatform !== 'unknown' && dsPlatform !== 'unknown') {
            console.log(`  ⚠ Platform mismatch: source is ${srcPlatform.toUpperCase()} but data source points to ${dsPlatform.toUpperCase()}.`);
            console.log(`    The migrated dashboard will query ${dsPlatform.toUpperCase()}, not the ${srcPlatform.toUpperCase()} collection it was exported from.`);
            console.log(`    To fix: register the source endpoint as a data source on the target, then re-run with that data source ID.`);
          }
        }
      }
    }

    // ── Step 2: Workspace discovery / creation ──
    let workspaceId = opts.targetWorkspace;
    if (!workspaceId) {
      console.log('\nChecking for workspaces...');
      const workspaces = await client.listWorkspaces();

      if (workspaces.length > 0) {
        console.log(`\nWorkspaces enabled. Found ${workspaces.length} workspace(s):`);
        for (const ws of workspaces) {
          console.log(`  ${ws.id}  ${ws.name}${ws.description ? ` - ${ws.description}` : ''}`);
        }
        console.log('\nTo import into an existing workspace, re-run with:');
        console.log('  --target-workspace <id>');
        console.log('\nTo create a new workspace, re-run with:');
        console.log('  --target-workspace new --workspace-name "My Workspace" --workspace-type <type>');
        console.log('  Workspace types: analytics (default), essentials, observability, security-analytics, search');
        process.exit(0);
      } else {
        console.log('No workspaces found (workspaces may not be enabled). Importing globally.');
      }
    }

    if (workspaceId === 'new') {
      // Interactively collect workspace details (or use flags in non-interactive mode)
      let wsName: string;
      let wsDescription: string | undefined;
      let wsType: string;

      if (opts.yes) {
        // Non-interactive: require --workspace-name
        wsName = opts.workspaceName;
        if (!wsName) {
          console.error('--workspace-name is required when using --yes (non-interactive mode).');
          process.exit(1);
        }
        wsDescription = undefined;
        wsType = opts.workspaceType ?? 'analytics';
      } else {
        // Interactive: prompt for details
        wsName = opts.workspaceName ?? await prompt('Workspace name: ');
        if (!wsName) {
          console.error('Workspace name is required.');
          process.exit(1);
        }

        wsDescription = await prompt('Workspace description (optional, press Enter to skip): ') || undefined;

        if (!opts.workspaceType || opts.workspaceType === 'analytics') {
          console.log('\nWorkspace types:');
          console.log('  1. analytics (default)');
          console.log('  2. essentials');
          console.log('  3. observability');
          console.log('  4. security-analytics');
          console.log('  5. search');
          const typeChoice = await prompt('Choose workspace type (1-5, default 1): ');
          const typeMap: Record<string, string> = { '1': 'analytics', '2': 'essentials', '3': 'observability', '4': 'security-analytics', '5': 'search' };
          wsType = typeMap[typeChoice] ?? 'analytics';
        } else {
          wsType = opts.workspaceType;
        }
      }

      const features = WORKSPACE_TYPES[wsType];
      if (!features) {
        console.error(`Unknown workspace type: ${wsType}. Valid types: ${Object.keys(WORKSPACE_TYPES).join(', ')}`);
        process.exit(1);
      }

      console.log('\n=== New Workspace Summary ===');
      console.log(`  Name:        ${wsName}`);
      if (wsDescription) console.log(`  Description: ${wsDescription}`);
      console.log(`  Type:        ${wsType}`);
      if (targetDataSourceId) {
        console.log(`  Data source: ${targetDataSourceId}`);
      }
      console.log(`  Objects:     ${objects.filter(o => o.type !== 'data-source').length} to import`);

      // Validate index patterns and suggest remappings (skip if data source points to source cluster)
      if (targetDataSourceId && !sourceMatchesTargetDs) {
        indexPatternMappings = await validateAndSuggestIndexMappings(
          client, objects, targetDataSourceId, indexPatternMappings, !opts.yes
        );

        // Gate: check if any index patterns are still unresolved
        const allPatterns = objects
          .filter(o => o.type === 'index-pattern')
          .map(o => o.attributes?.title as string)
          .filter(Boolean);
        const unresolvedPatterns = allPatterns.filter(p => !indexPatternMappings.has(p));
        // A pattern is "unresolved" if it wasn't matched AND wasn't remapped
        // We re-validate to check — but simpler: if ALL patterns are unresolved, gate
        if (unresolvedPatterns.length > 0 && unresolvedPatterns.length === allPatterns.length) {
          console.log('\n⚠ ALL index patterns have no matching indices on the target.');
          console.log('  The imported dashboard will show "No data" for every visualization.');
          if (!opts.yes) {
            const ok = await confirm('  Continue anyway?');
            if (!ok) {
              console.log('Aborted. Options:');
              console.log('  1. Ensure the indices exist on the target cluster');
              console.log('  2. Remap with: --remap-index-pattern "old-pattern*=new-pattern*"');
              process.exit(0);
            }
          } else {
            console.warn('  Warning: Proceeding anyway in non-interactive mode (validation skipped).');
          }
        }
      } else if (targetDataSourceId && sourceMatchesTargetDs) {
        console.log('\n  Skipping index pattern validation — data source points to source cluster.');
      }

      if (!opts.yes) {
        const ok = await confirm('\nProceed with workspace creation and import?');
        if (!ok) {
          console.log('Aborted.');
          process.exit(0);
        }
      }

      console.log(`\nCreating ${wsType} workspace "${wsName}"...`);
      const ws = await client.createWorkspace(wsName, wsDescription, features);
      workspaceId = ws.id;
      console.log(`Created workspace: ${workspaceId}`);

      // Associate data source with the new workspace
      if (targetDataSourceId) {
        console.log(`Associating data source ${targetDataSourceId} with workspace...`);
        await client.associateDataSource(workspaceId, targetDataSourceId);
        console.log('Data source associated.');
      }
    } else if (workspaceId) {
      // Importing into existing workspace — confirm too
      console.log('\n=== Import Summary ===');
      console.log(`  Target workspace: ${workspaceId}`);
      if (targetDataSourceId) {
        console.log(`  Data source:      ${targetDataSourceId}`);
      }
      console.log(`  Objects:          ${objects.filter(o => o.type !== 'data-source').length} to import`);
      console.log(`  Conflict mode:    ${opts.createNewCopies ? 'create new copies' : opts.overwrite ? 'overwrite' : 'skip conflicts'}`);

      // Validate index patterns and suggest remappings (skip if data source points to source cluster)
      if (targetDataSourceId && !sourceMatchesTargetDs) {
        indexPatternMappings = await validateAndSuggestIndexMappings(
          client, objects, targetDataSourceId, indexPatternMappings, !opts.yes
        );

        // Gate: check if any index patterns are still unresolved
        const allPatterns = objects
          .filter(o => o.type === 'index-pattern')
          .map(o => o.attributes?.title as string)
          .filter(Boolean);
        const unresolvedPatterns = allPatterns.filter(p => !indexPatternMappings.has(p));
        if (unresolvedPatterns.length > 0 && unresolvedPatterns.length === allPatterns.length) {
          console.log('\n⚠ ALL index patterns have no matching indices on the target.');
          console.log('  The imported dashboard will show "No data" for every visualization.');
          if (!opts.yes) {
            const ok = await confirm('  Continue anyway?');
            if (!ok) {
              console.log('Aborted. Options:');
              console.log('  1. Ensure the indices exist on the target cluster');
              console.log('  2. Remap with: --remap-index-pattern "old-pattern*=new-pattern*"');
              process.exit(0);
            }
          } else {
            console.warn('  Warning: Proceeding anyway in non-interactive mode (validation skipped).');
          }
        }
      } else if (targetDataSourceId && sourceMatchesTargetDs) {
        console.log('\n  Skipping index pattern validation — data source points to source cluster.');
      }

      if (!opts.yes) {
        const ok = await confirm('\nProceed with import?');
        if (!ok) {
          console.log('Aborted.');
          process.exit(0);
        }
      }
    }

    if (workspaceId) {
      client.setWorkspace(workspaceId);
      console.log(`\nTarget workspace: ${workspaceId}`);
    }

    // ── Step 3: Strip data source prefixes from IDs ──
    if (sourceDataSourceIds.size > 0) {
      console.log(`\nStripping data source ID prefixes from object IDs...`);
      ndjson = stripDataSourcePrefixes(ndjson, sourceDataSourceIds);
      const strippedCount = ndjson.trim().split('\n').length;
      console.log(`Cleaned ${strippedCount} objects (removed data-source objects, stripped ID prefixes).`);
    }

    // ── Step 4: Remap or inject data source references ──
    if (targetDataSourceId) {
      if (sourceDataSourceIds.size > 0) {
        console.log(`\nRemapping data source references -> ${targetDataSourceId}`);
      } else {
        const detected = detectPlatformType(opts.source ?? '');
        const label = detected !== 'unknown' ? detected.toUpperCase() : 'AOS';
        console.log(`\nNo source data source references found (${label} export). Injecting target data source reference -> ${targetDataSourceId}`);
      }
      ndjson = remapDataSources(ndjson, sourceDataSourceIds, targetDataSourceId, targetDsTitle);
      console.log('Data source references updated in NDJSON.');
    }

    // ── Step 4b: Strip stale dataset from dashboard searchSourceJSON ──
    // The dashboard's dataset contains a stale index pattern reference from the
    // source that overrides visualization data context, causing empty results.
    if (targetDataSourceId) {
      console.log('\nStripping stale dataset blocks from dashboard searchSourceJSON...');
      ndjson = stripDashboardDatasetBlocks(ndjson);
      console.log('Done.');
    }

    // ── Step 5: Remap index patterns ──
    if (indexPatternMappings.size > 0) {
      console.log(`\nRemapping ${indexPatternMappings.size} index pattern(s)...`);
      ndjson = remapIndexPatterns(ndjson, indexPatternMappings);
      for (const [old, newP] of indexPatternMappings) {
        console.log(`  ${old} -> ${newP}`);
      }

      // Rebuild fields from target _mapping for remapped patterns
      if (targetDataSourceId) {
        console.log('\nRebuilding index pattern fields from target cluster...');
        ndjson = await rebuildIndexPatternFields(ndjson, indexPatternMappings, client, targetDataSourceId);
      }
    }

    // ── Step 6: Field compatibility check ──
    if (targetDataSourceId) {
      // Use the already-remapped NDJSON so field check uses correct index names
      const remappedObjects = parseNdjsonFile(ndjson);
      await validateFieldCompatibility(client, remappedObjects, targetDataSourceId);
    }

    // ── Step 6b: Disable filters referencing missing fields ──
    // When the target index doesn't have a field used in a filter, the filter
    // causes the visualization to return 0 results on the dashboard. The
    // visualization editor auto-disables such filters on save — we replicate that.
    if (targetDataSourceId) {
      console.log('\nDisabling filters that reference missing fields...');
      ndjson = disableMissingFieldFilters(ndjson);
    }

    // ── Step 7: Import ──
    console.log(`\nImporting from ${opts.file}...`);
    const result = await client.importNdjson(ndjson, {
      createNewCopies: opts.createNewCopies,
      overwrite: opts.overwrite,
    });

    if (result.success) {
      console.log(`Import successful: ${result.successCount} objects imported.`);
    } else {
      console.log(`Import completed with issues: ${result.successCount} succeeded.`);
      if (result.errors.length > 0) {
        console.log(`\nErrors (${result.errors.length}):`);
        for (const err of result.errors) {
          console.log(`  ${err.type}/${err.id}: ${err.error.type} - ${err.error.message}`);
        }
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({
        status: result.success ? 'success' : 'partial',
        workspaceId: workspaceId ?? null,
        successCount: result.successCount,
        errors: result.errors,
        ...(permissionsIssue ? { permissionsWarning: permissionsIssue.message } : {}),
        ...(inspectionReport.nonRenderableTypeSummary ? { nonRenderableTypes: inspectionReport.nonRenderableTypeSummary } : {}),
      }));
    }
  });


function printReport(report: ReturnType<typeof inspect>) {
  console.log('=== Inspection Report ===');
  console.log(`Total objects: ${report.summary.totalObjects}`);
  console.log(`Types: ${Object.entries(report.objectsByType).map(([t, c]) => `${t}(${c})`).join(', ')}`);
  console.log(`Errors: ${report.summary.errors}  Warnings: ${report.summary.warnings}  Info: ${report.summary.info}`);

  if (report.targetPlatform) {
    console.log(`Target platform: ${report.targetPlatform}`);
  }

  if (report.nonRenderableTypeSummary) {
    console.log('\nType renderability warnings:');
    for (const [type, count] of Object.entries(report.nonRenderableTypeSummary)) {
      console.log(`  ⚠ ${type}: ${count} object(s) may not render in the UI`);
    }
  }

  if (report.issues.length > 0) {
    console.log('\nIssues:');
    for (const issue of report.issues) {
      const pfx = issue.severity === 'ERROR' ? '✗' : issue.severity === 'WARNING' ? '⚠' : 'ℹ';
      const phase = issue.phase ? ` [${issue.phase}]` : '';
      console.log(`  ${pfx}${phase} [${issue.type}] ${issue.message}`);
      if (issue.remediation) console.log(`    -> ${issue.remediation}`);
    }
  }
}

program.parse();
