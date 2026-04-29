import React from 'react';
import { render, screen } from '@testing-library/react';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import '@testing-library/jest-dom';
import { LandingPage } from '../../public/application/landing_page';

describe('LandingPage', () => {
  it('should render page title', () => {
    const history = createMemoryHistory();
    render(
      <Router history={history}>
        <LandingPage />
      </Router>
    );
    expect(screen.getByText(/Saved Object Migration/i)).toBeInTheDocument();
  });

  it('should render export card with correct content', () => {
    const history = createMemoryHistory();
    render(
      <Router history={history}>
        <LandingPage />
      </Router>
    );
    expect(screen.getByText(/Export Dashboards/i)).toBeInTheDocument();
    expect(screen.getByText(/Select dashboards to export/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Export/i)).toBeInTheDocument();
  });

  it('should render import card with correct content', () => {
    const history = createMemoryHistory();
    render(
      <Router history={history}>
        <LandingPage />
      </Router>
    );
    expect(screen.getByText(/Import Dashboards/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload NDJSON to inspect/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Import/i)).toBeInTheDocument();
  });

  it('should navigate to /export when export button is clicked', () => {
    const history = createMemoryHistory();
    render(
      <Router history={history}>
        <LandingPage />
      </Router>
    );
    const exportButton = screen.getByText(/Start Export/i);
    exportButton.click();
    expect(history.location.pathname).toBe('/export');
  });

  it('should navigate to /import when import button is clicked', () => {
    const history = createMemoryHistory();
    render(
      <Router history={history}>
        <LandingPage />
      </Router>
    );
    const importButton = screen.getByText(/Start Import/i);
    importButton.click();
    expect(history.location.pathname).toBe('/import');
  });
});
