import { SavedObjectMigrationPlugin } from './plugin';

export function plugin() {
  return new SavedObjectMigrationPlugin();
}

export { SavedObjectMigrationPluginSetup, SavedObjectMigrationPluginStart } from './types';
