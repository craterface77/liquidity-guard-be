import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { poolService } from '../../../services/pool.service.js';
import type { PoolState } from '../../../domain/types.js';

const poolStates = ['Green', 'Yellow', 'Red'] as const satisfies readonly PoolState[];

const listPoolsQuerySchema = z.object({
  state: z.enum([...poolStates]).optional(),
  chainId: z.coerce.number().int().positive().optional()
});

export async function poolsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/pools',
    {
      schema: {
        tags: ['pools'],
        summary: 'List whitelisted pools',
        querystring: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['Green', 'Yellow', 'Red'] },
            chainId: { type: 'integer' }
          }
        }
      }
    },
    async (request) => {
      const query = listPoolsQuerySchema.parse(request.query);
      return poolService.listPools(query);
    }
  );
}
