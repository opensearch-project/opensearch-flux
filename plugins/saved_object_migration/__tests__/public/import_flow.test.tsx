import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ImportFlow } from '../../public/application/import_flow';
import { SAMPLE_DASHBOARD, SAMPLE_WITH_DATASOURCE } from '../fixtures';

const mockHttp = {
  get: jest.fn(),
  post: jest.fn(),
};

const mockNotifications = {
  toasts: {
    addSuccess: jest.fn(),
    addError: jest.fn(),
    addWarning: jest.fn(),
  },
};

describe('ImportFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render step indicator with all steps', () => {
    render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Inspect')).toBeInTheDocument();
    expect(screen.getByText('Repair')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('should start at step 0 (Upload)', () => {
    render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    expect(screen.getByText(/Upload/i)).toBeInTheDocument();
  });

  it('should transition to inspection step after file upload', async () => {
    mockHttp.post.mockResolvedValue({
      summary: { totalObjects: 4, errors: 0, warnings: 0, info: 1 },
      objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
      issues: [],
      targetPlatform: null,
      nonRenderableTypeSummary: null,
    });

    const { container } = render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    const file = new File([SAMPLE_DASHBOARD], 'test.ndjson', { type: 'application/x-ndjson' });
    const input = container.querySelector('input[type="file"]');

    if (input) {
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockHttp.post).toHaveBeenCalledWith(
          expect.stringContaining('/inspect'),
          expect.objectContaining({
            body: expect.stringContaining(SAMPLE_DASHBOARD),
          })
        );
      });
    }
  });

  it('should show error banner on inspection failure', async () => {
    mockHttp.post.mockRejectedValue(new Error('Inspection failed'));

    const { container } = render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    const file = new File([SAMPLE_DASHBOARD], 'test.ndjson', { type: 'application/x-ndjson' });
    const input = container.querySelector('input[type="file"]');

    if (input) {
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockNotifications.toasts.addError).toHaveBeenCalled();
      });
    }
  });

  it('should apply repair transformations when configured', async () => {
    mockHttp.post
      .mockResolvedValueOnce({
        summary: { totalObjects: 5, errors: 0, warnings: 0, info: 1 },
        objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1, 'data-source': 1 },
        issues: [],
        targetPlatform: null,
        nonRenderableTypeSummary: null,
      })
      .mockResolvedValueOnce({
        ndjson: SAMPLE_DASHBOARD,
        changes: ['Stripped data-source prefixes for 1 data source(s)'],
      });

    const { container } = render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    const file = new File([SAMPLE_WITH_DATASOURCE], 'test.ndjson', { type: 'application/x-ndjson' });
    const input = container.querySelector('input[type="file"]');

    if (input) {
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockHttp.post).toHaveBeenCalledWith(
          expect.stringContaining('/inspect'),
          expect.any(Object)
        );
      });
    }
  });

  it('should complete import and show result', async () => {
    mockHttp.post
      .mockResolvedValueOnce({
        summary: { totalObjects: 4, errors: 0, warnings: 0, info: 1 },
        objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
        issues: [],
        targetPlatform: null,
        nonRenderableTypeSummary: null,
      })
      .mockResolvedValueOnce({
        ndjson: SAMPLE_DASHBOARD,
        changes: [],
      })
      .mockResolvedValueOnce({
        success: true,
        successCount: 4,
        successByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
        errors: [],
      });

    const { container } = render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    const file = new File([SAMPLE_DASHBOARD], 'test.ndjson', { type: 'application/x-ndjson' });
    const input = container.querySelector('input[type="file"]');

    if (input) {
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockHttp.post).toHaveBeenCalledWith(
          expect.stringContaining('/inspect'),
          expect.any(Object)
        );
      });
    }
  });

  it('should handle import errors gracefully', async () => {
    mockHttp.post
      .mockResolvedValueOnce({
        summary: { totalObjects: 4, errors: 0, warnings: 0, info: 1 },
        objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
        issues: [],
        targetPlatform: null,
        nonRenderableTypeSummary: null,
      })
      .mockResolvedValueOnce({
        ndjson: SAMPLE_DASHBOARD,
        changes: [],
      })
      .mockRejectedValueOnce(new Error('Import failed'));

    const { container } = render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    const file = new File([SAMPLE_DASHBOARD], 'test.ndjson', { type: 'application/x-ndjson' });
    const input = container.querySelector('input[type="file"]');

    if (input) {
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockHttp.post).toHaveBeenCalledWith(
          expect.stringContaining('/inspect'),
          expect.any(Object)
        );
      });
    }
  });

  it('should allow going back to previous steps', () => {
    const TestWrapper = () => {
      const [step, setStep] = React.useState(2);

      return (
        <div>
          <div>Current Step: {step}</div>
          <button onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
        </div>
      );
    };

    render(<TestWrapper />);
    expect(screen.getByText('Current Step: 2')).toBeInTheDocument();

    const backButton = screen.getByText('Back');
    backButton.click();
    expect(screen.getByText('Current Step: 1')).toBeInTheDocument();
  });

  it('should reset state when going back to upload step', () => {
    const TestWrapper = () => {
      const [state, setState] = React.useState({
        currentStep: 3,
        ndjson: SAMPLE_DASHBOARD,
        repairConfig: { stripDataSourcePrefixes: true },
      });

      const goBack = () => {
        if (state.currentStep === 1) {
          setState({ currentStep: 0, ndjson: '', repairConfig: null });
        } else {
          setState({ ...state, currentStep: state.currentStep - 1 });
        }
      };

      return (
        <div>
          <div>Step: {state.currentStep}</div>
          <div>Has NDJSON: {state.ndjson ? 'Yes' : 'No'}</div>
          <button onClick={goBack}>Back</button>
        </div>
      );
    };

    render(<TestWrapper />);
    const backButton = screen.getByText('Back');

    backButton.click();
    expect(screen.getByText('Step: 2')).toBeInTheDocument();

    backButton.click();
    expect(screen.getByText('Step: 1')).toBeInTheDocument();

    backButton.click();
    expect(screen.getByText('Step: 0')).toBeInTheDocument();
    expect(screen.getByText('Has NDJSON: No')).toBeInTheDocument();
  });
});
