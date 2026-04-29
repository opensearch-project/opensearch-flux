# opensearch-flux

CLI tool for migrating saved objects (dashboards, visualizations, index patterns, saved searches) between OpenSearch Dashboards instances. Supports OpenSearch UI (AWS managed), AOS domains, AOSS collections, and on-premises OpenSearch.

## Setup

```bash
cd src
npm install
npx tsc
```

Requires Node.js >= 22.

## Quick Start

```bash
# 1. List dashboards on source
node dist/cli.js export --source <endpoint>

# 2. Export a dashboard with all dependencies
node dist/cli.js export --source <endpoint> --dashboard <id>

# 3. Inspect the export for issues
node dist/cli.js inspect --file ./migration/export.ndjson \
  --source <source-endpoint> --target <target-endpoint>

# 4. Import to a new workspace
node dist/cli.js import \
  --target <endpoint> \
  --source <source-endpoint> \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --target-workspace new \
  --create-new-copies
```

Auth defaults to IAM. Region and service are auto-detected from the endpoint URL.

## Commands

### export

Export a dashboard and all its dependencies from a source instance.

```bash
node dist/cli.js export [options]

Options:
  --source <endpoint>        Source OSD endpoint URL (required)
  --source-workspace <id>    Source workspace ID
  --auth <type>              Auth type: iam, basic, none, cookie (default: iam)
  --username <user>          Basic auth username
  --password <pass>          Basic auth password
  --cookie <cookie>          Session cookie (for SAML/Cognito auth)
  --region <region>          AWS region (auto-detected from URL)
  --service <service>        AWS signing service (auto-detected from URL)
  --dashboard <id>           Dashboard ID (omit to list available)
  --out <dir>                Output directory (default: ./migration)
```

### inspect

Analyze an NDJSON export file for issues before import.

```bash
node dist/cli.js inspect [options]

Options:
  --file <path>              Path to NDJSON file (required)
  --source <endpoint>        Source endpoint URL (for platform-aware checks)
  --target <endpoint>        Target endpoint URL (for platform-aware checks)
```

Checks for: missing references, duplicate IDs, type renderability, permissions gaps (AOS/AOSS → UI), AOSS collection semantics.

When `--source` and `--target` are provided, the inspector emits platform-specific warnings (e.g., AOSS permissions model differences).

### import

Import an NDJSON file to a target instance with full validation.

```bash
node dist/cli.js import [options]

Options:
  --target <endpoint>              Target OSD endpoint URL (required)
  --source <endpoint>              Source endpoint URL (for data source validation)
  --file <path>                    Path to NDJSON file (required)
  --auth <type>                    Auth type: iam, basic, none, cookie (default: iam)
  --username <user>                Basic auth username
  --password <pass>                Basic auth password
  --cookie <cookie>                Session cookie (for SAML/Cognito auth)
  --data-source-id <id>            Target data source ID (required for remapping)
  --target-workspace <id>          Workspace ID, or "new" to create one
  --workspace-name <name>          Name for new workspace
  --workspace-type <type>          analytics | essentials | observability | security-analytics | search
  --remap-index-pattern <mapping>  Remap index patterns: "old*=new*" (repeatable)
  --create-new-copies              Generate new IDs for all objects
  --overwrite                      Overwrite existing objects with same ID
  -y, --yes                        Skip confirmation prompts (agent/CI mode)
  --json                           Output results as JSON
```

The `--source` flag tells the tool where the export came from. When the target data source points to the source cluster, index pattern validation is skipped (patterns are guaranteed to exist). It also enables platform mismatch detection (e.g., warns if source is AOSS but data source points to AOS).

## What Happens During Import

1. **Data source discovery** — shows source data sources from the export and available targets, suggests matches
2. **Platform detection** — detects source/target platforms (AOS, AOSS, OpenSearch UI) for platform-aware warnings
3. **Workspace setup** — lists existing workspaces or creates a new one with type selection and data source association
4. **ID prefix stripping** — removes OpenSearch UI compound ID prefixes (`{dataSourceId}_{objectId}`)
5. **Data source remapping** — rewrites all data source references to the target data source, including IDs embedded inside nested JSON strings (searchSourceJSON, visState)
6. **Dashboard dataset stripping** — removes stale `dataset` blocks from the dashboard's searchSourceJSON that reference source index patterns
7. **Index pattern remapping** — renames index patterns when source/target use different naming schemes
8. **Field compatibility check** — validates that fields used by visualizations exist in the target indices
9. **Missing field filter disabling** — auto-disables filters that reference fields not present in the target index (prevents empty results on dashboard)
10. **Confirmation** — shows summary and asks for confirmation before making changes
11. **Import** — uploads cleaned NDJSON to the target workspace

## Authentication

Auth defaults to IAM. Uses the standard AWS credential chain — no credential flags needed.

```bash
aws configure                          # Access keys
aws sso login --profile <profile>      # SSO
export AWS_ACCESS_KEY_ID=...           # Environment variables
# Instance role on EC2/ECS/Lambda      # Automatic
```

For basic auth (AOS domains with FGAC): `--auth basic --username admin --password <pass>`

For cookie auth (SAML/Cognito): `--auth cookie --cookie <value>`

The signing service is auto-detected from the endpoint URL:

| URL Pattern | Service | Type |
|-------------|---------|------|
| `application-*.opensearch.amazonaws.com` | `opensearch` | OpenSearch UI |
| `*.es.amazonaws.com` | `es` | AOS Domain |
| `*.aoss.amazonaws.com` | `aoss` | AOSS Serverless |

## Agent / CI Usage

All interactive prompts can be bypassed with flags:

```bash
node dist/cli.js import \
  --target <endpoint> \
  --source <source-endpoint> \
  --file ./migration/export.ndjson \
  --data-source-id <ds-id> \
  --target-workspace new \
  --workspace-name "Migrated" \
  --workspace-type observability \
  --remap-index-pattern "old-logs-*=new-logs-*" \
  --create-new-copies \
  --yes --json
```

## Documentation

- [Migration Workflow](../docs/migration-workflow.md) — detailed step-by-step guide

## License

Apache-2.0
