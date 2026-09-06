import { v4 as uuid } from 'uuid';
import { ExperimentRequest } from '../schemas/experiment.schema';
import { ExperimentPlanner } from './experiment-planner.service';
import { TestcaseGeneratorService } from './testcase-generator.service';
import { FlowBuilderService } from './flow-builder.service';
import { ExperimentRunnerService, NormalizedExecutionResult } from './experiment-runner.service';
import { AssertionService } from './assertion.service';
import { EvidenceService } from './evidence.service';
import { CleanupService, createExperimentContext } from './cleanup.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';
import {
  createExperiment,
  updateExperimentStatus,
  saveDefinitionJson
} from '../models/experiment.model';
import { createExecution, completeExecution } from '../models/execution.model';
import { recordAssertion } from '../models/assertion.model';
import { recordEvidence } from '../models/evidence.model';
import { evaluateHypothesis, HypothesisEvaluation } from './assertion/hypothesis-evaluator';

export type ExperimentLifecycleStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'PLANNING'
  | 'BUILDING_TESTCASES'
  | 'BUILDING_FLOW'
  | 'RUNNING'
  | 'VERIFYING'
  | 'COMPILING_RESULT'
  | 'CLEANUP'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

export interface ExperimentServiceDeps {
  planner: ExperimentPlanner;
  testcaseGenerator: TestcaseGeneratorService;
  flowBuilder: FlowBuilderService;
  runner: ExperimentRunnerService;
  assertionService: AssertionService;
  evidenceService: EvidenceService;
  cleanupService: CleanupService;
}

/**
 * The single orchestration point behind POST /api/v1/experiment. Walks
 * the full lifecycle in section 22 and guarantees Person 1 gets one
 * complete, normalized ExperimentResult -- never a partial view they have
 * to reassemble from several calls.
 */
export class ExperimentService {
  constructor(private readonly deps: ExperimentServiceDeps) {}

  async run(request: ExperimentRequest) {
    const experimentId = `EXP-${uuid()}`;
    const ctx = createExperimentContext(experimentId);
    let status: ExperimentLifecycleStatus = 'CREATED';
    const log = logger.child({ experimentId });

    const dbExperimentId = await createExperiment({
      uuid: experimentId,
      hypothesis: request.hypothesis,
      status
    });
    let dbExecutionId: number | null = null;

    const startedAt = Date.now();

    const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(AppError.internal('Experiment exceeded EXPERIMENT_TIMEOUT_MS')),
            env.experimentTimeoutMs
          )
        )
      ]);

    try {
      status = 'VALIDATING';
      log.info({ operation: 'lifecycle', status });
      // Structural validation already happened at the HTTP boundary
      // (experimentRequestSchema). Nothing further to do here beyond
      // logging the transition for observability (section 43).

      status = 'PLANNING';
      log.info({ operation: 'lifecycle', status });
      const plan = await withTimeout(
        this.deps.planner.plan({ hypothesis: request.hypothesis, context: request.context })
      );
      await saveDefinitionJson(dbExperimentId, plan);

      await updateExperimentStatus(dbExperimentId, status);

      dbExecutionId = await createExecution({ uuid: uuid(), experimentId: dbExperimentId, status: 'RUNNING' });
      ctx.executionId = String(dbExecutionId ?? uuid());

      status = 'BUILDING_TESTCASES';
      log.info({ operation: 'lifecycle', status });
      await updateExperimentStatus(dbExperimentId, status);
      const createdTestcases = await withTimeout(
        this.deps.testcaseGenerator.createTestcases(plan.testcases, dbExperimentId)
      );
      ctx.createdTestcases = createdTestcases.filter((t) => !t.reused).map((t) => t.qaTestcaseId);

      let execution: NormalizedExecutionResult;
      let qaFlowId: number | null = null;

      if (plan.experimentType === 'CONCURRENCY') {
        status = 'RUNNING';
        log.info({ operation: 'lifecycle', status });
        await updateExperimentStatus(dbExperimentId, status);
        execution = await withTimeout(this.deps.runner.runConcurrency(plan, plan.flow.testcaseOrder[0] ?? 0));
      } else {
        status = 'BUILDING_FLOW';
        log.info({ operation: 'lifecycle', status });
        await updateExperimentStatus(dbExperimentId, status);
        const builtFlow = await withTimeout(
          this.deps.flowBuilder.buildFlow(plan, createdTestcases, dbExperimentId)
        );
        ctx.createdFlows.push(builtFlow.qaFlowId);
        qaFlowId = builtFlow.qaFlowId;

        status = 'RUNNING';
        log.info({ operation: 'lifecycle', status });
        await updateExperimentStatus(dbExperimentId, status);
        execution = await withTimeout(this.deps.runner.runFlow(plan, builtFlow, env.servicesUrls));
      }

      status = 'VERIFYING';
      log.info({ operation: 'lifecycle', status });
      const assertions = await withTimeout(
        this.deps.assertionService.evaluate(plan.assertions, execution.testcases)
      );
      for (const assertion of assertions) {
        await recordAssertion({ experimentId: dbExperimentId, executionId: dbExecutionId, assertion });
      }

      status = 'COMPILING_RESULT';
      log.info({ operation: 'lifecycle', status });
      const evidence = this.deps.evidenceService.compile(execution, assertions);
      for (const summary of evidence) {
        await recordEvidence({
          experimentId: dbExperimentId,
          executionId: dbExecutionId,
          source: 'experiment-service',
          type: 'SUMMARY',
          summary
        });
      }

      // QA execution success and hypothesis support are independent
      // layers (section 21/23): a run that never completed leaves no
      // reliable evidence, regardless of what assertions were queued.
      const hypothesisEvaluation: HypothesisEvaluation =
        execution.qaExecution.status === 'COMPLETED'
          ? evaluateHypothesis(assertions)
          : {
              result: 'INCONCLUSIVE',
              supportingTestcases: [],
              contradictingTestcases: [],
              inconclusiveTestcases: [],
              supportCount: 0,
              contradictionCount: 0,
              inconclusiveCount: 0,
              reason: `Experiment execution did not complete successfully (status: ${execution.qaExecution.status}).`,
              assertionResults: assertions
            };
      const hypothesisResult = hypothesisEvaluation.result;

      await completeExecution(dbExecutionId, {
        status: execution.qaExecution.status,
        qaExecutionId: execution.qaExecution.id,
        durationMs: execution.durationMs
      });

      status = execution.qaExecution.status === 'COMPLETED' ? 'COMPLETED' : (execution.qaExecution.status as ExperimentLifecycleStatus);

      await updateExperimentStatus(dbExperimentId, status, {
        hypothesisResult,
        completed: true
      });

      return {
        experimentId,
        hypothesis: request.hypothesis,
        status: execution.qaExecution.status,
        hypothesisResult,
        experiment: {
          type: plan.experimentType,
          testcaseIds: createdTestcases.map((t) => t.qaTestcaseId),
          flowId: qaFlowId,
          generatedTestcases: createdTestcases.map((t) => ({ qaTestcaseId: t.qaTestcaseId, url: t.url }))
        },
        execution: {
          qaExecutionId: execution.qaExecution.id,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          durationMs: execution.durationMs,
          ...(execution.concurrencySummary
            ? {
                requests: execution.concurrencySummary.requests,
                successful: execution.concurrencySummary.successful,
                failed: execution.concurrencySummary.failed
              }
            : {})
        },
        testcases: execution.testcases.map((t) => ({
          testcaseId: t.testcaseId,
          status: t.status,
          actualStatus: (t.apiResponse as { statusCode?: number | null } | undefined)?.statusCode ?? null,
          apiResponse: t.apiResponse,
          expectedOutput: t.expectedOutput,
          durationMs: t.durationMs
        })),
        assertions,
        hypothesisEvaluation,
        evidence,
        generatedPlan: plan
      };
    } catch (err) {
      const appError = err instanceof AppError ? err : AppError.internal((err as Error).message);
      log.error({ operation: 'lifecycle', status: 'FAILED', error: appError.message, code: appError.code });

      await updateExperimentStatus(dbExperimentId, 'FAILED', {
        hypothesisResult: 'INCONCLUSIVE',
        error: appError.message,
        completed: true
      });
      if (dbExecutionId) {
        await completeExecution(dbExecutionId, {
          status: 'FAILED',
          durationMs: Date.now() - startedAt
        });
      }

      // Re-throw so the controller can map AppError -> correct HTTP status.
      // Do NOT fabricate a DISPROVED/SUPPORTED result on failure
      // (section 38): the caller must see this was inconclusive/failed.
      throw appError;
    } finally {
      status = 'CLEANUP';
      log.info({ operation: 'lifecycle', status });
      try {
        await this.deps.cleanupService.cleanup(ctx);
      } catch (cleanupErr) {
        log.error({ operation: 'cleanup', error: (cleanupErr as Error).message });
      }
    }
  }
}
