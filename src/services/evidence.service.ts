import { NormalizedExecutionResult } from './experiment-runner.service';
import { AssertionResult } from './assertion/assertion-engine';

/**
 * Converts execution + assertion results into short, human-readable
 * evidence strings for Person 1 -- e.g. "Two database records were
 * created" / "Exactly one record was expected" (section 19). Hypothesis
 * classification itself lives in services/assertion/hypothesis-evaluator.ts.
 */
export class EvidenceService {
  compile(execution: NormalizedExecutionResult, assertions: AssertionResult[]): string[] {
    const evidence: string[] = [];

    if (execution.qaExecution.status === 'COMPLETED') {
      evidence.push('The flow executed successfully.');
    } else {
      evidence.push(`The flow did not complete successfully (status: ${execution.qaExecution.status}).`);
    }

    if (execution.concurrencySummary) {
      const { requests, successful, failed } = execution.concurrencySummary;
      evidence.push(`${requests} concurrent requests were executed.`);
      evidence.push(`${successful} requests succeeded and ${failed} failed.`);
    } else {
      const passed = execution.testcases.filter((t) => t.status === 'PASSED').length;
      const failedCount = execution.testcases.filter((t) => t.status === 'FAILED').length;
      const unknownCount = execution.testcases.filter((t) => t.status === 'UNKNOWN').length;
      if (passed > 0) evidence.push(`${passed} of ${execution.testcases.length} testcase(s) passed.`);
      if (failedCount > 0) evidence.push(`${failedCount} testcase(s) failed.`);
      if (unknownCount > 0) {
        evidence.push(
          `${unknownCount} testcase(s) returned no verifiable status from the QA framework.`
        );
      }
    }

    for (const assertion of assertions) {
      if (assertion.verdict === 'INCONCLUSIVE') {
        evidence.push(`Assertion (${assertion.source}) could not be evaluated: ${assertion.reason}`);
        continue;
      }
      evidence.push(
        `${assertion.source} assertion expected ${JSON.stringify(assertion.expected)} and observed ${JSON.stringify(
          assertion.actual
        )} (${assertion.passed ? 'matched' : 'did not match'}).`
      );
    }

    return evidence;
  }
}

