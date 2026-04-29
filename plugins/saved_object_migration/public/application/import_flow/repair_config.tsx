import React, { useState, useEffect, useMemo } from 'react';
import {
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiSwitch,
  EuiFieldText,
  EuiFormRow,
  EuiBasicTable,
  EuiBasicTableColumn,
  EuiCallOut,
  EuiPanel,
  EuiTitle,
  EuiComboBox,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../src/core/public';
import { RepairConfig } from '../../../common/types';
import { RepairResponse } from '../../../common/api_types';
import { parseNdjsonFile, extractDataSourceIds, extractDataSourceDetails } from '../../../common/repair';
import { ImportFlowAction } from './index';

interface DataSourceOption {
  id: string;
  title: string;
  endpoint?: string;
}

interface IndexPatternMapping {
  oldPattern: string;
  newPattern: string;
}

interface RepairConfigStepProps {
  ndjson: string;
  http: CoreStart['http'];
  dispatch: React.Dispatch<ImportFlowAction>;
}

export const RepairConfigStep: React.FC<RepairConfigStepProps> = ({ ndjson, http, dispatch }) => {
  const [loading, setLoading] = useState(false);
  const [availableDataSources, setAvailableDataSources] = useState<DataSourceOption[]>([]);
  const [selectedTargetDs, setSelectedTargetDs] = useState<Array<{ label: string; value: string }>>([]);

  // Repair toggles (strip prefixes and remap data sources are always on)
  const [stripDatasets, setStripDatasets] = useState(true);
  const [remapPatterns, setRemapPatterns] = useState(false);
  const [disableMissingFilters, setDisableMissingFilters] = useState(true);
  const [indexMappings, setIndexMappings] = useState<IndexPatternMapping[]>([]);

  // Parse NDJSON to extract data source info
  const { sourceDataSourceDetails, indexPatterns } = useMemo(() => {
    const objects = parseNdjsonFile(ndjson);
    return {
      sourceDataSourceDetails: extractDataSourceDetails(objects),
      indexPatterns: objects.filter((o) => o.type === 'index-pattern').map((o) => (o.attributes?.title ?? o.id) as string),
    };
  }, [ndjson]);

  // Fetch available data sources on the target instance
  useEffect(() => {
    http
      .get<{ saved_objects: Array<{ id: string; attributes: { title?: string; endpoint?: string } }> }>(
        '/api/saved_objects/_find',
        { query: { type: 'data-source', per_page: 100 } }
      )
      .then((res) => {
        setAvailableDataSources(
          res.saved_objects.map((o) => ({ id: o.id, title: o.attributes.title ?? o.id, endpoint: o.attributes.endpoint }))
        );
      })
      .catch(() => {
        // Data source list is optional — repair works without it
      });
  }, [http]);

  // Initialize index pattern mappings when toggled on
  useEffect(() => {
    if (remapPatterns && indexMappings.length === 0 && indexPatterns.length > 0) {
      setIndexMappings(indexPatterns.map((p) => ({ oldPattern: p, newPattern: p })));
    }
  }, [remapPatterns, indexPatterns, indexMappings.length]);

  const handleApplyRepair = async () => {
    setLoading(true);
    const config: RepairConfig = {
      stripDataSourcePrefixes: true,
      remapDataSources: {
        enabled: true,
        targetId: selectedTargetDs[0]?.value,
        targetTitle: selectedTargetDs[0]?.label,
      },
      stripDashboardDatasets: stripDatasets,
      remapIndexPatterns: {
        enabled: remapPatterns,
        mappings: remapPatterns
          ? Object.fromEntries(indexMappings.filter((m) => m.oldPattern !== m.newPattern).map((m) => [m.oldPattern, m.newPattern]))
          : undefined,
      },
      disableMissingFieldFilters: disableMissingFilters,
    };
    try {
      const result = await http.post<RepairResponse>(
        '/api/saved_object_migration/repair',
        { body: JSON.stringify({ ndjson, config }) }
      );
      dispatch({ type: 'SET_REPAIR_RESULT', payload: { ...result, config } });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Repair failed' });
    } finally {
      setLoading(false);
    }
  };

  const dsComboOptions = availableDataSources.map((ds) => ({
    label: `${ds.title}${ds.endpoint ? ` (${ds.endpoint})` : ''}`,
    value: ds.id,
  }));

  const indexMappingColumns: Array<EuiBasicTableColumn<IndexPatternMapping>> = [
    {
      field: 'oldPattern',
      name: i18n.translate('savedObjectMigration.repair.sourcePattern', { defaultMessage: 'Source Pattern' }),
    },
    {
      field: 'newPattern',
      name: i18n.translate('savedObjectMigration.repair.targetPattern', { defaultMessage: 'Target Pattern' }),
      render: (_: string, item: IndexPatternMapping) => (
        <EuiFieldText
          compressed
          value={item.newPattern}
          onChange={(e) => {
            setIndexMappings((prev) =>
              prev.map((m) => (m.oldPattern === item.oldPattern ? { ...m, newPattern: e.target.value } : m))
            );
          }}
        />
      ),
    },
  ];

  return (
    <>
      <EuiSpacer />

      {sourceDataSourceDetails.length > 0 && (
        <>
          <EuiCallOut
            title={i18n.translate('savedObjectMigration.repair.detectedDataSources', {
              defaultMessage: 'Detected {count} data source(s) in export',
              values: { count: sourceDataSourceDetails.length },
            })}
            color="primary"
            iconType="iInCircle"
          >
            <ul>
              {sourceDataSourceDetails.map((ds) => (
                <li key={ds.id}>
                  {ds.title}
                  {ds.endpoint
                    ? i18n.translate('savedObjectMigration.repair.dataSourceEndpoint', {
                        defaultMessage: ' — {endpoint}',
                        values: { endpoint: ds.endpoint },
                      })
                    : ''}
                </li>
              ))}
            </ul>
          </EuiCallOut>
          <EuiSpacer />
        </>
      )}

      <EuiPanel paddingSize="l">
        <EuiTitle size="xs">
          <h3>{i18n.translate('savedObjectMigration.repair.title', { defaultMessage: 'Repair Operations' })}</h3>
        </EuiTitle>
        <EuiSpacer size="m" />

        <EuiFormRow
          label={i18n.translate('savedObjectMigration.repair.targetDataSource', { defaultMessage: 'Target data source' })}
          helpText={i18n.translate('savedObjectMigration.repair.targetDataSourceHelp', { defaultMessage: 'All data source references and ID prefixes will be remapped to this data source. Source data source objects will be removed from the import.' })}
        >
          <EuiComboBox
            singleSelection={{ asPlainText: true }}
            options={dsComboOptions}
            selectedOptions={selectedTargetDs}
            onChange={(selected) => setSelectedTargetDs(selected as Array<{ label: string; value: string }>)}
            placeholder={i18n.translate('savedObjectMigration.repair.selectDataSource', { defaultMessage: 'Select a data source' })}
          />
        </EuiFormRow>
        <EuiSpacer size="m" />

        <EuiFormRow helpText={i18n.translate('savedObjectMigration.repair.stripDatasetsHelp', { defaultMessage: 'Removes embedded dataset configuration from dashboards. Enable when migrating from AOSS or newer OSD versions that embed dataset metadata.' })}>
          <EuiSwitch
            label={i18n.translate('savedObjectMigration.repair.stripDatasets', { defaultMessage: 'Strip dashboard dataset blocks' })}
            checked={stripDatasets}
            onChange={(e) => setStripDatasets(e.target.checked)}
          />
        </EuiFormRow>
        <EuiSpacer size="s" />

        <EuiFormRow helpText={i18n.translate('savedObjectMigration.repair.remapIndexPatternsHelp', { defaultMessage: 'Renames index patterns in all objects. Use when the target instance uses different index names (e.g., logs-* → app-logs-*).' })}>
          <EuiSwitch
            label={i18n.translate('savedObjectMigration.repair.remapIndexPatterns', { defaultMessage: 'Remap index patterns' })}
            checked={remapPatterns}
            onChange={(e) => setRemapPatterns(e.target.checked)}
          />
        </EuiFormRow>
        {remapPatterns && indexMappings.length > 0 && (
          <>
            <EuiSpacer size="s" />
            <EuiBasicTable
              items={indexMappings}
              columns={indexMappingColumns}
              rowHeader="oldPattern"
            />
          </>
        )}
        <EuiSpacer size="s" />

        <EuiFormRow helpText={i18n.translate('savedObjectMigration.repair.disableMissingFiltersHelp', { defaultMessage: 'Disables dashboard filters that reference fields not present in the target index patterns. Prevents field not found errors after import.' })}>
          <EuiSwitch
            label={i18n.translate('savedObjectMigration.repair.disableMissingFilters', { defaultMessage: 'Disable filters for missing fields' })}
            checked={disableMissingFilters}
            onChange={(e) => setDisableMissingFilters(e.target.checked)}
          />
        </EuiFormRow>
      </EuiPanel>

      <EuiSpacer />
      <EuiFlexGroup justifyContent="spaceBetween">
        <EuiFlexItem grow={false}>
          <EuiButton onClick={() => dispatch({ type: 'PREV_STEP' })}>
            {i18n.translate('savedObjectMigration.import.backButton', { defaultMessage: 'Back' })}
          </EuiButton>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton
            fill
            onClick={handleApplyRepair}
            isLoading={loading}
            disabled={selectedTargetDs.length === 0}
          >
            {i18n.translate('savedObjectMigration.repair.applyButton', { defaultMessage: 'Apply & Continue' })}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
};
