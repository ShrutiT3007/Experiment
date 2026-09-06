import { Router } from 'express';
import { ExperimentService } from '../services/experiment.service';
import { createExperimentController } from '../controllers/experiment.controller';

/**
 * Exposes exactly ONE business API to Person 1:
 *   POST /api/v1/experiment
 * No QA framework CRUD endpoints are ever proxied through here.
 */
export function experimentRoutes(experimentService: ExperimentService): Router {
  const router = Router();
  router.post('/experiment', createExperimentController(experimentService));
  return router;
}
