# Architecture

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXPORT FLOW                                 │
│                                                                     │
│  Dashboard Select ──► Core Export ──► Inline Ref ──► Inspect ──► Download
│  (workspace-scoped)   (deep refs)    Resolution     (warnings)    (.ndjson)
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         IMPORT FLOW                                 │
│                                                                     │
│  Upload ──► Inspect ──► Repair ──► Preview ──► Configure ──► Import
│  (.ndjson)  (issues)    (transform) (select)   (target)     (OSD core)
└─────────────────────────────────────────────────────────────────────┘
```

## How Export Works

1. The UI calls `GET /dashboards?workspaceId=X` to list dashboards in the current workspace.
2. User selects dashboards. The UI calls `POST /export` with the selected object IDs.
3. The server calls OSD core's `exportSavedObjectsToStream` with `includeReferencesDeep: true`. This follows the formal `references` array on each object, recursively pulling in visualizations, index patterns, saved searches, and data sources.
4. **Inline reference resolution**: After the core export, the route scans every exported object using `extractEmbeddedIndexPatternRefs()`. This extracts index-pattern references from:
   - `searchSourceJSON.index` (standard visualizations and saved searches)
   - `visState.params.index_pattern` (TSVB/Visual Builder — stores pattern **title**, not ID)
   - `visState.params.series[].series_index_pattern` (TSVB per-series overrides)
   - Vega spec `index:` declarations
5. For each embedded reference not already in the bundle (checked by both ID and title), the route fetches it via `client.get()` (by ID) or `client.find()` (by title) and appends it.
6. The UI calls `POST /inspect` on the resulting NDJSON and shows the report.

## How Inspection Works

The inspector (`common/inspector.ts`) runs these checks:

| Check | Severity | Description |
|---|---|---|
| Missing references | ERROR | Object references another object (via `references` array) not in the bundle |
| Embedded index references | WARNING/INFO | Object references an index-pattern inline (not via `references`). WARNING if missing from bundle, INFO if present. |
| Duplicate IDs | ERROR | Same `type:id` appears multiple times |
| Object count | INFO | Summary of objects and types |
| Non-renderable types | WARNING | Object types that may not render in the OpenSearch UI frontend (target-aware) |
| Missing permissions | WARNING | AOS/AOSS exports lack per-object permissions needed by OpenSearch UI (target-aware) |
| AOSS collection semantics | INFO | AOSS uses collection-level IAM, not index-level FGAC (target-aware) |

Target-aware checks only run when `sourcePlatform` and/or `targetPlatform` are provided.

## How Repair Works

The repair pipeline (`common/repair.ts`) applies transforms in a fixed order:

```
stripDataSourcePrefixes → remapDataSources → stripDashboardDatasets → remapIndexPatterns → disableMissingFieldFilters
```

Each step is independently toggleable. The pipeline operates on the NDJSON string, parsing and re-serializing each line.

### Strip Data Source Prefixes

- Removes `data-source` type objects from the NDJSON entirely
- Strips the data source ID prefix from all object IDs and reference IDs
- Example: `b37005e0_7adfa750-4c81` → `7adfa750-4c81`

### Remap Data Sources

- Rewrites `references` array entries where `type === 'data-source'` to the target ID
- Recursively walks all attributes (including nested JSON strings) via `deepRemapDataSourceIds` to replace source IDs with the target
- Injects `data_source_id` into TSVB visualization params
- Injects `data_source_name` into Vega spec URL blocks

### Strip Dashboard Datasets

- Removes `query.dataset` from `searchSourceJSON` in dashboards, visualizations, and searches
- Removes `params.query.dataset` and `params.series[].query.dataset` from `visState`

### Remap Index Patterns

- Updates `attributes.title` on `index-pattern` objects
- Does a global string replacement of old pattern names with new ones across all `attributes` (serialized as JSON). This catches inline references in `visState`, `searchSourceJSON`, etc.

### Disable Missing Field Filters

- Builds a field set per index-pattern from the `fields` attribute in the bundle
- For each visualization, checks `searchSourceJSON.filter` entries against the field set
- Disables filters where `meta.key` references a field not in the set

## How Import Works

1. The UI sends `POST /import` with the (optionally repaired) NDJSON, plus configuration:
   - `createNewCopies` — generate new UUIDs for all objects (default: true)
   - `overwrite` — overwrite existing objects with same IDs
   - `dataSourceId` — associate imported objects with this data source
   - `workspaceId` — import into this workspace
2. The server validates the NDJSON, resolves the data source title if `dataSourceId` is provided, then calls OSD core's `importSavedObjectsFromStream`.
3. When `dataSourceId` is provided, the core import API:
   - Prefixes new object IDs with the data source ID (`${dsId}_${uuid}`)
   - Rewrites inline references (`searchSourceJSON.index`, TSVB `data_source_id`, Vega specs, control vis index patterns)
   - Filters out `data-source` type objects from the import (the target's data source is used)
4. When `workspaceId` is provided, the workspace saved objects wrapper automatically associates imported objects with that workspace.

## Workspace Integration

The plugin integrates with OSD's workspace system:

- **Client side**: `app.tsx` subscribes to `core.workspaces.currentWorkspaceId$` and passes the workspace ID to both export and import flows.
- **Server side**: When accessed via a workspace URL (`/w/{workspaceId}/api/...`), the workspace plugin's `registerOnPreRouting` sets `requestWorkspaceId` on the request. The `WorkspaceIdConsumerWrapper` auto-injects this into `savedObjects.client.find()` calls.
- **Dashboard listing**: The `GET /dashboards` route explicitly passes `workspaces: [workspaceId]` to `client.find()` when a workspace ID is provided.

## Saved Object ID Prefixing Convention

In multi-data-source OSD environments, saved object IDs follow the pattern:

```
{workspaceId}_{dataSourceId}_{originalId}
```

For example: `ZQB6Y8_b37005e0_7adfa750-4c81-11e8-b3d7-01146121b73d`

- The workspace prefix is added by the sample data installer (`overwriteSavedObjectsWithWorkspaceId`)
- The data source prefix is added by the core import API (`regenerateIds`) or sample data installer (`getSavedObjectsWithDataSource`)
- The repair pipeline's "strip prefixes" step reverses this, producing clean IDs for re-import
