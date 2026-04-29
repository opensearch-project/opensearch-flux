import { PluginInitializerContext } from '../../../src/core/server';
import { SavedObjectMigrationPlugin } from './plugin';

export function plugin(initializerContext: PluginInitializerContext) {
  return new SavedObjectMigrationPlugin(initializerContext);
}

export { SavedObjectMigrationPluginSetup, SavedObjectMigrationPluginStart } from './types';
