# OpenSearch Dashboards Migration Workflow

## Overview

This tool migrates saved objects (dashboards, visualizations, index patterns, saved searches) between OpenSearch Dashboards instances. It supports OpenSearch UI (AWS managed), AOS domains, AOSS collections, and on-premises OpenSearch.

## Prerequisites

- Node.js >= 22
- AWS credentials configured (for IAM-authenticated endpoints)
- Access to both source and target OpenSearch instances

## Migration Pipeline

```
Source Instance          Local Filesystem          Target Instance
┌──────────────┐        ┌──────────────┐         ┌──────────────┐
│ 1. Export     │──────> │ 2. Inspect   │         │              │
│   dashboard   │        │   NDJSON     │         │              │
│   + deps      │        │              │         │              │
└──────────────┘        │ 3. Strip IDs │         │              │
                        │ 4. Remap DS  │         │              │
                        │    (deep)    │         │              │
                        │ 5. Strip     │         │              │
                        │    dash DS   │         │              │
                        │ 6. Remap Idx │         │              │
                        │ 7. Validate  │         │              │
                        │    fields    │         │              │
                        │ 8. Disable   │──────>  │ 9. Import    │
                        │    bad filts │         │   to workspace│
                        └──────────────┘         └──────────────┘
```

## Decision Flow

The import process adapts based on the compatibility between source and target. The diagram below shows the key decision branches:

```
                        ┌─────────────────────┐
                        │  Start Import        │
                        │  (connect to target) │
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  Does target have    │
                        │  data sources?       │
                        └──────────┬──────────┘
                           yes/    \no
                          ┌───┘    └────────────────────────────────┐
                          │                                         │
               ┌──────────▼──────────┐               ┌─────────────▼─────────────┐
               │  Show source DS     │               │  STOP: Register a data     │
               │  + target DS list   │               │  source on target first,   │
               │  + suggest matches  │               │  then re-run               │
               └──────────┬──────────┘               └───────────────────────────┘
                          │
               ┌──────────▼──────────┐
               │  User provides      │
               │  --data-source-id   │
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │  Target workspace?  │
               └──────────┬──────────┘
                  new/   exist/   \none
                ┌───┘   ┌───┘     └──┐
                │       │            │
     ┌──────────▼───┐ ┌─▼─────────┐ ┌▼────────────────┐
     │ Prompt for:  │ │ Use       │ │ List workspaces  │
     │  - name      │ │ existing  │ │ or import        │
     │  - desc      │ │ workspace │ │ globally         │
     │  - type      │ └─────┬─────┘ └────────┬────────┘
     │ Create WS    │       │                 │
     │ Associate DS │       │                 │
     └──────┬───────┘       │                 │
            └───────┬───────┘─────────────────┘
                    │
         ┌──────────▼──────────┐
         │  Strip data source  │
         │  ID prefixes from   │
         │  object IDs         │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  Remap data source  │
         │  references (deep)  │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────────┐
         │  Strip stale dataset    │
         │  from dashboard         │
         │  searchSourceJSON       │
         └──────────┬──────────────┘
                    │
         ┌──────────▼──────────────┐
         │  Validate index patterns │
         │  against target cluster  │
         └──────────┬──────────────┘
                    │
         ┌──────────▼──────────┐
         │  Do all index       │
         │  patterns match?    │
         └──────────┬──────────┘
            yes/    \no
           ┌───┘    └───┐
           │            │
           │  ┌─────────▼──────────────┐
           │  │  Can tool suggest      │
           │  │  remappings?           │
           │  └─────────┬──────────────┘
           │     yes/    \no
           │    ┌───┘    └───┐
           │    │            │
           │  ┌─▼──────────────────────┐
           │  │ Show suggestions:      │
           │  │  source-logs-* ->      │
           │  │  target-logs-*         │
           │  │                        │
           │  │ Interactive: confirm   │
           │  │ Agent: use             │
           │  │  --remap-index-pattern │
           │  └─────────┬──────────────┘
           │            │
           │  ┌─────────▼──────────────┐
           │  │ User can also provide  │
           │  │ explicit remappings:   │
           │  │ --remap-index-pattern  │
           │  │  "old*=new*"           │
           │  └─────────┬──────────────┘
           │            │
           └──────┬─────┘
                  │         ┌──────────────────────────┐
                  │    no   │ WARNING: Unmatched        │
                  ├────────>│ patterns will show        │
                  │         │ "No data" in dashboards   │
                  │         └──────────────────────────┘
                  │
         ┌────────▼────────────────┐
         │  Apply index pattern    │
         │  remappings to NDJSON   │
         └────────┬────────────────┘
                  │
         ┌────────▼────────────────┐
         │  Check field            │
         │  compatibility          │
         └────────┬────────────────┘
                  │
         ┌────────▼────────────┐
         │  Do all fields      │
         │  exist in target?   │
         └────────┬────────────┘
            yes/   \no
           ┌──┘    └───┐
           │           │
           │  ┌────────▼───────────────┐
           │  │ WARNING: Show missing  │
           │  │ fields per index       │
           │  │ pattern. Affected      │
           │  │ visualizations may     │
           │  │ not render correctly.  │
           │  └────────┬───────────────┘
           │           │
           └─────┬─────┘
                 │
         ┌───────▼──────────────┐
         │  Disable filters     │
         │  referencing missing │
         │  fields              │
         └───────┬──────────────┘
                 │
         ┌───────▼─────────┐
         │  Confirm import │
         │  (interactive)  │
         │  or auto-proceed│
         │  (--yes)        │
         └───────┬─────────┘
                 │
         ┌───────▼─────────┐
         │  Import NDJSON  │
         │  to target      │
         │  workspace      │
         └───────┬─────────┘
                 │
         ┌───────▼─────────┐
         │  Report results │
         │  success/errors │
         └─────────────────┘
```

### Scenario Summary

| Scenario | Data Source | Index Patterns | Fields | Outcome |
|----------|-----------|----------------|--------|---------|
| Same cluster, same indices | Match on target | All match | All match | Clean import, everything works |
| Same cluster, different DS ID | Remap DS refs | All match | All match | Clean import after DS remap |
| Different cluster, same naming | Remap DS refs | All match | Check needed | Import works if fields exist |
| Different cluster, different naming | Remap DS refs | Remap needed | Check needed | Requires index pattern + field mapping |
| Different cluster, different schema | Remap DS refs | Remap needed | Missing fields | Partial — some visualizations won't render |
| No data source on target | N/A | N/A | N/A | Blocked — must register DS first |

## Step-by-Step

### Step 1: Export

Export a dashboard and all its dependencies from the source instance.

```bash
cd src

# List available dashboards
npx tsx src/cli.ts export \
  --source <source-endpoint> \
  --auth iam

# Export a specific dashboard
npx tsx src/cli.ts export \
  --source <source-endpoint> \
  --auth iam \
  --dashboard <dashboard-id> \
  --out ./migration

# Export from a specific workspace
npx tsx src/cli.ts export \
  --source <source-endpoint> \
  --auth iam \
  --source-workspace <workspace-id> \
  --dashboard <dashboard-id> \
  --out ./migration
```

Output:
- `./migration/export.ndjson` — exported saved objects
- `./migration/inspection-report.json` — pre-import analysis

The export uses the saved objects `_find` API (GET) to fetch each object individually and recursively resolve all references. The standard `_export` POST API is unavailable on OpenSearch UI due to IAM signing constraints.

### Step 2: Inspect

The inspection runs automatically after export. It checks for:
- Missing references (objects referencing non-existent dependencies)
- Duplicate IDs
- Object type distribution

You can also inspect an existing NDJSON file:

```bash
npx tsx src/cli.ts inspect --file ./migration/export.ndjson
```

### Step 3: Import

The import command handles all transformation and validation steps.

#### Discovery mode (no flags)

```bash
npx tsx src/cli.ts import \
  --target <target-endpoint> \
  --auth iam \
  --file ./migration/export.ndjson
```

This will:
1. Show source data source details from the export
2. List available data sources on the target
3. Suggest which target data source to use
4. Exit with instructions for the next step

#### Full import (interactive)

```bash
npx tsx src/cli.ts import \
  --target <target-endpoint> \
  --auth iam \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --target-workspace new \
  --create-new-copies
```

Interactive prompts will ask for:
- Workspace name
- Workspace description (optional)
- Workspace type (analytics, essentials, observability, security-analytics, search)
- Confirmation before creating workspace and importing

#### Source Verification

Use `--source <endpoint>` to verify the target data source points to the expected source cluster:

```bash
npx tsx src/cli.ts import \
  --target <target-endpoint> \
  --auth iam \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --source <source-endpoint>
```

When provided, the tool checks whether the target data source's endpoint matches the source. If it matches, index pattern validation is skipped (the indices are known to exist on the same cluster).

#### Full import (non-interactive / agent mode)

```bash
npx tsx src/cli.ts import \
  --target <target-endpoint> \
  --auth iam \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --target-workspace new \
  --workspace-name "My Workspace" \
  --workspace-type observability \
  --create-new-copies \
  --yes --json
```

## What Happens During Import

### Data Source ID Prefix Stripping

OpenSearch UI stores saved objects with compound IDs: `{dataSourceId}_{objectId}`. The target's import API rejects these because it interprets the prefix as a foreign data source. The tool automatically strips these prefixes and removes `data-source` objects from the NDJSON.

### Data Source Reference Remapping

All `data-source` references in the NDJSON are remapped from the source data source ID(s) to the target data source ID provided via `--data-source-id`. This includes data source IDs embedded inside nested JSON strings (e.g., `searchSourceJSON` contains `dataset.dataSource.id` as a JSON-within-JSON string).

### Dashboard Dataset Stripping

The dashboard's `searchSourceJSON` may contain a `dataset` block with cached index pattern references from the source instance. This stale dataset overrides the visualizations' own data source context, causing them to query the wrong index or return empty results. The tool strips this block from dashboard objects during import.

### Index Pattern Validation

The tool queries the target data source's underlying OpenSearch cluster to check which index patterns have matching indices. Unmatched patterns are flagged with warnings.

### Index Pattern Remapping

When source and target use different index naming schemes, patterns can be remapped:

```bash
--remap-index-pattern "source-logs-*=target-logs-*" \
--remap-index-pattern "source-metrics=target-metrics"
```

The tool also suggests remappings based on keyword similarity between source patterns and target index names.

### Field Compatibility Check

After remapping, the tool queries the target cluster's field mappings and compares them against fields used by visualizations. Missing fields are reported so users know which visualizations may not render correctly.

### Missing Field Filter Disabling

When the target index doesn't have a field used in a visualization's filter, the filter causes the visualization to return 0 results on the dashboard (even though it renders correctly on the individual visualization page). The tool auto-disables such filters during import, matching the behavior of the OpenSearch Dashboards visualization editor.

### Workspace Creation and Data Source Association

When `--target-workspace new` is used, the tool:
1. Creates a new workspace with the specified type
2. Associates the target data source with the workspace
3. Imports all objects into the workspace

## Authentication

The `--auth` flag supports four modes:

| Mode | Flag | Use Case |
|------|------|----------|
| `none` | `--auth none` | No authentication (open clusters) |
| `basic` | `--auth basic --username <user> --password <pass>` | On-premises or AOS with basic auth |
| `iam` | `--auth iam` | AWS IAM (SigV4 signing) |
| `cookie` | `--auth cookie --cookie <value>` | SAML/Cognito-authenticated instances |

### IAM Authentication

The tool uses the standard AWS credential chain for IAM authentication. No credential flags are needed.

```bash
# Any of these methods work:
aws configure                          # Access keys
aws sso login --profile <profile>      # SSO
export AWS_ACCESS_KEY_ID=...           # Environment variables
# Instance role (automatic on EC2/ECS) # Instance role
```

The signing service is auto-detected from the endpoint URL:
- `application-*.opensearch.amazonaws.com` → `opensearch` (OpenSearch UI)
- `*.es.amazonaws.com` → `es` (AOS domains)
- `*.aoss.amazonaws.com` → `aoss` (Serverless)

Use `--service <service>` to override the auto-detected SigV4 signing service (e.g., `--service es` when the endpoint URL doesn't match the standard patterns).

### Cookie Authentication

For instances behind SAML or Cognito authentication, use cookie-based auth:

```bash
npx tsx src/cli.ts export \
  --source <endpoint> \
  --auth cookie \
  --cookie "security_authentication=<token>"
```

To obtain the cookie value:
1. Log in to OpenSearch Dashboards in your browser
2. Open browser developer tools (F12) → Network tab
3. Reload the page and select any request to the Dashboards endpoint
4. Copy the `Cookie` header value from the request headers

## Supported Source/Target Types

| Type | Export | Import | Auth |
|------|--------|--------|------|
| OpenSearch UI (Application) | ✓ (GET fallback) | ✓ (curl SigV4) | IAM (`opensearch`) / Cookie |
| AOS Domain | ✓ | ✓ | IAM (`es`) / Basic |
| AOSS Collection | ✓ | ✓ | IAM (`aoss`) |
| On-Premises OpenSearch | ✓ | ✓ | Basic / None / Cookie |

## Cross-Platform Migration Notes

### AOS → OpenSearch UI

AOS domains do not use the data-source concept. When migrating AOS exports to OpenSearch UI:
- The tool detects the absence of data-source references and injects a reference to the target data source
- TSVB (metrics) visualizations get `data_source_id` injected into their `visState.params`
- Vega visualizations get `data_source_name` injected into their spec
- The inspector emits a `MISSING_PERMISSIONS` warning — AOS has no per-object permissions, but OpenSearch UI uses `read`, `write`, `library_read`, `library_write` permission types
- Use `--source <aos-endpoint>` on import to skip index pattern validation when the target data source points to the source AOS cluster

### AOSS → OpenSearch UI

AOSS (Amazon OpenSearch Serverless) collections use the same Dashboards saved-objects API as AOS, but with key differences:

- **Auth**: AOSS requires IAM SigV4 signing with service `aoss` (auto-detected from `*.aoss.amazonaws.com` URLs)
- **Data sources**: Unlike AOS, AOSS exports may already contain data-source references. The tool remaps these to the target data source ID rather than injecting new ones
- **Permissions**: Like AOS, AOSS does not support per-object permissions. The inspector emits a `MISSING_PERMISSIONS` warning for AOSS→UI migrations
- **Collection semantics**: AOSS uses collection-level IAM access control rather than index-level FGAC. The inspector emits an `AOSS_COLLECTION_SEMANTICS` info note reminding you to verify the target data source has appropriate access
- **Index patterns**: AOSS collections may use different index naming conventions. Use `--remap-index-pattern` if the target cluster uses different index names

```bash
# AOSS → OpenSearch UI example
npx tsx src/cli.ts export \
  --source https://<collection-id>.<region>.aoss.amazonaws.com \
  --auth iam \
  --dashboard <dashboard-id> \
  --out ./migration

npx tsx src/cli.ts import \
  --target https://application-<app-id>.<region>.opensearch.amazonaws.com \
  --auth iam \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --source https://<collection-id>.<region>.aoss.amazonaws.com \
  --target-workspace new \
  --workspace-name "Migrated from AOSS" \
  --create-new-copies --yes --json
```
