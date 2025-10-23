import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { adminService } from '../../../services/admin.service.js';
import type { AnchorPayload, WhitelistRequest } from '../../../domain/types.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';

const anchorSchema = z.object({
  type: z.enum(['DEPEG_START', 'DEPEG_END', 'DEPEG_LIQ', 'LIQUIDATION']),
  payload: z.record(z.string(), z.any()),
  ipfsCID: z.string().min(1),
  validatorSig: z.string().min(1)
});

const whitelistSchema = z.object({
  action: z.enum(['ADD', 'REMOVE', 'UPDATE']),
  poolId: z.string().min(1),
  payload: z.record(z.string(), z.any()).optional()
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/admin/anchors',
    {
      preHandler: adminAuthMiddleware,
      schema: {
        tags: ['admin'],
        summary: 'Publish anchored depeg or liquidation event',
        body: {
          type: 'object',
          required: ['type', 'payload', 'ipfsCID', 'validatorSig'],
          properties: {
            type: {
              type: 'string',
              enum: ['DEPEG_START', 'DEPEG_END', 'DEPEG_LIQ', 'LIQUIDATION']
            },
            payload: { type: 'object', additionalProperties: true },
            ipfsCID: { type: 'string' },
            validatorSig: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const body = anchorSchema.parse(request.body as AnchorPayload);
      return adminService.publishAnchor(body);
    }
  );

  app.post(
    '/admin/whitelist',
    {
      preHandler: adminAuthMiddleware,
      schema: {
        tags: ['admin'],
        summary: 'Manage whitelist entries',
        body: {
          type: 'object',
          required: ['action', 'poolId'],
          properties: {
            action: { type: 'string', enum: ['ADD', 'REMOVE', 'UPDATE'] },
            poolId: { type: 'string' },
            payload: { type: 'object', additionalProperties: true }
          }
        }
      }
    },
    async (request) => {
      const body = whitelistSchema.parse(request.body as WhitelistRequest);
      return adminService.updateWhitelist(body);
    }
  );
}
