import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { buildExperimentService } from './services/container';

const { experimentService } = buildExperimentService();
const app = createApp(experimentService);

const server = app.listen(env.port, () => {
  logger.info({ msg: `experiment-service listening on port ${env.port}`, nodeEnv: env.nodeEnv });
});

function shutdown(signal: string) {
  logger.info({ msg: `Received ${signal}, shutting down` });
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
