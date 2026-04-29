# OpenSearch Flux

CLI tool and MCP server for migrating OpenSearch Dashboards saved objects (dashboards, visualizations, index patterns, saved searches) between OpenSearch instances. Supports OpenSearch managed domains (AOS), OpenSearch Serverless (AOSS), OpenSearch Dashboards Applications (OpenSearch UI), and self-managed OpenSearch clusters.

## Features

- Export a dashboard and all its dependencies, import to a target with workspace creation and data source association
- Remap data source references deep inside searchSourceJSON, TSVB visState, and Vega specs
- Rename index patterns (`--remap-index-pattern "old-*=new-*"`) and rebuild fields from target mappings
- Detect missing fields in target indices and auto-disable broken filters
- Strip stale `dataset` blocks that cause empty panels after cross-platform migration
- Inspect exports before import — reports missing references, permission issues, platform mismatches
- Bulk migration support (tested with 43 dashboards, 568 objects)
- IAM SigV4 auth by default, also supports basic auth, cookie/SAML, and open clusters

## Supported Migration Paths

| Source | Target | Auth |
|--------|--------|------|
| AOS Domain | OpenSearch UI Application | IAM / Basic |
| AOSS Serverless Collection | OpenSearch UI Application | IAM |
| OpenSearch UI Application | OpenSearch UI Application | IAM / Cookie |
| Self-managed OpenSearch | OpenSearch UI Application | Basic / None / Cookie |

## Quick Start

### Prerequisites

- Node.js >= 22
- AWS credentials configured (for IAM-authenticated endpoints)

### Install

```bash
npm install -g @opensearch-project/opensearch-flux
```

### Usage

```bash
# List dashboards on source
opensearch-flux export --source <endpoint>

# Export a dashboard with all dependencies
opensearch-flux export --source <endpoint> --dashboard <id>

# Import to target with workspace creation
opensearch-flux import \
  --target <endpoint> \
  --source <source-endpoint> \
  --file ./migration/export.ndjson \
  --data-source-id <target-ds-id> \
  --target-workspace new \
  --create-new-copies
```

### From Source

If you prefer to run from source:

```bash
cd src
npm install
npx tsc
node dist/cli.js export --source <endpoint>
```

See [src/README.md](src/README.md) for the full CLI reference.

## MCP Server

The MCP server exposes 15 tools for AI agent integration:

| Category | Tools |
|----------|-------|
| Connection | `test_connection`, `list_dashboards`, `list_data_sources` |
| Export | `export_dashboard` |
| Inspection | `inspect_ndjson`, `extract_data_source_info`, `validate_index_patterns` |
| Repair | `strip_data_source_prefixes`, `remap_data_sources`, `strip_dashboard_dataset`, `remap_index_patterns`, `disable_missing_field_filters` |
| Workspace | `list_workspaces`, `create_workspace` |
| Import | `import_ndjson` |

To run the MCP server:

```bash
cd src && npm install && npx tsc
node dist/mcp-server.js
```

## Project Structure

```
agents/                  # Kiro agent definition
  opensearch-flux.agent-spec.json
skills/                  # Agent skill (migration workflow knowledge)
  opensearch-flux/SKILL.md
src/                     # CLI and MCP server source
  cli.ts                 # CLI entry point
  mcp-server.ts          # MCP server entry point
  lib/                   # Shared modules
    client.ts            # OpenSearch Dashboards API client
    config.ts            # Endpoint detection and auth config
    inspector.ts         # NDJSON inspection and validation
    repair.ts            # NDJSON transformation and repair
    validator.ts         # Index pattern and field validation
    types.ts             # TypeScript type definitions
    __tests__/           # Unit tests
plugins/                 # OpenSearch Dashboards plugins
  saved_object_migration/  # Migration UI plugin (export/inspect/repair/import)
docs/                    # Documentation
  migration-workflow.md  # Step-by-step migration guide
```

## OSD Plugin

The `plugins/saved_object_migration` directory contains an OpenSearch Dashboards plugin that provides a UI for the full migration workflow directly inside OSD — export, inspect, repair, and import with workspace and data source awareness.

See [plugins/saved_object_migration/README.md](plugins/saved_object_migration/README.md) for setup and usage.

## Documentation

- [CLI Reference](src/README.md) — full command reference with all options
- [Migration Workflow](docs/migration-workflow.md) — step-by-step guide for each migration path
- [Plugin README](plugins/saved_object_migration/README.md) — OSD plugin documentation
- [Plugin Architecture](plugins/saved_object_migration/ARCHITECTURE.md) — plugin internals

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 — see [LICENSE](LICENSE) for details.

## Copyright

Copyright OpenSearch Contributors. See [NOTICE](NOTICE) for details.
