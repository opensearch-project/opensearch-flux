import { CoreSetup, CoreStart, Plugin, AppMountParameters, DEFAULT_NAV_GROUPS, DEFAULT_APP_CATEGORIES } from '../../../src/core/public';
import { PLUGIN_ID, PLUGIN_NAME } from '../common';
import {
  SavedObjectMigrationPluginSetup,
  SavedObjectMigrationPluginStart,
  AppPluginSetupDependencies,
  AppPluginStartDependencies,
} from './types';

export class SavedObjectMigrationPlugin
  implements
    Plugin<
      SavedObjectMigrationPluginSetup,
      SavedObjectMigrationPluginStart,
      AppPluginSetupDependencies,
      AppPluginStartDependencies
    > {
  public setup(
    core: CoreSetup<AppPluginStartDependencies, SavedObjectMigrationPluginStart>,
    _deps: AppPluginSetupDependencies
  ): SavedObjectMigrationPluginSetup {
    // No workspaceAvailability set — plugin appears in both global and workspace contexts
    core.application.register({
      id: PLUGIN_ID,
      title: PLUGIN_NAME,
      async mount(params: AppMountParameters) {
        const { renderApp } = await import('./application');
        const [coreStart, depsStart] = await core.getStartServices();
        return renderApp(coreStart, depsStart, params);
      },
    });

    // Global context: Data Administration
    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.dataAdministration, [
      { id: PLUGIN_ID, category: DEFAULT_APP_CATEGORIES.manageData, order: 500 },
    ]);

    // Workspace context: register in all use case nav groups so it appears in every workspace sidebar
    const workspaceNavLink = { id: PLUGIN_ID, category: DEFAULT_APP_CATEGORIES.manageData, order: 900 };
    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.all, [workspaceNavLink]);
    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.observability, [workspaceNavLink]);
    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS['security-analytics'], [workspaceNavLink]);
    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.essentials, [workspaceNavLink]);
    core.chrome.navGroup.addNavLinksToGroup(DEFAULT_NAV_GROUPS.search, [workspaceNavLink]);

    return {};
  }

  public start(_core: CoreStart): SavedObjectMigrationPluginStart {
    return {};
  }

  public stop() {}
}
