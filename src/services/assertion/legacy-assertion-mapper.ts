/**
 * Backward-compatible bridge from the current planner's type-based
 * PlanAssertion (HTTP_STATUS / RESPONSE_FIELD) to the generic
 * ExperimentAssertion model. The planner may keep emitting the old
 * format; the assertion engine itself never branches on `type`.
 *
 * DB_COUNT / DB_VALUE are intentionally NOT mapped here -- they are not
 * HTTP evidence and continue to be evaluated directly against the QA
 * query abstraction in AssertionService.
 */
import { PlanAssertion } from '../../schemas/experiment-plan.schema';
import { AssertionOperator, ExperimentAssertion } from './assertion-engine';

export function toGenericAssertion(assertion: PlanAssertion): ExperimentAssertion | null {
  // Absent testcaseIndex is only ever inferred as the primary (0th)
  // testcase -- never silently broadcast across every testcase in the flow.
  const testcaseIndex = assertion.testcaseIndex ?? 0;

  switch (assertion.type) {
    case 'HTTP_STATUS':
      return {
        testcaseIndex,
        source: 'statusCode',
        operator: 'equals',
        expected: assertion.expected,
        description: assertion.type,
        critical: assertion.critical
      };

    case 'RESPONSE_FIELD': {
      const operator: AssertionOperator = assertion.expected === 'exists' ? 'exists' : 'equals';
      return {
        testcaseIndex,
        source: 'body',
        path: assertion.field,
        operator,
        expected: operator === 'exists' ? undefined : assertion.expected,
        description: assertion.type,
        critical: assertion.critical
      };
    }

    default:
      return null;
  }
}
