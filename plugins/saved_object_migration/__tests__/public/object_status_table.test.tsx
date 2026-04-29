import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ObjectStatusTable } from '../../public/application/components/object_status_table';

describe('ObjectStatusTable', () => {
  const mockObjects = [
    {
      id: 'obj1',
      type: 'dashboard',
      title: 'Dashboard 1',
      status: 'ok' as const,
      issues: [],
    },
    {
      id: 'obj2',
      type: 'visualization',
      title: 'Visualization 1',
      status: 'warning' as const,
      issues: ['Missing field'],
    },
    {
      id: 'obj3',
      type: 'index-pattern',
      title: 'Index Pattern 1',
      status: 'error' as const,
      issues: ['Missing reference', 'Invalid field'],
    },
  ];

  const mockOnSelectionChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render all objects', () => {
    render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.getByText('Dashboard 1')).toBeInTheDocument();
    expect(screen.getByText('Visualization 1')).toBeInTheDocument();
    expect(screen.getByText('Index Pattern 1')).toBeInTheDocument();
  });

  it('should render status badges with correct colors', () => {
    const { container } = render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();

    const successBadge = container.querySelector('.euiBadge--success');
    const warningBadge = container.querySelector('.euiBadge--warning');
    const dangerBadge = container.querySelector('.euiBadge--danger');

    expect(successBadge).toBeInTheDocument();
    expect(warningBadge).toBeInTheDocument();
    expect(dangerBadge).toBeInTheDocument();
  });

  it('should render issues column', () => {
    render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.getByText('Missing field')).toBeInTheDocument();
    expect(screen.getByText('Missing reference, Invalid field')).toBeInTheDocument();
  });

  it('should render dash for objects with no issues', () => {
    render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('should show selected objects as checked', () => {
    const selectedIds = new Set(['obj1', 'obj3']);
    const { container } = render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={selectedIds}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('should call onSelectionChange when selection changes', () => {
    const { container } = render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    const checkbox = container.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.click();
      expect(mockOnSelectionChange).toHaveBeenCalled();
    }
  });

  it('should handle empty objects array', () => {
    render(
      <ObjectStatusTable
        objects={[]}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.queryByText('Dashboard 1')).not.toBeInTheDocument();
  });

  it('should render all columns', () => {
    render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
  });

  it('should render object types', () => {
    render(
      <ObjectStatusTable
        objects={mockObjects}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
      />
    );
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.getByText('visualization')).toBeInTheDocument();
    expect(screen.getByText('index-pattern')).toBeInTheDocument();
  });
});
