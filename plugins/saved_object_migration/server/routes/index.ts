import { IRouter, Logger } from '../../../../src/core/server';
import { registerDashboardsRoute } from './dashboards';
import { registerExportRoute } from './export';
import { registerInspectRoute } from './inspect';
import { registerRepairRoute } from './repair';
import { registerImportRoute } from './import';

export function registerRoutes(router: IRouter, logger: Logger) {
  registerDashboardsRoute(router, logger);
  registerExportRoute(router, logger);
  registerInspectRoute(router, logger);
  registerRepairRoute(router, logger);
  registerImportRoute(router, logger);
  logger.debug('savedObjectMigration: Routes registered');
}
