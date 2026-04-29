import React from 'react';
import {
  EuiButton,
  EuiCallOut,
  EuiSpacer,
  EuiBasicTable,
  EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useHistory } from 'react-router-dom';
import { ImportResult } from './index';

interface ResultProps {
  result: ImportResult;
}

export const Result: React.FC<ResultProps> = ({ result }) => {
  const history = useHistory();

  const typeBreakdown = Object.entries(result.successByType || {}).map(([type, count]) => ({ type, count }));
  const typeColumns: Array<EuiBasicTableColumn<{ type: string; count: number }>> = [
    { field: 'type', name: i18n.translate('savedObjectMigration.result.typeColumn', { defaultMessage: 'Type' }) },
    { field: 'count', name: i18n.translate('savedObjectMigration.result.countColumn', { defaultMessage: 'Count' }) },
  ];

  const errorColumns: Array<EuiBasicTableColumn<{ id: string; type: string; error: { type: string; message: string } }>> = [
    { field: 'type', name: i18n.translate('savedObjectMigration.result.errorType', { defaultMessage: 'Type' }) },
    { field: 'id', name: i18n.translate('savedObjectMigration.result.errorId', { defaultMessage: 'ID' }) },
    { field: 'error.message', name: i18n.translate('savedObjectMigration.result.errorMessage', { defaultMessage: 'Error' }) },
  ];

  return (
    <>
      <EuiSpacer />
      <EuiCallOut
        title={
          result.success
            ? i18n.translate('savedObjectMigration.result.successTitle', {
                defaultMessage: 'Import successful — {count} objects imported',
                values: { count: result.successCount },
              })
            : i18n.translate('savedObjectMigration.result.partialTitle', {
                defaultMessage: 'Import completed with errors',
              })
        }
        color={result.success ? 'success' : 'warning'}
        iconType={result.success ? 'check' : 'alert'}
      />

      {typeBreakdown.length > 0 && (
        <>
          <EuiSpacer size="m" />
          <EuiBasicTable items={typeBreakdown} columns={typeColumns} />
        </>
      )}

      {result.errors?.length > 0 && (
        <>
          <EuiSpacer size="m" />
          <EuiCallOut
            title={i18n.translate('savedObjectMigration.result.errorsTitle', {
              defaultMessage: '{count} errors',
              values: { count: result.errors.length },
            })}
            color="danger"
          />
          <EuiSpacer size="s" />
          <EuiBasicTable items={result.errors} columns={errorColumns} />
        </>
      )}

      <EuiSpacer />
      <EuiButton onClick={() => history.push('/')}>
        {i18n.translate('savedObjectMigration.result.returnButton', { defaultMessage: 'Return to Home' })}
      </EuiButton>
      {result.dashboardUrl && (
        <>
          {' '}
          <EuiButton fill href={result.dashboardUrl}>
            {i18n.translate('savedObjectMigration.result.viewDashboard', { defaultMessage: 'View Dashboard' })}
          </EuiButton>
        </>
      )}
    </>
  );
};
