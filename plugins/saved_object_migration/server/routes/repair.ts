import { schema } from '@osd/config-schema';
import { IRouter, Logger } from '../../../../src/core/server';
import { API_BASE, applyRepairPipeline } from '../../common';

export function registerRepairRoute(router: IRouter, logger: Logger) {
  router.post(
    {
      path: `${API_BASE}/repair`,
      options: {
        body: {
          maxBytes: 100 * 1024 * 1024, // 100MB
        },
      },
      validate: {
        body: schema.object({
          ndjson: schema.string(),
          config: schema.object({
            stripDataSourcePrefixes: schema.boolean(),
            remapDataSources: schema.object({
              enabled: schema.boolean(),
              targetId: schema.maybe(schema.string()),
              targetTitle: schema.maybe(schema.string()),
            }),
            stripDashboardDatasets: schema.boolean(),
            remapIndexPatterns: schema.object({
              enabled: schema.boolean(),
              mappings: schema.maybe(schema.recordOf(schema.string(), schema.string())),
            }),
            disableMissingFieldFilters: schema.boolean(),
          }),
        }),
      },
    },
    async (_context, req, res) => {
      const { ndjson, config } = req.body;

      // Handle empty NDJSON — return no-op result
      if (!ndjson.trim()) {
        return res.ok({ body: { ndjson: '', changes: [] } });
      }

      // Validate NDJSON is parseable before running pipeline
      try {
        ndjson
          .trim()
          .split('\n')
          .filter(Boolean)
          .forEach((line) => JSON.parse(line));
      } catch (e) {
        return res.badRequest({ body: { message: `Malformed NDJSON: ${e.message}` } });
      }

      try {
        const result = applyRepairPipeline(ndjson, config);
        return res.ok({ body: result });
      } catch (e) {
        logger.error(`Failed to repair: ${e.message}`);
        return res.customError({ statusCode: 500, body: { message: e.message } });
      }
    }
  );
}
