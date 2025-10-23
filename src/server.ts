import { buildApp } from './app.js';
import { appConfig } from './core/env.js';

const app = await buildApp();

try {
  await app.listen({
    host: appConfig.HOST,
    port: appConfig.PORT
  });

  const addressInfo = app.server.address();
  if (addressInfo && typeof addressInfo === 'object') {
    app.log.info(
      `Server listening on ${addressInfo.address}:${addressInfo.port}`
    );
  } else {
    app.log.info('Server listening');
  }
} catch (error) {
  app.log.error({ err: error }, 'Failed to start server');
  process.exit(1);
}

const gracefulShutdown = async () => {
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
