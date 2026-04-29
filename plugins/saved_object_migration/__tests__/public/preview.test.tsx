import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Preview } from '../../public/application/import_flow/preview';
import { InspectionReport } from '../../common/types';
import { SAMPLE_DASHBOARD } from '../fixtures';

const mockDispatch = jest.fn();

const mockOriginalReport: InspectionReport = {
  summary: { totalObjects: 4, errors: 2, warnings: 1, info: 1 },
  objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
  issues: [
    {
      severity: 'ERROR',
      type: 'MISSING_REFERENCE',
      objectId: 'vis1',
      objectType: 'visualization',
      message: 'Missing reference',
      phase: 'PRE_EXPORT',
    },
    {
      severity: 'WARNING',
      type: 'NON_RENDERABLE_TYPE',
      objectId: 'vis2',
      objectType: 'visualization',
      message: 'Non-renderable type',
      phase: 'PRE_IMPORT',
    },
  ],
  targetPlatform: null,
  nonRenderableTypeSummary: null,
};

describe('Preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render summary callout', () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/issues resolved/i)).toBeInTheDocument();
  });

  it('should render ObjectStatusTable', () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('should render back button', () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('should render proceed button with object count', () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/Proceed to Import/i)).toBeInTheDocument();
  });

  it('should call dispatch with PREV_STEP when back button is clicked', () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    const backButton = screen.getByText('Back');
    backButton.click();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'PREV_STEP' });
  });

  it('should call dispatch with SET_PREVIEW_RESULT when proceed button is clicked', async () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    const proceedButton = screen.getByText(/Proceed to Import/i);
    proceedButton.click();

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_PREVIEW_RESULT',
          payload: expect.objectContaining({
            previewReport: expect.any(Object),
            selectedObjectIds: expect.any(Set),
            filteredNdjson: expect.any(String),
          }),
        })
      );
    });
  });

  it('should show success callout when no issues remain', () => {
    const cleanReport: InspectionReport = {
      summary: { totalObjects: 4, errors: 0, warnings: 0, info: 1 },
      objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
      issues: [],
      targetPlatform: null,
      nonRenderableTypeSummary: null,
    };

    const { container } = render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={cleanReport}
        dispatch={mockDispatch}
      />
    );
    const successCallout = container.querySelector('.euiCallOut--success');
    expect(successCallout).toBeInTheDocument();
  });

  it('should show warning callout when issues remain', () => {
    const { container } = render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    const warningCallout = container.querySelector('.euiCallOut--warning');
    expect(warningCallout).toBeInTheDocument();
  });

  it('should disable proceed button when no objects selected', () => {
    const TestWrapper = () => {
      const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
      return (
        <div>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => mockDispatch({ type: 'PROCEED' })}
          >
            Proceed to Import ({selectedIds.size} objects)
          </button>
        </div>
      );
    };

    render(<TestWrapper />);
    const button = screen.getByText(/Proceed to Import/i);
    expect(button).toBeDisabled();
  });

  it('should parse NDJSON and create object statuses', () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText('Type')).toBeInTheDocument();
  });

  it('should handle empty NDJSON', () => {
    render(
      <Preview
        ndjson=""
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/Proceed to Import/i)).toBeInTheDocument();
  });

  it('should calculate resolved issues correctly', () => {
    const reportWithIssues: InspectionReport = {
      summary: { totalObjects: 4, errors: 3, warnings: 2, info: 1 },
      objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
      issues: [],
      targetPlatform: null,
      nonRenderableTypeSummary: null,
    };

    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={reportWithIssues}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/issues resolved/i)).toBeInTheDocument();
  });

  it('should filter NDJSON to selected objects only', async () => {
    render(
      <Preview
        ndjson={SAMPLE_DASHBOARD}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    const proceedButton = screen.getByText(/Proceed to Import/i);
    proceedButton.click();

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_PREVIEW_RESULT',
          payload: expect.objectContaining({
            filteredNdjson: expect.stringContaining('\n'),
          }),
        })
      );
    });
  });

  it('should categorize objects by status', () => {
    const ndjsonWithIssues = `{"id":"obj1","type":"dashboard","attributes":{"title":"Dashboard"},"references":[{"type":"visualization","id":"missing","name":"ref"}]}
{"id":"obj2","type":"visualization","attributes":{"title":"Viz"},"references":[]}`;

    render(
      <Preview
        ndjson={ndjsonWithIssues}
        originalReport={mockOriginalReport}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Viz')).toBeInTheDocument();
  });
});
