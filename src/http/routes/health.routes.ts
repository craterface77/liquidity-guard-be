import type { FastifyInstance } from 'fastify';

import { appConfig } from '../../core/env.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              env: { type: 'string' },
              version: { type: 'string' }
            }
          }
        }
      }
    },
    async () => ({
      status: 'ok',
      uptime: process.uptime(),
      env: appConfig.NODE_ENV,
      version: '0.1.0'
    })
  );
}
