import type { FastifyInstance } from 'fastify';

import { reserveService } from '../../../services/reserve.service.js';

export async function reserveRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/reserve/overview',
    {
      schema: {
        tags: ['reserve'],
        summary: 'Reserve pool KPIs'
      }
    },
    async () => reserveService.getOverview()
  );
}
