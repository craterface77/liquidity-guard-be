import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { claimService } from '../../../services/claim.service.js';

const previewQuerySchema = z.object({
  policyId: z.string().min(1)
});

const signBodySchema = z.object({
  policyId: z.string().min(1),
  requester: z.string().optional()
});

const listClaimsQuerySchema = z.object({
  wallet: z.string().optional()
});

export async function claimsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/claim/preview',
    {
      schema: {
        tags: ['claims'],
        summary: 'Preview claimable payout for a policy',
        querystring: {
          type: 'object',
          required: ['policyId'],
          properties: {
            policyId: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const query = previewQuerySchema.parse(request.query);
      return claimService.previewClaim(query);
    }
  );

  app.post(
    '/claim/sign',
    {
      schema: {
        tags: ['claims'],
        summary: 'Request validator signature for a claim',
        body: {
          type: 'object',
          required: ['policyId'],
          properties: {
            policyId: { type: 'string' },
            requester: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const body = signBodySchema.parse(request.body);
      return claimService.signClaim(body);
    }
  );

  app.get(
    '/claims',
    {
      schema: {
        tags: ['claims'],
        summary: 'List claims for a wallet',
        querystring: {
          type: 'object',
          properties: {
            wallet: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const query = listClaimsQuerySchema.parse(request.query);
      return claimService.listClaims(query.wallet);
    }
  );

  app.get(
    '/claims/queue',
    {
      schema: {
        tags: ['claims'],
        summary: 'Current payout queue status'
      }
    },
    async () => claimService.getClaimQueue()
  );
}
