import React, { useState, useEffect } from 'react';
import { I18nProvider } from '@osd/i18n/react';
import { HashRouter, Route, Switch } from 'react-router-dom';
import { EuiPage, EuiPageBody } from '@elastic/eui';
import { CoreStart } from '../../../../src/core/public';
import { LandingPage } from './landing_page';
import { ExportFlow } from './export_flow';
import { ImportFlow } from './import_flow';

interface SavedObjectMigrationAppProps {
  http: CoreStart['http'];
  notifications: CoreStart['notifications'];
  workspaces: CoreStart['workspaces'];
}

export const SavedObjectMigrationApp: React.FC<SavedObjectMigrationAppProps> = ({
  http,
  notifications,
  workspaces,
}) => {
  const [workspaceId, setWorkspaceId] = useState<string | undefined>();

  useEffect(() => {
    const sub = workspaces.currentWorkspaceId$.subscribe((id) => {
      setWorkspaceId(id || undefined);
    });
    return () => sub.unsubscribe();
  }, [workspaces]);

  return (
    <I18nProvider>
      <HashRouter>
        <EuiPage>
          <EuiPageBody>
            <Switch>
              <Route exact path="/" component={LandingPage} />
              <Route
                path="/export"
                render={() => (
                  <ExportFlow http={http} notifications={notifications} workspaceId={workspaceId} />
                )}
              />
              <Route
                path="/import"
                render={() => (
                  <ImportFlow http={http} notifications={notifications} workspaceId={workspaceId} />
                )}
              />
            </Switch>
          </EuiPageBody>
        </EuiPage>
      </HashRouter>
    </I18nProvider>
  );
};
