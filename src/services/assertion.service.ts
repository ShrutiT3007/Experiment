import { QaAdapter } from '../adapters/qa.adapter';
import { PlanAssertion } from '../schemas/experiment-plan.schema';
import { NormalizedTestcaseResult } from './experiment-runner.service';
import { logger } from '../utils/logger';
import { AssertionResult, NormalizedHttpResponse, evaluateAssertion, extractCookies } from './assertion/assertion-engine';
import { toGenericAssertion } from './assertion/legacy-assertion-mapper';

/**
 * Evaluates every planned assertion against the normalized execution
 * results using the generic assertion engine (see
 * services/assertion/assertion-engine.ts). DB-backed assertions go through
 * the QA query abstraction (POST /api/v1/qa-testing/queries) -- GLM-5
 * never runs SQL directly, and this service never constructs SQL either;
 * it only submits the pre-validated, read-only query string the plan
 * already carried.
 */
export class AssertionService {
  constructor(private readonly qa: QaAdapter, private readonly dbId?: number) {}

  async evaluate(assertions: PlanAssertion[], testcaseResults: NormalizedTestcaseResult[]): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];

    for (const assertion of assertions) {
      try {
        if (assertion.type === 'DB_COUNT' || assertion.type === 'DB_VALUE') {
          results.push(await this.evaluateDbAssertion(assertion));
          continue;
        }

        const generic = toGenericAssertion(assertion);
        if (!generic) {
          results.push(this.unevaluable(assertion, `Unsupported assertion type: ${assertion.type}`));
          continue;
        }

        const target = testcaseResults[generic.testcaseIndex];
        const response = this.toNormalizedHttpResponse(target?.apiResponse);
        results.push(evaluateAssertion(generic, response, target?.testcaseId ?? null));
      } catch (err) {
        logger.error({ operation: 'assertion.evaluate', type: assertion.type, error: (err as Error).message });
        results.push(this.unevaluable(assertion, `Could not evaluate assertion: ${(err as Error).message}`));
      }
    }

    return results;
  }

  /** Converts the runner's `{ statusCode, statusText, headers, body }` apiResponse into generic evidence. */
  private toNormalizedHttpResponse(apiResponse: unknown): NormalizedHttpResponse | null {
    if (!apiResponse || typeof apiResponse !== 'object') return null;
    const r = apiResponse as {
      statusCode?: number | null;
      statusText?: string | null;
      headers?: Record<string, string>;
      body?: unknown;
    };
    const headers = r.headers ?? {};
    return {
      statusCode: r.statusCode ?? null,
      statusText: r.statusText ?? null,
      headers,
      cookies: extractCookies(headers),
      body: r.body ?? null
    };
  }

  private unevaluable(assertion: PlanAssertion, reason: string): AssertionResult {
    return {
      testcaseIndex: assertion.testcaseIndex ?? -1,
      testcaseId: null,
      source: 'body',
      operator: 'exists',
      expected: assertion.expected,
      actual: undefined,
      verdict: 'INCONCLUSIVE',
      passed: false,
      reason
    };
  }

  private async evaluateDbAssertion(assertion: PlanAssertion): Promise<AssertionResult> {
    // DB evidence isn't tied to a real HTTP testcase; -1 keeps it out of
    // per-testcase hypothesis grouping while still surfacing the result.
    const testcaseIndex = assertion.testcaseIndex ?? -1;

    if (!assertion.query) {
      return {
        testcaseIndex,
        testcaseId: null,
        source: 'body',
        operator: 'equals',
        expected: assertion.expected,
        actual: undefined,
        verdict: 'INCONCLUSIVE',
        passed: false,
        reason: 'No query provided for DB assertion'
      };
    }
    if (!this.dbId) {
      return {
        testcaseIndex,
        testcaseId: null,
        source: 'body',
        operator: 'equals',
        expected: assertion.expected,
        actual: undefined,
        verdict: 'INCONCLUSIVE',
        passed: false,
        reason: 'No dbId configured for DB assertions; skipped'
      };
    }

    const result = await this.qa.createQuery({
      dbId: this.dbId,
      queryType: 'SELECT',
      query: assertion.query,
      description: 'Experiment assertion query'
    });

    const actual = this.extractScalar(result.result);
    const passed =
      assertion.type === 'DB_COUNT'
        ? Number(actual) === Number(assertion.expected)
        : JSON.stringify(actual) === JSON.stringify(assertion.expected);

    return {
      testcaseIndex,
      testcaseId: null,
      source: 'body',
      operator: 'equals',
      expected: assertion.expected,
      actual,
      verdict: passed ? 'PASS' : 'FAIL',
      passed,
      reason: `${assertion.type} query result compared against expected value`
    };
  }

  private extractScalar(result: unknown): unknown {
    if (Array.isArray(result) && result.length > 0) {
      const row = result[0] as Record<string, unknown>;
      const values = Object.values(row);
      return values.length === 1 ? values[0] : row;
    }
    return result;
  }
}
