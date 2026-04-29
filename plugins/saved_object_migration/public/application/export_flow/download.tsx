import React, { useEffect } from 'react';
import { EuiButton, EuiCallOut, EuiSpacer, EuiText } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { useHistory } from 'react-router-dom';

interface DownloadProps {
  ndjson: string;
}

export const Download: React.FC<DownloadProps> = ({ ndjson }) => {
  const history = useHistory();

  useEffect(() => {
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `migration-export-${Date.now()}.ndjson`;
    link.click();
    URL.revokeObjectURL(url);
  }, [ndjson]);

  return (
    <>
      <EuiSpacer />
      <EuiCallOut
        title={i18n.translate('savedObjectMigration.export.downloadSuccess', {
          defaultMessage: 'Export Complete',
        })}
        color="success"
        iconType="check"
      >
        <EuiText>
          {i18n.translate('savedObjectMigration.export.downloadInstructions', {
            defaultMessage:
              'Your dashboards have been exported. The file has been downloaded to your browser.',
          })}
        </EuiText>
      </EuiCallOut>
      <EuiSpacer />
      <EuiButton onClick={() => history.push('/')}>
        {i18n.translate('savedObjectMigration.export.returnButton', {
          defaultMessage: 'Return to Home',
        })}
      </EuiButton>
    </>
  );
};
