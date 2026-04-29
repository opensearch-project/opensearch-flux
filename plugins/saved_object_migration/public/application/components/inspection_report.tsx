import React from 'react';
import {
  EuiCallOut,
  EuiSpacer,
  EuiText,
  EuiBasicTable,
  EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { InspectionReport } from '../../../common/types';

interface InspectionReportDisplayProps {
  report: InspectionReport;
}

export const InspectionReportDisplay: React.FC<InspectionReportDisplayProps> = ({ report }) => {
  const typeBreakdownColumns: Array<EuiBasicTableColumn<{ type: string; count: number }>> = [
    {
      field: 'type',
      name: i18n.translate('savedObjectMigration.inspectionReport.typeColumn', {
        defaultMessage: 'Type',
      }),
    },
    {
      field: 'count',
      name: i18n.translate('savedObjectMigration.inspectionReport.countColumn', {
        defaultMessage: 'Count',
      }),
    },
  ];

  const typeBreakdownData = Object.entries(report.objectsByType).map(([type, count]) => ({
    type,
    count,
  }));

  const issuesBySeverity = {
    error: report.issues.filter((issue) => issue.severity === 'ERROR'),
    warning: report.issues.filter((issue) => issue.severity === 'WARNING'),
    info: report.issues.filter((issue) => issue.severity === 'INFO'),
  };

  return (
    <div>
      {issuesBySeverity.error.length > 0 && (
        <>
          <EuiCallOut
            color="danger"
            title={i18n.translate('savedObjectMigration.inspectionReport.errors', {
              defaultMessage: 'Errors ({count})',
              values: { count: issuesBySeverity.error.length },
            })}
          >
            <ul>
              {issuesBySeverity.error.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
          </EuiCallOut>
          <EuiSpacer size="s" />
        </>
      )}

      {issuesBySeverity.warning.length > 0 && (
        <>
          <EuiCallOut
            color="warning"
            title={i18n.translate('savedObjectMigration.inspectionReport.warnings', {
              defaultMessage: 'Warnings ({count})',
              values: { count: issuesBySeverity.warning.length },
            })}
          >
            <ul>
              {issuesBySeverity.warning.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
          </EuiCallOut>
          <EuiSpacer size="s" />
        </>
      )}

      {issuesBySeverity.info.length > 0 && (
        <>
          <EuiCallOut
            color="primary"
            title={i18n.translate('savedObjectMigration.inspectionReport.info', {
              defaultMessage: 'Info ({count})',
              values: { count: issuesBySeverity.info.length },
            })}
          >
            <ul>
              {issuesBySeverity.info.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
          </EuiCallOut>
          <EuiSpacer size="s" />
        </>
      )}

      <EuiSpacer size="m" />

      <EuiText>
        <h3>
          {i18n.translate('savedObjectMigration.inspectionReport.totalObjects', {
            defaultMessage: 'Total Objects: {count}',
            values: { count: report.summary.totalObjects },
          })}
        </h3>
      </EuiText>

      {report.targetPlatform && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="s">
            {i18n.translate('savedObjectMigration.inspectionReport.platformType', {
              defaultMessage: 'Platform: {platform}',
              values: { platform: report.targetPlatform },
            })}
          </EuiText>
        </>
      )}

      <EuiSpacer size="m" />

      <EuiBasicTable
        items={typeBreakdownData}
        columns={typeBreakdownColumns}
        aria-label={i18n.translate('savedObjectMigration.inspectionReport.typeBreakdownLabel', {
          defaultMessage: 'Object type breakdown',
        })}
      />
    </div>
  );
};
