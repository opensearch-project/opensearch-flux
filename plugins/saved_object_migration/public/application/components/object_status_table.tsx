import React from 'react';
import { EuiBasicTable, EuiBasicTableColumn, EuiBadge } from '@elastic/eui';
import { i18n } from '@osd/i18n';

interface ObjectStatus {
  id: string;
  type: string;
  title: string;
  status: 'ok' | 'warning' | 'error';
  issues: string[];
}

interface ObjectStatusTableProps {
  objects: ObjectStatus[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
}

export const ObjectStatusTable: React.FC<ObjectStatusTableProps> = ({
  objects,
  selectedIds,
  onSelectionChange,
}) => {
  const columns: Array<EuiBasicTableColumn<ObjectStatus>> = [
    {
      field: 'type',
      name: i18n.translate('savedObjectMigration.objectStatusTable.typeColumn', {
        defaultMessage: 'Type',
      }),
    },
    {
      field: 'title',
      name: i18n.translate('savedObjectMigration.objectStatusTable.titleColumn', {
        defaultMessage: 'Title',
      }),
    },
    {
      field: 'status',
      name: i18n.translate('savedObjectMigration.objectStatusTable.statusColumn', {
        defaultMessage: 'Status',
      }),
      render: (status: 'ok' | 'warning' | 'error') => {
        const colorMap = { ok: 'success', warning: 'warning', error: 'danger' } as const;
        const labelMap = {
          ok: i18n.translate('savedObjectMigration.objectStatusTable.statusOk', {
            defaultMessage: 'OK',
          }),
          warning: i18n.translate('savedObjectMigration.objectStatusTable.statusWarning', {
            defaultMessage: 'Warning',
          }),
          error: i18n.translate('savedObjectMigration.objectStatusTable.statusError', {
            defaultMessage: 'Error',
          }),
        };
        return <EuiBadge color={colorMap[status]}>{labelMap[status]}</EuiBadge>;
      },
    },
    {
      field: 'issues',
      name: i18n.translate('savedObjectMigration.objectStatusTable.issuesColumn', {
        defaultMessage: 'Issues',
      }),
      render: (issues: string[]) =>
        issues.length > 0
          ? issues.join(', ')
          : i18n.translate('savedObjectMigration.objectStatusTable.noIssues', {
              defaultMessage: '—',
            }),
    },
  ];

  const selection = {
    selectable: () => true,
    onSelectionChange: (selected: ObjectStatus[]) => {
      onSelectionChange(new Set(selected.map((obj) => obj.id)));
    },
    initialSelected: objects.filter((obj) => selectedIds.has(obj.id)),
  };

  return (
    <EuiBasicTable
      items={objects}
      columns={columns}
      itemId="id"
      selection={selection}
      aria-label={i18n.translate('savedObjectMigration.objectStatusTable.tableLabel', {
        defaultMessage: 'Saved objects migration status',
      })}
    />
  );
};
