import type { FastifyInstance } from 'fastify';

import { claimsRoutes } from './claims.routes.js';
import { policiesRoutes } from './policies.routes.js';
import { poolsRoutes } from './pools.routes.js';
import { pricingRoutes } from './pricing.routes.js';
import { reserveRoutes } from './reserve.routes.js';
import { adminRoutes } from './admin.routes.js';

export async function apiV1Routes(app: FastifyInstance): Promise<void> {
  await app.register(poolsRoutes);
  await app.register(pricingRoutes);
  await app.register(policiesRoutes);
  await app.register(claimsRoutes);
  await app.register(reserveRoutes);
  await app.register(adminRoutes);
}
