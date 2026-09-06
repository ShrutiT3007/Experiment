import { Request, Response, NextFunction } from 'express';
import { experimentRequestSchema } from '../schemas/experiment.schema';
import { ExperimentService } from '../services/experiment.service';
import { AppError } from '../utils/errors';

export function createExperimentController(experimentService: ExperimentService) {
  return async function handleCreateExperiment(req: Request, res: Response, next: NextFunction) {
    const parsed = experimentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = AppError.badRequest('INVALID_HYPOTHESIS', 'Invalid experiment request', {
        issues: parsed.error.issues
      });
      return next(error);
    }

    try {
      const result = await experimentService.run(parsed.data);
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  };
}
