import React from 'react';
import ReactDOM from 'react-dom';
import { CoreStart, AppMountParameters } from '../../../../src/core/public';
import { AppPluginStartDependencies } from '../types';
import { SavedObjectMigrationApp } from './app';

export const renderApp = (
  core: CoreStart,
  deps: AppPluginStartDependencies,
  { element }: AppMountParameters
) => {
  ReactDOM.render(
    <SavedObjectMigrationApp http={core.http} notifications={core.notifications} workspaces={core.workspaces} />,
    element
  );
  return () => ReactDOM.unmountComponentAtNode(element);
};
