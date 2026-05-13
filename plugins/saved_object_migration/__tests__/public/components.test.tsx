import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StepIndicator } from '../../public/application/components/step_indicator';
import { InspectionReportDisplay } from '../../public/application/components/inspection_report';
import { ErrorBanner } from '../../public/application/components/error_banner';
import { InspectionReport } from '../../common/types';

describe('StepIndicator', () => {
  it('should render all steps', () => {
    const steps = [
      { title: 'Step 1', status: 'complete' as const },
      { title: 'Step 2', status: 'current' as const },
      { title: 'Step 3', status: 'incomplete' as const },
    ];
    render(<StepIndicator steps={steps} />);
    // EUI's horizontal step indicator renders each title in both a visible
    // node and a screen-reader-only node, so getByText finds duplicates.
    expect(screen.getAllByText('Step 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Step 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Step 3').length).toBeGreaterThan(0);
  });

  it('should render with empty steps array', () => {
    const { container } = render(<StepIndicator steps={[]} />);
    expect(container.querySelector('.euiStepsHorizontal')).toBeInTheDocument();
  });

  it('should render disabled status', () => {
    const steps = [{ title: 'Disabled Step', status: 'disabled' as const }];
    render(<StepIndicator steps={steps} />);
    expect(screen.getByText('Disabled Step')).toBeInTheDocument();
  });
});

describe('InspectionReportDisplay', () => {
  const mockReport: InspectionReport = {
    summary: {
      totalObjects: 5,
      errors: 1,
      warnings: 2,
      info: 1,
    },
    objectsByType: {
      dashboard: 2,
      visualization: 3,
    },
    issues: [
      {
        severity: 'ERROR',
        type: 'MISSING_REFERENCE',
        objectId: 'dash1',
        objectType: 'dashboard',
        message: 'Missing reference error',
        phase: 'PRE_EXPORT',
      },
      {
        severity: 'WARNING',
        type: 'NON_RENDERABLE_TYPE',
        objectId: 'vis1',
        objectType: 'visualization',
        message: 'Non-renderable type warning',
        phase: 'PRE_IMPORT',
      },
      {
        severity: 'WARNING',
        type: 'MISSING_PERMISSIONS',
        objectId: '',
        objectType: '',
        message: 'Missing permissions warning',
        phase: 'PRE_IMPORT',
      },
      {
        severity: 'INFO',
        type: 'OBJECT_COUNT',
        objectId: '',
        objectType: '',
        message: 'Object count info',
        phase: 'PRE_EXPORT',
      },
    ],
    targetPlatform: 'opensearch-ui',
    nonRenderableTypeSummary: { query: 1 },
  };

  it('should render total objects count', () => {
    render(<InspectionReportDisplay report={mockReport} />);
    expect(screen.getByText(/Total Objects: 5/i)).toBeInTheDocument();
  });

  it('should render type breakdown table', () => {
    render(<InspectionReportDisplay report={mockReport} />);
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.getByText('visualization')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should render error callout with error messages', () => {
    render(<InspectionReportDisplay report={mockReport} />);
    expect(screen.getByText(/Errors \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Missing reference error')).toBeInTheDocument();
  });

  it('should render warning callout with warning messages', () => {
    render(<InspectionReportDisplay report={mockReport} />);
    expect(screen.getByText(/Warnings \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('Non-renderable type warning')).toBeInTheDocument();
    expect(screen.getByText('Missing permissions warning')).toBeInTheDocument();
  });

  it('should render info callout with info messages', () => {
    render(<InspectionReportDisplay report={mockReport} />);
    expect(screen.getByText(/Info \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Object count info')).toBeInTheDocument();
  });

  it('should not render error callout when no errors', () => {
    const reportNoErrors: InspectionReport = {
      ...mockReport,
      summary: { ...mockReport.summary, errors: 0 },
      issues: mockReport.issues.filter((i) => i.severity !== 'ERROR'),
    };
    render(<InspectionReportDisplay report={reportNoErrors} />);
    expect(screen.queryByText(/Errors/i)).not.toBeInTheDocument();
  });

  it('should not render warning callout when no warnings', () => {
    const reportNoWarnings: InspectionReport = {
      ...mockReport,
      summary: { ...mockReport.summary, warnings: 0 },
      issues: mockReport.issues.filter((i) => i.severity !== 'WARNING'),
    };
    render(<InspectionReportDisplay report={reportNoWarnings} />);
    expect(screen.queryByText(/Warnings/i)).not.toBeInTheDocument();
  });

  it('should not render info callout when no info', () => {
    const reportNoInfo: InspectionReport = {
      ...mockReport,
      summary: { ...mockReport.summary, info: 0 },
      issues: mockReport.issues.filter((i) => i.severity !== 'INFO'),
    };
    render(<InspectionReportDisplay report={reportNoInfo} />);
    expect(screen.queryByText(/Info/i)).not.toBeInTheDocument();
  });

  it('should render empty report', () => {
    const emptyReport: InspectionReport = {
      summary: { totalObjects: 0, errors: 0, warnings: 0, info: 0 },
      objectsByType: {},
      issues: [],
      targetPlatform: null,
      nonRenderableTypeSummary: null,
    };
    render(<InspectionReportDisplay report={emptyReport} />);
    expect(screen.getByText(/Total Objects: 0/i)).toBeInTheDocument();
  });
});

describe('ErrorBanner', () => {
  it('should render error message from string', () => {
    render(<ErrorBanner title="Error Title" error="Error message" />);
    expect(screen.getByText('Error Title')).toBeInTheDocument();
    expect(screen.getByText('Error message')).toBeInTheDocument();
  });

  it('should render error message from Error object', () => {
    const error = new Error('Error object message');
    render(<ErrorBanner title="Error Title" error={error} />);
    expect(screen.getByText('Error Title')).toBeInTheDocument();
    expect(screen.getByText('Error object message')).toBeInTheDocument();
  });

  it('should render with danger color', () => {
    const { container } = render(<ErrorBanner title="Error" error="Message" />);
    const callout = container.querySelector('.euiCallOut--danger');
    expect(callout).toBeInTheDocument();
  });

  it('should render alert icon', () => {
    const { container } = render(<ErrorBanner title="Error" error="Message" />);
    const icon = container.querySelector('[data-euiicon-type="alert"]');
    expect(icon).toBeInTheDocument();
  });

  it('should call onDismiss when dismiss button is clicked', () => {
    const onDismiss = jest.fn();
    render(<ErrorBanner title="Error" error="Message" onDismiss={onDismiss} />);
    const dismissButton = screen.getByLabelText(/dismiss/i);
    dismissButton.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should not render dismiss button when onDismiss is not provided', () => {
    render(<ErrorBanner title="Error" error="Message" />);
    const dismissButton = screen.queryByLabelText(/dismiss/i);
    expect(dismissButton).not.toBeInTheDocument();
  });
});
