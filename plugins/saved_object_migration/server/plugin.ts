import { PluginInitializerContext, CoreSetup, CoreStart, Plugin, Logger } from '../../../src/core/server';
import { SavedObjectMigrationPluginSetup, SavedObjectMigrationPluginStart } from './types';
import { registerRoutes } from './routes';

export class SavedObjectMigrationPlugin
  implements Plugin<SavedObjectMigrationPluginSetup, SavedObjectMigrationPluginStart> {
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup) {
    this.logger.debug('savedObjectMigration: Setup');
    const router = core.http.createRouter();
    registerRoutes(router, this.logger);
    return {};
  }

  public start(_core: CoreStart) {
    this.logger.debug('savedObjectMigration: Started');
    return {};
  }

  public stop() {}
}
