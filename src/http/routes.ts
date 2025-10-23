import type { FastifyInstance } from 'fastify';

import { healthRoutes } from './routes/health.routes.js';
import { apiV1Routes } from './routes/v1/index.js';
import { validatorWebhookRoutes } from './routes/internal/validator.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(apiV1Routes, { prefix: '/v1' });
  await app.register(validatorWebhookRoutes);
}
