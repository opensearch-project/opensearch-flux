import React from 'react';
import { useHistory } from 'react-router-dom';
import {
  EuiPageHeader,
  EuiFlexGroup,
  EuiFlexItem,
  EuiCard,
  EuiButton,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';

export const LandingPage: React.FC = () => {
  const history = useHistory();

  return (
    <>
      <EuiPageHeader
        pageTitle={i18n.translate('savedObjectMigration.landingPage.title', {
          defaultMessage: 'Saved Object Migration',
        })}
      />
      <EuiFlexGroup gutterSize="l">
        <EuiFlexItem>
          <EuiCard
            icon={<span style={{ fontSize: '48px' }}>📤</span>}
            title={i18n.translate('savedObjectMigration.landingPage.exportCard.title', {
              defaultMessage: 'Export Dashboards',
            })}
            description={i18n.translate('savedObjectMigration.landingPage.exportCard.description', {
              defaultMessage: 'Select dashboards to export as NDJSON with all dependencies',
            })}
            footer={
              <EuiButton onClick={() => history.push('/export')}>
                {i18n.translate('savedObjectMigration.landingPage.exportCard.button', {
                  defaultMessage: 'Start Export',
                })}
              </EuiButton>
            }
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiCard
            icon={<span style={{ fontSize: '48px' }}>📥</span>}
            title={i18n.translate('savedObjectMigration.landingPage.importCard.title', {
              defaultMessage: 'Import Dashboards',
            })}
            description={i18n.translate('savedObjectMigration.landingPage.importCard.description', {
              defaultMessage: 'Upload NDJSON to inspect, repair, and import into this instance',
            })}
            footer={
              <EuiButton onClick={() => history.push('/import')}>
                {i18n.translate('savedObjectMigration.landingPage.importCard.button', {
                  defaultMessage: 'Start Import',
                })}
              </EuiButton>
            }
          />
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
};
