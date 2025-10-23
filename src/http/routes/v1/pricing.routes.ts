import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { pricingService } from '../../../services/pricing.service.js';

const termSchema = z.union([z.literal(10), z.literal(20), z.literal(30)]);

const depegLpQuoteSchema = z.object({
  product: z.literal('DEPEG_LP'),
  poolId: z.string().min(1),
  insuredLP: z.coerce.number().positive(),
  termDays: termSchema
});

const aaveDlpQuoteSchema = z.object({
  product: z.literal('AAVE_DLP'),
  params: z.object({
    chainId: z.coerce.number().int().positive(),
    lendingPool: z.string().min(1),
    collateralAsset: z.string().min(1),
    insuredAmountUSD: z.coerce.number().positive(),
    ltv: z.coerce.number().positive().optional(),
    healthFactor: z.coerce.number().positive().optional()
  }),
  termDays: termSchema
});

const quoteBodySchema = z.discriminatedUnion('product', [
  depegLpQuoteSchema,
  aaveDlpQuoteSchema
]);

export async function pricingRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/quote',
    {
      schema: {
        tags: ['pools', 'policies'],
        summary: 'Quote a premium for a policy',
        body: {
          oneOf: [
            {
              type: 'object',
              required: ['product', 'poolId', 'insuredLP', 'termDays'],
              properties: {
                product: { type: 'string', enum: ['DEPEG_LP'] },
                poolId: { type: 'string' },
                insuredLP: { type: 'number' },
                termDays: { type: 'integer', enum: [10, 20, 30] }
              }
            },
            {
              type: 'object',
              required: ['product', 'params', 'termDays'],
              properties: {
                product: { type: 'string', enum: ['AAVE_DLP'] },
                params: {
                  type: 'object',
                  required: [
                    'chainId',
                    'lendingPool',
                    'collateralAsset',
                    'insuredAmountUSD'
                  ],
                  properties: {
                    chainId: { type: 'integer' },
                    lendingPool: { type: 'string' },
                    collateralAsset: { type: 'string' },
                    insuredAmountUSD: { type: 'number' },
                    ltv: { type: 'number' },
                    healthFactor: { type: 'number' }
                  }
                },
                termDays: { type: 'integer', enum: [10, 20, 30] }
              }
            }
          ]
        }
      }
    },
    async (request) => {
      const body = quoteBodySchema.parse(request.body);
      return pricingService.getQuote(body);
    }
  );
}
