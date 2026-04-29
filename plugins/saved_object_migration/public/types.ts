import { NavigationPublicPluginStart } from '../../../../src/plugins/navigation/public';

export interface SavedObjectMigrationPluginSetup {}

export interface SavedObjectMigrationPluginStart {}

export interface AppPluginSetupDependencies {
  navigation: {};
}

export interface AppPluginStartDependencies {
  navigation: NavigationPublicPluginStart;
}
