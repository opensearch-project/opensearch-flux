import { schema } from '@osd/config-schema';
import { IRouter, Logger } from '../../../../src/core/server';
import { API_BASE, parseNdjsonFile, inspect } from '../../common';
import { PlatformType } from '../../common/types';

const platformTypeSchema = schema.oneOf([
  schema.literal('aos'),
  schema.literal('aoss'),
  schema.literal('opensearch-ui'),
  schema.literal('unknown'),
]);

export function registerInspectRoute(router: IRouter, logger: Logger) {
  router.post(
    {
      path: `${API_BASE}/inspect`,
      options: {
        body: {
          maxBytes: 100 * 1024 * 1024, // 100MB
        },
      },
      validate: {
        body: schema.object({
          ndjson: schema.string(),
          sourcePlatform: schema.maybe(platformTypeSchema),
          targetPlatform: schema.maybe(platformTypeSchema),
        }),
      },
    },
    async (_context, req, res) => {
      const { ndjson, sourcePlatform, targetPlatform } = req.body;

      // Handle empty NDJSON — return empty report
      if (!ndjson.trim()) {
        return res.ok({
          body: {
            summary: { totalObjects: 0, errors: 0, warnings: 0, info: 0 },
            objectsByType: {},
            issues: [],
          },
        });
      }

      let objects;
      try {
        objects = parseNdjsonFile(ndjson);
      } catch (e) {
        return res.badRequest({ body: { message: `Malformed NDJSON: ${e.message}` } });
      }

      try {
        const report = inspect(objects, {
          sourcePlatform: sourcePlatform as PlatformType | undefined,
          targetPlatform: targetPlatform as PlatformType | undefined,
        });
        return res.ok({ body: report });
      } catch (e) {
        logger.error(`Failed to inspect: ${e.message}`);
        return res.customError({ statusCode: 500, body: { message: e.message } });
      }
    }
  );
}
