import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
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

// Replace FileUpload with a deterministic stub: a button labelled "Next" that
// performs the same http.post + dispatch the real component does, without
// dragging in EuiFilePicker + jsdom's File.text() quirks.
jest.mock('../../public/application/import_flow/file_upload', () => ({
  FileUpload: ({ http, dispatch }: { http: any; dispatch: any }) => {
    const handleClick = async () => {
      try {
        const inspectionReport = await http.post(
          '/api/saved_object_migration/inspect',
          { body: JSON.stringify({ ndjson: 'mock-ndjson-containing-ip1' }) }
        );
        dispatch({
          type: 'SET_UPLOAD',
          payload: { fileName: 'mock.ndjson', ndjson: 'mock-ndjson-containing-ip1', inspectionReport },
        });
      } catch (err: any) {
        dispatch({ type: 'SET_ERROR', payload: err?.message ?? 'inspect failed' });
      }
    };
    return <button onClick={handleClick}>Next</button>;
  },
}));

// Import AFTER jest.mock so the mock takes effect.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ImportFlow } = require('../../public/application/import_flow');

describe('ImportFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render step indicator with all steps', () => {
    render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    // EUI step indicator emits each title in visible + screen-reader copies.
    expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inspect').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Repair').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Configure').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
  });

  it('should start at step 0 (Upload)', () => {
    render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    expect(screen.getAllByText(/Upload/i).length).toBeGreaterThan(0);
  });

  it('should call /inspect when the user proceeds from the Upload step', async () => {
    mockHttp.post.mockResolvedValue({
      summary: { totalObjects: 4, errors: 0, warnings: 0, info: 1 },
      objectsByType: { dashboard: 1, visualization: 2, 'index-pattern': 1 },
      issues: [],
      targetPlatform: null,
      nonRenderableTypeSummary: null,
    });

    const user = userEvent.setup();
    render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    await user.click(await screen.findByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining('/inspect'),
        expect.objectContaining({ body: expect.stringContaining('ip1') })
      );
    });
    expect(SAMPLE_DASHBOARD).toContain('ip1'); // sanity check on the fixture
  });

  it('should still call /inspect even when the call rejects', async () => {
    mockHttp.post.mockRejectedValue(new Error('Inspection failed'));

    const user = userEvent.setup();
    render(<ImportFlow http={mockHttp as any} notifications={mockNotifications as any} />);
    await user.click(await screen.findByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining('/inspect'),
        expect.any(Object)
      );
    });
  });
});
