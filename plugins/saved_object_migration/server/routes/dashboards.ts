import { schema } from '@osd/config-schema';
import { IRouter, Logger } from '../../../../src/core/server';
import { API_BASE } from '../../common';

export function registerDashboardsRoute(router: IRouter, logger: Logger) {
  router.get(
    {
      path: `${API_BASE}/dashboards`,
      validate: {
        query: schema.object({
          page: schema.number({ min: 1, defaultValue: 1 }),
          perPage: schema.number({ min: 1, max: 1000, defaultValue: 20 }),
          search: schema.maybe(schema.string()),
          workspaceId: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, req, res) => {
      const { page, perPage, search, workspaceId } = req.query;
      const client = context.core.savedObjects.client;

      try {
        const result = await client.find({
          type: ['dashboard'],
          perPage,
          page,
          ...(search ? { search, searchFields: ['title'] } : {}),
          ...(workspaceId ? { workspaces: [workspaceId] } : {}),
          fields: ['title', 'description'],
        });

        return res.ok({
          body: {
            dashboards: result.saved_objects.map((obj) => ({
              id: obj.id,
              title: (obj.attributes as Record<string, unknown>).title,
              description: (obj.attributes as Record<string, unknown>).description,
            })),
            total: result.total,
            page: result.page,
            perPage: result.per_page,
          },
        });
      } catch (e) {
        logger.error(`Failed to list dashboards: ${e.message}`);
        return res.customError({ statusCode: 500, body: { message: e.message } });
      }
    }
  );
}
