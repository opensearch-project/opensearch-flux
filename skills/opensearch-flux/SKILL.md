---
name: opensearch-flux
description: Guides users through migrating OpenSearch Dashboards saved objects (dashboards, visualizations, index patterns) between instances using the osd-migrate CLI tool.
version: 1.0.0
tags: [opensearch, migration, dashboards]
---

# OpenSearch Dashboards Migration Skill

## Overview

This skill helps users migrate saved objects between OpenSearch Dashboards instances. It drives the `osd-migrate` CLI tool through a multi-step workflow: export from source, inspect, and import to target with data source remapping, index pattern validation, and workspace management.

## When to Use

- User wants to migrate dashboards between OpenSearch instances
- User wants to copy visualizations from one OpenSearch UI application to another
- User mentions migrating from AOS/AOSS to OpenSearch UI
- User needs to move saved objects across AWS accounts or regions

## Prerequisites

Before starting, verify:
1. Node.js >= 22 is installed: `node --version`
2. The tool is set up: `cd src && npm install`
3. AWS credentials are configured for both source and target accounts (for IAM auth)
4. User has the source and target endpoint URLs

## Authentication

The tool supports four auth types: `iam`, `basic`, `cookie`, and `none`.

### Cookie Auth (SAML / Cognito)

For instances behind SAML or Cognito authentication, use cookie auth. The user just needs to copy the cookie value from their browser:

1. Open the OpenSearch Dashboards instance in a browser and log in
2. Open browser Developer Tools (F12)
3. Go to Application tab → Cookies → select the OSD domain
4. Find the cookie named `security_authentication`
5. Copy the cookie value (just the value, not the name)
6. Pass it with `--auth cookie --cookie <pasted_value>`, for example:
   ```bash
   npx tsx src/cli.ts export --source <endpoint> --auth cookie --cookie <pasted_value>
   ```

The tool auto-prefixes `security_authentication=` if the user pastes just the raw value, so they don't need to construct the full cookie string themselves.

Note: This is a session cookie — it expires when the browser session ends. If the migration takes a while, the user may need to grab a fresh cookie.

## Workflow

### Phase 1: Export

Run the export command to list dashboards, then export the chosen one:

```bash
cd src

# List dashboards (user picks one)
npx tsx src/cli.ts export --source <endpoint> --auth iam

# Export with all dependencies
npx tsx src/cli.ts export --source <endpoint> --auth iam --dashboard <id>
```

The export creates `./migration/export.ndjson` and `./migration/inspection-report.json`.

Review the inspection report for errors (missing references, broken dependencies).

### Phase 2: Discover Target and Validate Data Source

Before importing, the agent MUST verify that the target has a suitable data source. This is critical — importing without a valid data source means objects can't query data.

#### AOS → OpenSearch UI migrations (source has no data sources)

When the source is AOS, the export won't contain data source references. The agent must:

1. List data sources on the target: run import without `--data-source-id` or use `list_data_sources`
2. Show the user each target data source with its title AND endpoint URL
3. Ask the user: "Which data source should the migrated objects use?"
4. If no target data source points to the right cluster, STOP and tell the user:
   - "None of the existing data sources point to your source data. You can either:"
   - "1. Register a new data source on the target that points to your source cluster"
   - "2. Pick an existing data source if you want to remap to different data"
5. Only proceed once the user explicitly confirms a data source

#### OpenSearch UI → OpenSearch UI migrations (source has data sources)

When the source export contains data source references:

1. Extract source data source details (title, endpoint) from the export
2. List target data sources
3. Compare source and target data sources by endpoint and title
4. If a matching data source exists on the target, suggest it to the user
5. If no match exists, STOP and present the same options as above
6. Only proceed once the user explicitly confirms the mapping

**IMPORTANT:** Never auto-proceed with a data source without user confirmation. The user must understand which data source their migrated objects will query.

```bash
# Discovery mode — lists source and target data sources
npx tsx src/cli.ts import \
  --target <endpoint> --auth iam \
  --file ./migration/export.ndjson \
  --json
```

This returns JSON with:
- `sourceDataSources`: data sources referenced in the export (with titles and endpoints)
- `targetDataSources`: available data sources on the target

Help the user match source to target data sources based on titles and endpoints.

### Phase 3: Import

Once the user has chosen a target data source, run the full import. Use `--source <endpoint>` to pass the original source endpoint — this enables the tool to validate index patterns against the source cluster during import:

```bash
npx tsx src/cli.ts import \
  --source <source-endpoint> \
  --target <endpoint> --auth iam \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --target-workspace new \
  --workspace-name "<name>" \
  --workspace-type <analytics|essentials|observability|security-analytics|search> \
  --create-new-copies \
  --yes --json
```

If index patterns don't match between source and target, add remapping:

```bash
  --remap-index-pattern "source-pattern*=target-pattern*"
```

### Phase 4: Verify

After import, check the results:
- Parse the JSON output for `successCount` and `errors`
- If there are errors, explain each one and suggest fixes
- Provide the user with the URL to view the imported dashboard:
  `<target-endpoint>/w/<workspaceId>/app/dashboards`

## Key Concepts

### Data Source ID Prefix
OpenSearch UI stores objects with compound IDs: `{dataSourceId}_{objectId}`. The tool strips these automatically during import. No action needed from the agent.

### Data Source Remapping
The `--data-source-id` flag is required. It remaps all data source references in the exported objects to point to the target data source. Without it, imported objects can't query data.

### Index Pattern Compatibility
When source and target use different index naming schemes, the tool:
1. Validates patterns against target indices
2. Suggests remappings based on keyword similarity
3. Checks field compatibility after remapping

If index patterns have NO matching indices on the target, the agent should STOP and warn the user before proceeding. The options are:
- The user ensures the indices exist on the target cluster first
- The user provides an explicit remap: `--remap-index-pattern "old-pattern*=new-pattern*"`
- The user acknowledges the dashboards will show "No data" and proceeds anyway

Do NOT silently continue when all index patterns fail validation — this means the migration will produce a non-functional dashboard.

### Workspace Types
- `analytics` — general purpose (default)
- `essentials` — essential features
- `observability` — logs, metrics, traces
- `security-analytics` — security event analysis
- `search` — search applications

### Dashboard Dataset Blocks
The dashboard's `searchSourceJSON` may contain a `dataset` block with cached index pattern references from the source. The tool strips this automatically during import. If the dashboard shows empty visualizations, this is likely the cause — the stale dataset overrides the visualizations' own data source context.

### Missing Field Filters
When the target index doesn't have a field used in a visualization's filter (e.g., `is_aws_internal`), the filter causes the visualization to return 0 results on the dashboard. The tool auto-disables such filters during import. Inform the user which filters were disabled so they can review.

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| HTTP 403 on connect | Wrong signing service or missing permissions | Check `--service` flag and IAM permissions |
| `unsupported_type` on import | Compound IDs not stripped | This shouldn't happen — the tool strips them automatically. If it does, check the NDJSON format |
| `data_source_required` | No `--data-source-id` provided | Run discovery mode first, then re-run with the flag |
| Missing index patterns | Source/target use different index names | Use `--remap-index-pattern` to map old names to new |
| Missing fields | Target index has different schema | Inform user which visualizations will show "No data" |
| Visualizations show 0/empty on dashboard | Filters reference fields missing from target | Tool auto-disables these; re-import with `--overwrite` |
| Dashboard shows empty panels | Stale `dataset` block in dashboard searchSourceJSON | Tool strips this automatically; re-import with `--overwrite` |
| Embedded data source IDs not remapped | Data source IDs inside nested JSON strings | Tool handles deep remapping automatically |

## CLI Reference

```
osd-migrate export   --source <url> --auth iam [--dashboard <id>] [--out <dir>]
                     [--source-workspace <id>]
                     [--cookie <value>] [--service <service>]
osd-migrate inspect  --file <path>
osd-migrate import   --target <url> --auth iam --file <path>
                     [--source <url>]
                     [--data-source-id <id>]
                     [--target-workspace <id|new>]
                     [--workspace-name <name>] [--workspace-type <type>]
                     [--remap-index-pattern "old=new"]
                     [--create-new-copies] [--overwrite]
                     [--cookie <value>] [--service <service>]
                     [-y|--yes] [--json]
```
