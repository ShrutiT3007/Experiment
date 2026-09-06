import { QaAdapter } from '../adapters/qa.adapter';
import { MockAdapter, MockScenario } from '../adapters/mock.adapter';
import { logger } from '../utils/logger';

export interface ExperimentContext {
  experimentId: string;
  variables: Record<string, unknown>;
  createdTestcases: number[];
  createdFlows: number[];
  createdQueries: number[];
  mockScenarios: MockScenario[];
  executionId: string | null;
}

export function createExperimentContext(experimentId: string): ExperimentContext {
  return {
    experimentId,
    variables: {},
    createdTestcases: [],
    createdFlows: [],
    createdQueries: [],
    mockScenarios: [],
    executionId: null
  };
}

/**
 * Cleanup runs in a `finally` block regardless of success/failure
 * (section 22/23). It only ever acts on resources this experiment itself
 * created (tracked in ExperimentContext) -- it never touches shared or
 * pre-existing QA testcases/flows, and it never invents a deletion
 * endpoint that the current QA/Mock implementations don't document.
 */
export class CleanupService {
  constructor(private readonly qa: QaAdapter, private readonly mock: MockAdapter) {}

  async cleanup(ctx: ExperimentContext): Promise<{ cleaned: string[]; skipped: string[] }> {
    const cleaned: string[] = [];
    const skipped: string[] = [];

    for (const scenario of ctx.mockScenarios) {
      const result = await this.mock.cleanupScenario(scenario);
      if (result.cleaned) {
        cleaned.push(`mock-scenario:${scenario.responseId}`);
      } else {
        skipped.push(`mock-scenario:${scenario.responseId} (${result.reason})`);
      }
    }

    // The existing QA Testing Framework does not currently document a
    // verified-safe delete endpoint for testcases/flows/queries (section
    // 23/48). Rather than guessing at one, we record what WOULD need
    // cleanup so operators/observability (Person 6) can see it, and avoid
    // ever mutating shared, reusable QA data.
    if (ctx.createdTestcases.length > 0) {
      skipped.push(
        `qa-testcases:[${ctx.createdTestcases.join(',')}] (no verified-safe delete endpoint; left in place for reuse/audit)`
      );
    }
    if (ctx.createdFlows.length > 0) {
      skipped.push(
        `qa-flows:[${ctx.createdFlows.join(',')}] (no verified-safe delete endpoint; left in place for reuse/audit)`
      );
    }
    if (ctx.createdQueries.length > 0) {
      skipped.push(`qa-queries:[${ctx.createdQueries.join(',')}] (read-only; nothing to clean up)`);
    }

    logger.info({
      operation: 'cleanup',
      experimentId: ctx.experimentId,
      cleaned,
      skipped
    });

    return { cleaned, skipped };
  }
}
