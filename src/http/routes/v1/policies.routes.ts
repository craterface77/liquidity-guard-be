import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { policyService } from '../../../services/policy.service.js';

const createPolicySchema = z.object({
  product: z.enum(['DEPEG_LP', 'AAVE_DLP']),
  wallet: z.string().min(1),
  params: z.record(z.string(), z.any()),
  termDays: z.union([z.literal(10), z.literal(20), z.literal(30)]),
  insuredAmount: z.coerce.number().positive(),
  idempotencyKey: z.string().optional()
});

const finalizeSchema = z.object({
  draftId: z.string().min(1),
  txHashMint: z.string().min(1),
  premiumTxHash: z.string().optional()
});

const listPoliciesQuerySchema = z.object({
  wallet: z.string().optional()
});

export async function policiesRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/policies',
    {
      schema: {
        tags: ['policies'],
        summary: 'Create a policy draft',
        body: {
          type: 'object',
          required: [
            'product',
            'wallet',
            'params',
            'termDays',
            'insuredAmount'
          ],
          properties: {
            product: { type: 'string', enum: ['DEPEG_LP', 'AAVE_DLP'] },
            wallet: { type: 'string' },
            params: { type: 'object', additionalProperties: true },
            termDays: { type: 'integer', enum: [10, 20, 30] },
            insuredAmount: { type: 'number' },
            idempotencyKey: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const body = createPolicySchema.parse(request.body);
      return policyService.createDraft(body);
    }
  );

  app.post(
    '/policies/:draftId/finalize',
    {
      schema: {
        tags: ['policies'],
        summary: 'Finalize policy after on-chain mint',
        params: {
          type: 'object',
          required: ['draftId'],
          properties: {
            draftId: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['txHashMint'],
          properties: {
            txHashMint: { type: 'string' },
            premiumTxHash: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const params = z.object({ draftId: z.string().min(1) }).parse(
        request.params
      );
      const rawBody = request.body as Record<string, unknown>;
      const body = finalizeSchema
        .extend({
          draftId: z.literal(params.draftId)
        })
        .parse({
          ...rawBody,
          draftId: params.draftId
        });
      return policyService.finalizeDraft(body);
    }
  );

  app.get(
    '/policies',
    {
      schema: {
        tags: ['policies'],
        summary: 'List policies by wallet',
        querystring: {
          type: 'object',
          properties: {
            wallet: { type: 'string' }
          }
        }
      }
    },
    async (request) => {
      const query = listPoliciesQuerySchema.parse(request.query);
      return policyService.listPolicies(query.wallet);
    }
  );
}
