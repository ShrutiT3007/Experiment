import { Router } from 'express';
import { env } from '../config/env';
import { pingDatabase } from '../db/pool';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'experiment-service' });
  });

  router.get('/health/dependencies', async (_req, res) => {
    const dbOk = env.databaseUrl ? await pingDatabase() : null;

    res.status(200).json({
      status: 'ok',
      dependencies: {
        qaServer: { configured: Boolean(env.qaServer), url: env.qaServer },
        mockServer: { configured: Boolean(env.mockServer), url: env.mockServer },
        litellm: {
          configured: Boolean(env.litellmBaseUrl && env.litellmApiKey),
          model: env.llmModel
        },
        database: { configured: Boolean(env.databaseUrl), reachable: dbOk }
      }
    });
  });

  return router;
}
