import { v4 as uuid } from 'uuid';
import { QaAdapter } from '../adapters/qa.adapter';
import { ExperimentPlan } from '../schemas/experiment-plan.schema';
import { BuiltFlow } from './flow-builder.service';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';
import { createHttpClient } from '../utils/http';
import { env } from '../config/env';
import axios from 'axios';
import {
  normalizeQaExecutionResult,
  NormalizedQaExecutionResult
} from './experiment/normalizers/qa-result.normalizer';

export interface NormalizedTestcaseResult {
  testcaseId: number;
  status: 'PASSED' | 'FAILED' | 'UNKNOWN';
  apiResponse?: unknown;
  expectedOutput?: unknown;
  durationMs?: number;
}

export type QaExecutionStatus = 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';

export interface NormalizedExecutionResult {
  qaExecution: {
    id: string;
    status: QaExecutionStatus;
  };
  testcases: NormalizedTestcaseResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** Only populated for CONCURRENCY experiments. */
  concurrencySummary?: { requests: number; successful: number; failed: number };
}

/**
 * Layer 3: QA testcase(s) -> QA flow -> QA execution -> result
 * compilation. This service NEVER re-implements the QA framework's
 * execution/flow engine -- it calls it via QaAdapter and then converts
 * whatever shape comes back into the stable NormalizedExecutionResult
 * contract described in section 16, isolating the rest of the codebase
 * from QA implementation changes.
 */
export class ExperimentRunnerService {
  constructor(private readonly qa: QaAdapter) {}

  async runFlow(
    plan: ExperimentPlan,
    built: BuiltFlow,
    servicesUrls: Record<string, string>
  ): Promise<NormalizedExecutionResult> {
    const startedAt = new Date();

    try {
      const result = await this.qa.executeTestSync({
        testcases: built.orderedTestcaseIds,
        flowId: built.qaFlowId,
        servicesUrls
      });

      const completedAt = new Date();
      const normalizedExecution = normalizeQaExecutionResult(result.raw);

      logger.info(
        {
          operation: 'qa.normalizeResult',
          testcaseResults: normalizedExecution.testcases.map((tc) => ({
            testcaseId: tc.testcaseId,
            status: tc.status,
            statusText: tc.statusText
          }))
        },
        'QA execution result normalized'
      );

      const normalized = this.toNormalizedExecutionResult(normalizedExecution, built.orderedTestcaseIds);

      return {
        qaExecution: normalized.qaExecution,
        testcases: normalized.testcases,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime()
      };
    } catch (err) {
      logger.error({ operation: 'qa.executeTestSync', status: 'error', error: (err as Error).message });
      const completedAt = new Date();
      return {
        qaExecution: { id: uuid(), status: 'FAILED' },
        testcases: built.orderedTestcaseIds.map((id) => ({ testcaseId: id, status: 'UNKNOWN' })),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime()
      };
    }
  }

  /**
   * Concurrency execution strategy (section 33). This does NOT create N
   * QA flow records and does NOT call /qa-testing/test N times -- it fires
   * controlled concurrent HTTP requests directly at the target API, then
   * relies on QA's DB/query infrastructure (via AssertionService) for
   * verification, exactly as instructed.
   */
  async runConcurrency(
    plan: ExperimentPlan,
    targetTestcaseIndex: number
  ): Promise<NormalizedExecutionResult> {
    const target = plan.testcases[targetTestcaseIndex];
    if (!target) {
      throw AppError.badRequest('INVALID_EXPERIMENT_PLAN', 'Concurrency target testcase not found in plan');
    }

    const concurrency = Math.min(plan.execution.concurrency, env.maxConcurrency);
    const startedAt = new Date();

    const baseUrl = target.url.startsWith('http') ? undefined : env.qaServer;
    const client = createHttpClient(baseUrl ?? env.qaServer, env.qaRequestTimeoutMs, 'concurrency-runner');

    const requests = Array.from({ length: concurrency }, () =>
      client
        .request({
          method: target.method,
          url: target.url,
          headers: target.headers,
          data: target.body
        })
        .then((res) => ({ ok: true as const, status: res.status, data: res.data }))
        .catch((err) => ({
          ok: false as const,
          status: axios.isAxiosError(err) ? err.response?.status : undefined,
          data: axios.isAxiosError(err) ? err.response?.data : undefined
        }))
    );

    const settled = await Promise.all(requests);
    const successful = settled.filter((r) => r.ok).length;
    const failed = settled.length - successful;
    const completedAt = new Date();

    return {
      qaExecution: { id: uuid(), status: 'COMPLETED' },
      testcases: settled.map((r, i) => ({
        testcaseId: -1 * (i + 1), // synthetic id: concurrency mode targets an API, not a stored testcase
        status: r.ok ? 'PASSED' : 'FAILED',
        apiResponse: { statusCode: r.status, body: r.data }
      })),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      concurrencySummary: { requests: settled.length, successful, failed }
    };
  }

  /**
   * Converts the QA-owned NormalizedQaExecutionResult into the stable
   * Experiment-owned NormalizedExecutionResult contract the rest of the
   * service depends on. `apiResponse` here carries the real HTTP status,
   * statusText, headers and body -- never QA's raw `apiResponse` string.
   *
   * `status` on each testcase reflects only whether QA could execute and
   * assert it (`passedByQa`) -- it is NOT the Experiment hypothesis
   * verdict, which is derived later purely from assertion outcomes.
   */
  private toNormalizedExecutionResult(
    normalizedExecution: NormalizedQaExecutionResult,
    orderedTestcaseIds: number[]
  ): { qaExecution: { id: string; status: QaExecutionStatus }; testcases: NormalizedTestcaseResult[] } {
    if (normalizedExecution.testcases.length === 0) {
      // The QA implementation may only return download/S3 metadata for
      // this run. We cannot fabricate per-testcase pass/fail in that case.
      return {
        qaExecution: { id: uuid(), status: 'COMPLETED' },
        testcases: orderedTestcaseIds.map((id) => ({ testcaseId: id, status: 'UNKNOWN' }))
      };
    }

    const testcases: NormalizedTestcaseResult[] = normalizedExecution.testcases.map((tc, i) => ({
      testcaseId: tc.testcaseId ?? orderedTestcaseIds[i],
      status: tc.status === null ? 'UNKNOWN' : tc.passedByQa ? 'PASSED' : 'FAILED',
      apiResponse: { statusCode: tc.status, statusText: tc.statusText, headers: tc.headers, body: tc.body }
    }));

    return { qaExecution: { id: uuid(), status: 'COMPLETED' }, testcases };
  }
}
