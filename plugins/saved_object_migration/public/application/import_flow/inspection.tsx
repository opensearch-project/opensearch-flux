import React from 'react';
import { EuiButton, EuiFlexGroup, EuiFlexItem, EuiSpacer } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { InspectionReport } from '../../../common/types';
import { InspectionReportDisplay } from '../components';
import { ImportFlowAction } from './index';

interface InspectionProps {
  inspectionReport: InspectionReport;
  dispatch: React.Dispatch<ImportFlowAction>;
}

export const Inspection: React.FC<InspectionProps> = ({ inspectionReport, dispatch }) => (
  <>
    <EuiSpacer />
    <InspectionReportDisplay report={inspectionReport} />
    <EuiSpacer />
    <EuiFlexGroup justifyContent="spaceBetween">
      <EuiFlexItem grow={false}>
        <EuiButton onClick={() => dispatch({ type: 'PREV_STEP' })}>
          {i18n.translate('savedObjectMigration.import.backButton', { defaultMessage: 'Back' })}
        </EuiButton>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiButton fill onClick={() => dispatch({ type: 'NEXT_STEP' })}>
          {i18n.translate('savedObjectMigration.import.continueToRepair', { defaultMessage: 'Continue to Repair' })}
        </EuiButton>
      </EuiFlexItem>
    </EuiFlexGroup>
  </>
);
