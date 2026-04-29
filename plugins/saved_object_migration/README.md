# Saved Object Migration Plugin

An OpenSearch Dashboards plugin for exporting, inspecting, repairing, and importing dashboard saved objects across instances. Designed for migrating dashboards between environments (e.g., AOS → OpenSearch UI, dev → prod) with full dependency resolution and data source remapping.

## Features

- **Export** — Select dashboards from the current workspace, export them as NDJSON with all dependencies (visualizations, index patterns, saved searches, data sources) resolved via deep reference traversal. Also resolves inline index-pattern references that the core export misses (TSVB `params.index_pattern`, `searchSourceJSON.index`, Vega specs).
- **Inspect** — Analyze an NDJSON bundle for issues before import: missing references, duplicate IDs, embedded inline references, non-renderable types, and platform-specific warnings (AOS/AOSS → OpenSearch UI permissions gaps).
- **Repair** — Transform NDJSON to fix compatibility issues:
  - Strip data source ID prefixes from object IDs
  - Remap data source references to a target data source
  - Strip stale dataset blocks from dashboard searchSourceJSON
  - Remap index pattern names
  - Disable filters referencing fields missing from target index patterns
- **Import** — Upload repaired NDJSON into the target instance with options for workspace targeting, data source association, create-new-copies, and overwrite.

## Installation

The plugin is developed outside the OSD repo and synced in for runtime:

```bash
# One-time sync
./sync-plugin.sh

# Continuous sync during development
./sync-plugin.sh watch
```

Then start OSD. The plugin registers at `/app/savedObjectMigration`.

## UI Flows

### Export Flow (3 steps)

1. **Select Dashboards** — Paginated, searchable list of dashboards in the current workspace. Select one or more.
2. **Inspect** — Review the inspection report (object counts by type, warnings, errors).
3. **Download** — Download the NDJSON file.

### Import Flow (6 steps)

1. **Upload** — Select an NDJSON file. The file is parsed and auto-inspected.
2. **Inspect** — Review the inspection report for the uploaded file.
3. **Repair** — Configure and apply repair operations. The UI auto-detects data sources in the export and presents relevant options.
4. **Preview** — Review the repaired NDJSON. Select/deselect individual objects to include.
5. **Configure** — Choose import target (existing workspace or create new), set create-new-copies/overwrite, and optionally specify a data source ID.
6. **Result** — View import success/error counts.

## API Routes

All routes are under `/api/saved_object_migration`. POST routes require the `osd-xsrf: true` header.

### `GET /dashboards`

List dashboards in the current instance, optionally scoped to a workspace.

| Query Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `perPage` | number | 20 | Results per page |
| `search` | string | — | Filter by title |
| `workspaceId` | string | — | Scope to workspace |

### `POST /export`

Export saved objects as NDJSON with deep dependency resolution.

```json
{
  "objects": [{ "type": "dashboard", "id": "abc123" }]
}
```

Returns `{ "ndjson": "..." }` — newline-delimited JSON string containing all exported objects plus an export details line.

After the core export, the route scans for inline index-pattern references (TSVB, Vega, searchSourceJSON) not covered by the formal `references` array and fetches any missing ones into the bundle.

### `POST /inspect`

Analyze NDJSON for issues.

```json
{
  "ndjson": "...",
  "sourcePlatform": "aos",
  "targetPlatform": "opensearch-ui"
}
```

Returns an `InspectionReport` with issues categorized by severity (ERROR, WARNING, INFO) and phase (PRE_EXPORT, TRANSFORM, PRE_IMPORT).

### `POST /repair`

Apply repair transformations to NDJSON.

```json
{
  "ndjson": "...",
  "config": {
    "stripDataSourcePrefixes": true,
    "remapDataSources": { "enabled": true, "targetId": "new-ds-id", "targetTitle": "My DS" },
    "stripDashboardDatasets": true,
    "remapIndexPatterns": { "enabled": true, "mappings": { "old-pattern": "new-pattern" } },
    "disableMissingFieldFilters": true
  }
}
```

Returns `{ "ndjson": "...", "changes": ["description of each change"] }`.

The pipeline runs in order: strip prefixes → remap data sources → strip datasets → remap index patterns → disable missing field filters.

### `POST /import`

Import NDJSON into the target instance.

```json
{
  "ndjson": "...",
  "overwrite": false,
  "createNewCopies": true,
  "dataSourceId": "target-ds-id",
  "workspaceId": "target-ws-id"
}
```

Returns success/error counts and optional error details.

## Repair Pipeline Details


| Operation | What it does | When to use |
|---|---|---|
| **Strip data source ID prefixes** | Removes the data source ID prefix from all object IDs and references (e.g., `dsId_objId` → `objId`). Also removes `data-source` saved objects from the bundle. | Always enable when migrating between instances with different data source configurations. |
| **Remap data sources to target** | Rewrites all data source references (in `references` arrays and nested JSON strings) from source IDs to a single target ID. Also injects `data_source_id` into TSVB params and `data_source_name` into Vega specs. | Enable when the target instance has a different data source ID than the source. Currently maps all source data sources to one target. |
| **Strip dashboard dataset blocks** | Removes `dataset` objects from `searchSourceJSON.query` and `visState.params.query` / series queries. | Enable when migrating from AOSS or newer OSD versions that embed dataset metadata not supported by the target. |
| **Remap index patterns** | Renames index pattern titles and does a global string replacement of old pattern names with new ones across all object attributes. | Enable when the target instance uses different index names. |
| **Disable missing field filters** | Disables visualization filters that reference fields not present in the index pattern's field list within the export. | Enable to prevent "field not found" errors after import when the target index has a different schema. |

## Project Structure

```
saved_object_migration/
├── common/                  # Shared between server and public
│   ├── api_types.ts         # Request/response type definitions
│   ├── config.ts            # Plugin configuration
│   ├── constants.ts         # Plugin ID, name, API base path
│   ├── inspector.ts         # NDJSON inspection logic
│   ├── repair.ts            # NDJSON repair/transform pipeline
│   └── types.ts             # Core types (SavedObject, InspectionReport, etc.)
├── public/                  # Browser-side plugin
│   ├── application/
│   │   ├── components/      # Shared UI components (StepIndicator, ErrorBanner, etc.)
│   │   ├── export_flow/     # Export wizard (select → inspect → download)
│   │   ├── import_flow/     # Import wizard (upload → inspect → repair → preview → configure → result)
│   │   ├── app.tsx          # Root app component with routing
│   │   ├── landing_page.tsx # Export/Import card selection
│   │   └── use_workspace.ts # Hook for current workspace ID
│   ├── plugin.ts            # Public plugin lifecycle (registers app and nav links)
│   └── types.ts             # Plugin setup/start type interfaces
├── server/                  # Server-side plugin
│   ├── routes/
│   │   ├── dashboards.ts    # GET /dashboards
│   │   ├── export.ts        # POST /export (with inline reference resolution)
│   │   ├── inspect.ts       # POST /inspect
│   │   ├── repair.ts        # POST /repair
│   │   ├── import.ts        # POST /import
│   │   └── index.ts         # Route registration
│   ├── plugin.ts            # Server plugin lifecycle
│   └── types.ts             # Server plugin type interfaces
├── __tests__/               # Jest tests
│   ├── common/              # Inspector, repair, config tests
│   ├── public/              # Component and flow tests
│   ├── server/              # Route handler tests
│   └── fixtures/            # Sample NDJSON files for testing
└── opensearch_dashboards.json  # Plugin manifest
```

## Key Design Decisions

- **NDJSON as the transport format** — Matches the OSD core export/import format. The entire pipeline (export → inspect → repair → import) operates on NDJSON strings, making each step independently testable and composable.
- **Repair is client-side configurable** — The repair pipeline runs on the server but is configured from the UI. Users see what data sources and index patterns were detected and choose which transforms to apply.
- **Inline reference resolution at export time** — The core `exportSavedObjectsToStream` only follows formal `references` arrays. TSVB visualizations store index-pattern references as titles in `visState.params.index_pattern`. The export route detects these and fetches missing index-patterns by title into the bundle.
- **Inspector matches by ID and title** — Embedded index-pattern references can be either IDs (searchSourceJSON.index) or titles (TSVB params.index_pattern). The inspector checks both when determining if a referenced pattern is present in the bundle.
- **Workspace-aware** — The plugin subscribes to `currentWorkspaceId$` and scopes dashboard listing and export to the active workspace. Import can target an existing workspace or create a new one.

## Known Limitations

- **Multi-data-source remap** — The "Remap data sources to target" operation maps all source data sources to a single target. Per-source-to-target mapping is not yet supported.
- **Inline reference resolution is best-effort** — If an inline-referenced index-pattern can't be found by ID or title, it's logged as a warning and the export continues. The inspector will flag it.
- **100MB body limit** — The inspect, repair, and import routes accept up to 100MB request bodies. Exports larger than this need to be split.

## TODO

- **OSD core: remap `dataset` block during import** — The OSD core `importSavedObjectsFromStream` does not remap `dataset.id` or `dataset.dataSource.id` inside `searchSourceJSON.query.dataset` when generating new IDs (`createNewCopies`). This causes stale references after import. The plugin works around this by stripping the `dataset` block entirely, but the proper fix belongs in `OpenSearch-Dashboards/src/core/server/saved_objects/import/create_saved_objects.ts` — it should apply the `importIdMap` to `dataset.id` and remap `dataset.dataSource.id` using the target data source ID.
