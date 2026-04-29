import React, { useMemo, useState } from 'react';
import { EuiBadge, EuiButton, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiText } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { InspectionReport, RepairConfig, SavedObject } from '../../../common/types';
import { inspect, InspectionContext } from '../../../common/inspector';
import { parseNdjsonFile } from '../../../common/repair';
import { ObjectStatusTable } from '../components';
import { ImportFlowAction } from './index';

interface PreviewProps {
  ndjson: string;
  originalReport: InspectionReport;
  repairConfig?: RepairConfig;
  dispatch: React.Dispatch<ImportFlowAction>;
}

export const Preview: React.FC<PreviewProps> = ({ ndjson, originalReport, repairConfig, dispatch }) => {
  const { objects, previewReport, objectStatuses } = useMemo(() => {
    const parsed = parseNdjsonFile(ndjson) as SavedObject[];

    // Build context: if user remapped data sources, mark the target ID as known external
    const inspectContext: InspectionContext = {};
    if (repairConfig?.remapDataSources?.enabled && repairConfig.remapDataSources.targetId) {
      inspectContext.knownExternalIds = new Set([repairConfig.remapDataSources.targetId]);
    }

    const report = inspect(parsed, inspectContext);

    // Build issue lookup by objectId
    const issuesByObject = new Map<string, { severity: string; message: string }[]>();
    for (const issue of report.issues) {
      if (!issue.objectId) continue;
      const list = issuesByObject.get(issue.objectId) ?? [];
      list.push({ severity: issue.severity, message: issue.message });
      issuesByObject.set(issue.objectId, list);
    }

    const statuses = parsed.map((obj) => {
      const issues = issuesByObject.get(obj.id) ?? [];
      const hasError = issues.some((i) => i.severity === 'ERROR');
      const hasWarning = issues.some((i) => i.severity === 'WARNING' || i.severity === 'INFO');
      return {
        id: obj.id,
        type: obj.type,
        title: (obj.attributes?.title as string) || obj.id,
        status: (hasError ? 'error' : hasWarning ? 'warning' : 'ok') as 'ok' | 'warning' | 'error',
        issues: issues.map((i) => i.message),
      };
    });

    return { objects: parsed, previewReport: report, objectStatuses: statuses };
  }, [ndjson]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(objectStatuses.map((o) => o.id))
  );

  const resolved = originalReport.summary.errors + originalReport.summary.warnings - previewReport.summary.errors - previewReport.summary.warnings;
  const remaining = previewReport.summary.errors + previewReport.summary.warnings;

  const handleProceed = () => {
    // Filter NDJSON to only selected objects
    const selectedSet = selectedIds;
    const filteredLines = ndjson
      .trim()
      .split('\n')
      .filter((line) => {
        try {
          const obj = JSON.parse(line);
          if (!obj.type || !obj.id) return true; // keep metadata lines
          return selectedSet.has(obj.id);
        } catch {
          return true;
        }
      });
    dispatch({
      type: 'SET_PREVIEW_RESULT',
      payload: {
        previewReport,
        selectedObjectIds: selectedIds,
        filteredNdjson: filteredLines.join('\n') + '\n',
      },
    });
  };

  return (
    <>
      <EuiSpacer />
      <EuiCallOut
        title={i18n.translate('savedObjectMigration.preview.summary', {
          defaultMessage: '{resolved} issues resolved, {remaining} remaining',
          values: { resolved: Math.max(0, resolved), remaining },
        })}
        color={remaining === 0 ? 'success' : 'warning'}
        iconType={remaining === 0 ? 'check' : 'alert'}
      />
      <EuiSpacer />
      <EuiFlexGroup gutterSize="l" alignItems="center">
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiBadge color="success">
                {i18n.translate('savedObjectMigration.preview.legendOkBadge', {
                  defaultMessage: 'OK',
                })}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="s">
                {i18n.translate('savedObjectMigration.preview.legendOk', {
                  defaultMessage: 'Ready to import with no known issues',
                })}
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiBadge color="warning">
                {i18n.translate('savedObjectMigration.preview.legendWarningBadge', {
                  defaultMessage: 'Warning',
                })}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="s">
                {i18n.translate('savedObjectMigration.preview.legendWarning', {
                  defaultMessage: 'Minor issues, should import successfully',
                })}
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiBadge color="danger">
                {i18n.translate('savedObjectMigration.preview.legendErrorBadge', {
                  defaultMessage: 'Error',
                })}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="s">
                {i18n.translate('savedObjectMigration.preview.legendError', {
                  defaultMessage: 'Unresolved issues, may not work correctly',
                })}
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer />
      <ObjectStatusTable
        objects={objectStatuses}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <EuiSpacer />
      <EuiFlexGroup justifyContent="spaceBetween">
        <EuiFlexItem grow={false}>
          <EuiButton onClick={() => dispatch({ type: 'PREV_STEP' })}>
            {i18n.translate('savedObjectMigration.import.backButton', { defaultMessage: 'Back' })}
          </EuiButton>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButton fill onClick={handleProceed} disabled={selectedIds.size === 0}>
            {i18n.translate('savedObjectMigration.preview.proceedButton', {
              defaultMessage: 'Proceed to Import ({count} objects)',
              values: { count: selectedIds.size },
            })}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
};
