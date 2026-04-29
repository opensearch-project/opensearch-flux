import React, { useState, useEffect } from 'react';
import {
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiFormRow,
  EuiFieldText,
  EuiSelect,
  EuiPanel,
  EuiTitle,
  EuiCallOut,
  EuiRadioGroup,
  EuiComboBox,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../src/core/public';
import { WORKSPACE_TYPES } from '../../../common/config';
import { ImportResponse } from '../../../common/api_types';
import { ImportFlowAction } from './index';

type WorkspaceMode = 'none' | 'existing' | 'new';

interface ImportConfigStepProps {
  ndjson: string;
  repairChanges: string[];
  http: CoreStart['http'];
  dispatch: React.Dispatch<ImportFlowAction>;
  workspaceId?: string;
}

export const ImportConfigStep: React.FC<ImportConfigStepProps> = ({ ndjson, repairChanges, http, dispatch, workspaceId }) => {
  const [loading, setLoading] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(workspaceId ? 'existing' : 'none');
  const [existingWorkspaces, setExistingWorkspaces] = useState<Array<{ label: string; value: string }>>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Array<{ label: string; value: string }>>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceType, setNewWorkspaceType] = useState('analytics');

  useEffect(() => {
    http
      .get<{ workspaces?: Array<{ id: string; name: string }> }>('/api/workspaces/_list', { query: { per_page: 100 } })
      .then((res) => {
        if (res.workspaces) {
          const options = res.workspaces.map((w) => ({ label: w.name, value: w.id }));
          setExistingWorkspaces(options);
          // Pre-select workspace if scoped
          if (workspaceId) {
            const match = options.find((w) => w.value === workspaceId);
            if (match) setSelectedWorkspace([match]);
          }
        }
      })
      .catch(() => {
        // Workspace list is optional — import works without it
      });
  }, [http, workspaceId]);

  const handleImport = async () => {
    setLoading(true);
    const body: Record<string, unknown> = { ndjson, createNewCopies: true };
    if (workspaceId) {
      body.workspaceId = workspaceId;
    } else if (workspaceMode === 'existing' && selectedWorkspace[0]) {
      body.workspaceId = selectedWorkspace[0].value;
    }
    // Note: "Create new workspace" mode deferred to Sprint 4 (workspace-aware scoping)
    try {
      const result = await http.post<ImportResponse>('/api/saved_object_migration/import', {
        body: JSON.stringify(body),
      });
      dispatch({ type: 'SET_IMPORT_RESULT', payload: result });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setLoading(false);
    }
  };

  const workspaceModeOptions = [
    { id: 'none', label: i18n.translate('savedObjectMigration.importConfig.noWorkspace', { defaultMessage: 'No workspace' }) },
    { id: 'existing', label: i18n.translate('savedObjectMigration.importConfig.existingWorkspace', { defaultMessage: 'Existing workspace' }) },
    { id: 'new', label: i18n.translate('savedObjectMigration.importConfig.newWorkspace', { defaultMessage: 'Create new workspace' }) },
  ];

  const workspaceTypeOptions = Object.keys(WORKSPACE_TYPES).map((t) => ({ value: t, text: t }));

  return (
    <>
      <EuiSpacer />

      {repairChanges.length > 0 && (
        <>
          <EuiCallOut
            title={i18n.translate('savedObjectMigration.importConfig.repairSummary', {
              defaultMessage: 'Repair applied ({count} changes)',
              values: { count: repairChanges.length },
            })}
            color="success"
            iconType="check"
          >
            <ul>
              {repairChanges.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </EuiCallOut>
          <EuiSpacer />
        </>
      )}

      <EuiPanel paddingSize="l">
        <EuiTitle size="xs">
          <h3>{i18n.translate('savedObjectMigration.importConfig.title', { defaultMessage: 'Import Options' })}</h3>
        </EuiTitle>
        <EuiSpacer size="m" />

        <EuiSpacer size="m" />
        <EuiTitle size="xxs">
          <h4>{i18n.translate('savedObjectMigration.importConfig.workspaceTitle', { defaultMessage: 'Workspace' })}</h4>
        </EuiTitle>
        <EuiSpacer size="s" />

        {workspaceId ? (
          <EuiText size="s" color="subdued">
            {i18n.translate('savedObjectMigration.importConfig.workspaceScoped', {
              defaultMessage: 'Importing into current workspace',
            })}
          </EuiText>
        ) : (
          <>
            <EuiRadioGroup
              options={workspaceModeOptions}
              idSelected={workspaceMode}
              onChange={(id) => setWorkspaceMode(id as WorkspaceMode)}
            />
            <EuiSpacer size="s" />
          </>
        )}

        {!workspaceId && workspaceMode === 'existing' && (
          <EuiFormRow label={i18n.translate('savedObjectMigration.importConfig.selectWorkspace', { defaultMessage: 'Workspace' })}>
            <EuiComboBox
              singleSelection={{ asPlainText: true }}
              options={existingWorkspaces}
              selectedOptions={selectedWorkspace}
              onChange={(s) => setSelectedWorkspace(s as Array<{ label: string; value: string }>)}
            />
          </EuiFormRow>
        )}

        {!workspaceId && workspaceMode === 'new' && (
          <>
            <EuiFormRow label={i18n.translate('savedObjectMigration.importConfig.workspaceName', { defaultMessage: 'Name' })}>
              <EuiFieldText value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} />
            </EuiFormRow>
            <EuiFormRow label={i18n.translate('savedObjectMigration.importConfig.workspaceType', { defaultMessage: 'Type' })}>
              <EuiSelect options={workspaceTypeOptions} value={newWorkspaceType} onChange={(e) => setNewWorkspaceType(e.target.value)} />
            </EuiFormRow>
          </>
        )}
      </EuiPanel>

      <EuiSpacer />
      <EuiFlexGroup justifyContent="spaceBetween">
        <EuiFlexItem grow={false}>
          <EuiButton onClick={() => dispatch({ type: 'PREV_STEP' })}>
            {i18n.translate('savedObjectMigration.import.backButton', { defaultMessage: 'Back' })}
          </EuiButton>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton fill onClick={handleImport} isLoading={loading}>
            {i18n.translate('savedObjectMigration.importConfig.importButton', { defaultMessage: 'Import' })}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
};
