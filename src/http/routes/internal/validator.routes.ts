import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { appConfig } from '../../../core/env.js';
import { adminService } from '../../../services/admin.service.js';

const anchorWebhookSchema = z.object({
  kind: z.enum(['DEPEG_START', 'DEPEG_END', 'DEPEG_LIQ', 'LIQUIDATION']),
  riskId: z.string(),
  poolId: z.string(),
  chainId: z.number(),
  timestamp: z.number(),
  windowStart: z.number().optional(),
  windowEnd: z.number().optional(),
  severityBps: z.number().optional(),
  twapBps: z.number().optional(),
  metadata: z.record(z.unknown()).optional()
});

const poolStateWebhookSchema = z.object({
  poolId: z.string(),
  state: z.enum(['GREEN', 'YELLOW', 'RED']),
  metrics: z.object({
    twap1h: z.string().optional(),
    twap4h: z.string().optional(),
    liquidityUSD: z.string().optional()
  }).optional(),
  timestamp: z.number()
});

function verifyWebhookSignature(request: FastifyRequest): boolean {
  const secret = appConfig.VALIDATOR_API_SECRET;
  if (!secret) {
    // If no secret configured, allow webhook (dev mode)
    return true;
  }

  const signature = request.headers['x-lg-signature'];
  if (!signature || typeof signature !== 'string') {
    return false;
  }

  const body = JSON.stringify(request.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function validatorWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Webhook for anchor events (depeg start/end, liquidations)
  app.post(
    '/internal/validator/anchors',
    {
      schema: {
        tags: ['internal', 'webhooks'],
        summary: 'Receive anchor events from validator',
        description: 'Internal endpoint for validator to push depeg and liquidation events',
        body: {
          type: 'object',
          required: ['kind', 'riskId', 'poolId', 'chainId', 'timestamp'],
          properties: {
            kind: {
              type: 'string',
              enum: ['DEPEG_START', 'DEPEG_END', 'DEPEG_LIQ', 'LIQUIDATION']
            },
            riskId: { type: 'string' },
            poolId: { type: 'string' },
            chainId: { type: 'number' },
            timestamp: { type: 'number' },
            windowStart: { type: 'number' },
            windowEnd: { type: 'number' },
            severityBps: { type: 'number' },
            twapBps: { type: 'number' },
            metadata: { type: 'object', additionalProperties: true }
          }
        }
      }
    },
    async (request, reply) => {
      // Verify HMAC signature
      if (!verifyWebhookSignature(request)) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid webhook signature'
        });
      }

      const payload = anchorWebhookSchema.parse(request.body);

      // Transform to admin service format
      const anchorPayload = {
        type: payload.kind,
        payload: {
          riskId: payload.riskId,
          poolId: payload.poolId,
          chainId: payload.chainId,
          timestamp: payload.timestamp,
          windowStart: payload.windowStart,
          windowEnd: payload.windowEnd,
          severityBps: payload.severityBps,
          twapBps: payload.twapBps,
          ...payload.metadata
        },
        ipfsCID: (payload.metadata?.ipfsCID as string | undefined) ?? `webhook-${Date.now()}`,
        validatorSig: 'webhook-verified'
      };

      const result = await adminService.publishAnchor(anchorPayload);

      return reply.code(200).send({
        success: true,
        status: result.status
      });
    }
  );

  // Webhook for pool state updates
  app.post(
    '/internal/validator/pool-state',
    {
      schema: {
        tags: ['internal', 'webhooks'],
        summary: 'Receive pool state updates from validator',
        description: 'Internal endpoint for validator to push pool state changes',
        body: {
          type: 'object',
          required: ['poolId', 'state', 'timestamp'],
          properties: {
            poolId: { type: 'string' },
            state: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
            metrics: {
              type: 'object',
              properties: {
                twap1h: { type: 'string' },
                twap4h: { type: 'string' },
                liquidityUSD: { type: 'string' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    },
    async (request, reply) => {
      // Verify HMAC signature
      if (!verifyWebhookSignature(request)) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid webhook signature'
        });
      }

      const payload = poolStateWebhookSchema.parse(request.body);

      // Store pool state update in database (implementation pending)
      app.log.info({ payload }, 'Received pool state update from validator');

      return reply.code(200).send({
        success: true,
        poolId: payload.poolId,
        state: payload.state
      });
    }
  );
}
