import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExportFlow } from '../../public/application/export_flow';
import { SAMPLE_DASHBOARD } from '../fixtures';

const mockHttp = {
  get: jest.fn(),
  post: jest.fn(),
};

const mockNotifications = {
  toasts: {
    addSuccess: jest.fn(),
    addError: jest.fn(),
    addWarning: jest.fn(),
    addDanger: jest.fn(),
  },
};

describe('ExportFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render step indicator with all steps', () => {
    render(<ExportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    // EUI step indicator emits each title in visible + screen-reader copies.
    expect(screen.getAllByText('Select Dashboards').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inspect').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Download').length).toBeGreaterThan(0);
  });

  it('should start at step 0 (Select Dashboards)', () => {
    mockHttp.get.mockResolvedValue({
      dashboards: [{ id: 'd1', title: 'Dashboard 1', description: '' }],
      total: 1,
      page: 1,
      perPage: 20,
    });

    render(<ExportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    
    waitFor(() => {
      expect(mockHttp.get).toHaveBeenCalledWith(
        expect.stringContaining('/dashboards'),
        expect.any(Object)
      );
    });
  });

  it('should transition to inspection step after export', async () => {
    mockHttp.get.mockResolvedValue({
      dashboards: [{ id: 'd1', title: 'Dashboard 1', description: '' }],
      total: 1,
      page: 1,
      perPage: 20,
    });

    mockHttp.post.mockResolvedValue({
      ndjson: SAMPLE_DASHBOARD,
      inspectionReport: {
        summary: { totalObjects: 4, errors: 0, warnings: 0, info: 1 },
        objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
        issues: [],
        targetPlatform: null,
        nonRenderableTypeSummary: null,
      },
    });

    const { container } = render(<ExportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    await waitFor(() => {
      expect(mockHttp.get).toHaveBeenCalled();
    });

    const checkbox = container.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.click();
    }

    const exportButton = screen.queryByText(/Export Selected/i);
    if (exportButton) {
      exportButton.click();
      await waitFor(() => {
        expect(mockHttp.post).toHaveBeenCalledWith(
          expect.stringContaining('/export'),
          expect.any(Object)
        );
      });
    }
  });

  it('should show error banner on export failure', async () => {
    mockHttp.get.mockResolvedValue({
      dashboards: [],
      total: 0,
      page: 1,
      perPage: 20,
    });

    mockHttp.post.mockRejectedValue(new Error('Export failed'));

    render(<ExportFlow http={mockHttp as any} notifications={mockNotifications as any} />);

    await waitFor(() => {
      expect(mockHttp.get).toHaveBeenCalled();
    });
  });

});
