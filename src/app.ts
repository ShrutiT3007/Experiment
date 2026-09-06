import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { AppError } from './utils/errors';
import { experimentRoutes } from './routes/experiment.routes';
import { healthRoutes } from './routes/health.routes';
import { ExperimentService } from './services/experiment.service';

export function createApp(experimentService: ExperimentService): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      autoLogging: {
        ignore: (req) => req.url === '/health'
      }
    })
  );

  app.use('/api/v1', experimentRoutes(experimentService));
  app.use('/', healthRoutes());

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
  });

  // Centralized error handler -- every AppError maps to its intended HTTP
  // status (section 38); unexpected errors are logged in full but never
  // leak internals (stack traces, secrets) to the caller.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      logger.error({ msg: 'request failed', code: err.code, status: err.httpStatus, error: err.message });
      return res.status(err.httpStatus).json(err.toJSON());
    }

    logger.error({ msg: 'unhandled error', error: err instanceof Error ? err.message : String(err) });
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal experiment-service failure' });
  });

  return app;
}
