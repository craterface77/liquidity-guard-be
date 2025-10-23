import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';

import { appConfig } from './core/env.js';
import { ServiceError } from './core/errors.js';
import { getPool, closePool } from './core/database.js';
import { runMigrations } from './core/migrations.js';
import { registerRoutes } from './http/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: appConfig.LOG_LEVEL,
      transport:
        appConfig.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
              }
            }
          : undefined
    }
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: appConfig.corsOrigins
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'LiquidityGuard API',
        description:
          'Backend API for LiquidityGuard indemnity and liquidation protection policies.',
        version: '0.1.0'
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local development'
        }
      ],
      tags: [
        { name: 'system', description: 'Infrastructure and status endpoints' },
        { name: 'pools', description: 'Pool catalogue and analytics' },
        { name: 'policies', description: 'Policy lifecycle management' },
        { name: 'claims', description: 'Claim previews and signatures' },
        { name: 'reserve', description: 'Reserve pool insights' },
        { name: 'admin', description: 'Administrative operations' }
      ]
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true
  });

  const hasDatabaseConfig =
    Boolean(appConfig.DATABASE_URL) ||
    Boolean(appConfig.DB_HOST && appConfig.DB_NAME && appConfig.DB_USER);

  if (hasDatabaseConfig) {
    try {
      const pool = getPool();
      await runMigrations(pool);
      app.log.info('Database migrations completed');
      app.addHook('onClose', async () => {
        await closePool();
      });
    } catch (error) {
      app.log.error({ err: error }, 'Database initialization failed');
      throw error;
    }
  } else {
    app.log.warn('Database configuration not provided. Running in in-memory mode.');
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ServiceError) {
      reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: error.issues
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: error.message,
        details: error.validation
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');
    reply.status(error.statusCode ?? 500).send({
      statusCode: error.statusCode ?? 500,
      error: error.code ?? 'Internal Server Error',
      message:
        appConfig.NODE_ENV === 'production'
          ? 'Internal Server Error'
          : error.message
    });
  });

  await registerRoutes(app);

  return app;
}
