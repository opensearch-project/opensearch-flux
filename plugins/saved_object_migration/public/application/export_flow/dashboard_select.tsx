import React, { useState, useEffect } from 'react';
import {
  EuiBasicTable,
  EuiButton,
  EuiSpacer,
  EuiSearchBar,
  EuiFlexGroup,
  EuiFlexItem,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { CoreStart } from '../../../../../src/core/public';
import { DashboardsResponse, ExportResponse, InspectResponse } from '../../../common/api_types';

interface Dashboard {
  id: string;
  title: string;
  description?: string;
}

interface DashboardSelectProps {
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  dispatch: React.Dispatch<any>;
  workspaceId?: string;
}

export const DashboardSelect: React.FC<DashboardSelectProps> = ({
  http,
  notifications,
  dispatch,
  workspaceId,
}) => {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [filteredDashboards, setFilteredDashboards] = useState<Dashboard[]>([]);
  const [selectedItems, setSelectedItems] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const fetchDashboards = async () => {
      setLoading(true);
      try {
        const response = await http.get<DashboardsResponse>(
          '/api/saved_object_migration/dashboards',
          workspaceId ? { query: { workspaceId } } : undefined
        );
        setDashboards(response.dashboards);
        setFilteredDashboards(response.dashboards);
      } catch (error) {
        notifications.toasts.addDanger({
          title: i18n.translate('savedObjectMigration.export.fetchError', {
            defaultMessage: 'Failed to fetch dashboards',
          }),
        });
      } finally {
        setLoading(false);
      }
    };
    fetchDashboards();
  }, [http, notifications, workspaceId]);

  const handleExport = async () => {
    setLoading(true);
    try {
      const exportResponse = await http.post<ExportResponse>(
        '/api/saved_object_migration/export',
        { body: JSON.stringify({ objects: selectedItems.map((d) => ({ type: 'dashboard', id: d.id })) }) }
      );

      const inspectResponse = await http.post<InspectResponse>(
        '/api/saved_object_migration/inspect',
        { body: JSON.stringify({ ndjson: exportResponse.ndjson }) }
      );

      dispatch({
        type: 'SET_EXPORT_RESULT',
        payload: { ndjson: exportResponse.ndjson, inspectionReport: inspectResponse },
      });
    } catch (error) {
      notifications.toasts.addDanger({
        title: i18n.translate('savedObjectMigration.export.exportError', {
          defaultMessage: 'Export failed',
        }),
      });
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      field: 'title',
      name: i18n.translate('savedObjectMigration.export.titleColumn', {
        defaultMessage: 'Dashboard Title',
      }),
    },
    {
      field: 'id',
      name: i18n.translate('savedObjectMigration.export.idColumn', {
        defaultMessage: 'ID',
      }),
    },
  ];

  const pagination = {
    pageIndex,
    pageSize,
    totalItemCount: filteredDashboards.length,
    pageSizeOptions: [10, 25, 50],
  };

  const selection = {
    selectable: () => true,
    onSelectionChange: setSelectedItems,
  };

  const onTableChange = ({ page }: any) => {
    if (page) {
      setPageIndex(page.index);
      setPageSize(page.size);
    }
  };

  const onSearch = ({ query }: any) => {
    if (query) {
      const filtered = dashboards.filter((d) =>
        d.title.toLowerCase().includes(query.text.toLowerCase())
      );
      setFilteredDashboards(filtered);
    } else {
      setFilteredDashboards(dashboards);
    }
    setPageIndex(0);
  };

  return (
    <>
      <EuiSearchBar onChange={onSearch} />
      <EuiSpacer />
      <EuiBasicTable
        items={filteredDashboards.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)}
        itemId="id"
        columns={columns}
        pagination={pagination}
        selection={selection}
        loading={loading}
        onChange={onTableChange}
      />
      <EuiSpacer />
      <EuiFlexGroup justifyContent="flexEnd">
        <EuiFlexItem grow={false}>
          <EuiButton
            fill
            onClick={handleExport}
            disabled={selectedItems.length === 0 || loading}
            isLoading={loading}
          >
            {i18n.translate('savedObjectMigration.export.nextButton', {
              defaultMessage: 'Next',
            })}
          </EuiButton>
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
};
