import { QaAdapter } from '../adapters/qa.adapter';
import { PlanTestcase } from '../schemas/experiment-plan.schema';
import { QaTestcasePayload, qaTestcasePayloadSchema } from '../schemas/testcase.schema';
import { logger } from '../utils/logger';
import { recordTestcase } from '../models/testcase.model';

export interface CreatedTestcase {
  planIndex: number;
  qaTestcaseId: number;
  name: string;
  url: string;
  payload: QaTestcasePayload;
  reused: boolean;
}

/**
 * Translates a validated plan testcase into the EXACT payload shape the
 * existing QA framework's POST /api/v1/qa-testing/testcases endpoint
 * expects. This is the only place that knows about that wire format --
 * Person 1 and the LLM never see it (section 9).
 */
export function compileToQaPayload(planTestcase: PlanTestcase): QaTestcasePayload {
  const payload: QaTestcasePayload = {
    description: planTestcase.description || `Experiment generated testcase: ${planTestcase.name}`,
    method: planTestcase.method.toLowerCase() as QaTestcasePayload['method'],
    url: planTestcase.url,
    headers: planTestcase.headers,
    params: planTestcase.params,
    body: planTestcase.body ?? {},
    expectedOutput: planTestcase.expectedOutput,
    delay: planTestcase.delay !== undefined ? Number(planTestcase.delay) : 1,
   // extract: planTestcase.extract
  };
  return qaTestcasePayloadSchema.parse(payload);
}

export class TestcaseGeneratorService {
  constructor(private readonly qa: QaAdapter) {}

  /**
   * Layer 2 entry point: for each planned testcase, first attempt to find
   * a suitable existing QA testcase to reuse (section 11); otherwise
   * compile-and-create a new one via the QA adapter (never a second test
   * framework).
   */
  async createTestcases(
    planTestcases: PlanTestcase[],
    experimentId: number | null
  ): Promise<CreatedTestcase[]> {
    const created: CreatedTestcase[] = [];

    for (const [index, planTestcase] of planTestcases.entries()) {
      const reused = await this.tryReuse(planTestcase);
      if (reused) {
        created.push({ ...reused, planIndex: index, reused: true });
        continue;
      }

      const payload = compileToQaPayload(planTestcase);
      const response = await this.qa.createTestCase(payload);

      logger.info({
        operation: 'qa.createTestCase',
        planIndex: index,
        qaTestcaseId: response.id,
        status: 'created'
      });

      await recordTestcase({
        experimentId,
        executionId: null,
        qaTestcaseId: response.id,
        name: planTestcase.name,
        definition: payload
      });

      created.push({
        planIndex: index,
        qaTestcaseId: response.id,
        name: planTestcase.name,
        url: planTestcase.url,
        payload,
        reused: false
      });
    }

    return created;
  }

  /**
   * Best-effort reuse lookup. Returns null (fall through to generation)
   * whenever the QA framework has no discovery capability or no match is
   * found -- this must never throw, since reuse is an optimization, not a
   * correctness requirement.
   */
  private async tryReuse(
    planTestcase: PlanTestcase
  ): Promise<Omit<CreatedTestcase, 'planIndex' | 'reused'> | null> {
    try {
      const candidates = await this.qa.findExistingTestcases({
        method: planTestcase.method.toLowerCase(),
        url: planTestcase.url
      });

      const match = candidates.find(
        (c) => String((c as any).method).toLowerCase() === planTestcase.method.toLowerCase() && (c as any).url === planTestcase.url
      );

      if (!match) return null;

      logger.info({
        operation: 'qa.reuseTestcase',
        qaTestcaseId: match.id,
        url: planTestcase.url
      });

      return {
        qaTestcaseId: match.id,
        name: planTestcase.name,
        url: planTestcase.url,
        payload: compileToQaPayload(planTestcase)
      };
    } catch {
      return null;
    }
  }
}
