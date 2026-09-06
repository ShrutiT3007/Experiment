/**
 * Converts testcase-level assertion evidence into a hypothesis verdict.
 * This is a dedicated layer, deliberately separate from raw assertion
 * counting: a testcase's several assertions collapse into ONE piece of
 * evidence (its verdict), and only testcases that actually carry
 * assertions are "relevant" to the hypothesis.
 */
import { AssertionResult } from './assertion-engine';

export type TestcaseVerdict = 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
export type HypothesisResult = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | 'INCONCLUSIVE';

export interface TestcaseAssertionEvidence {
  testcaseIndex: number;
  testcaseId: number | null;
  verdict: TestcaseVerdict;
}

export interface HypothesisEvaluation {
  result: HypothesisResult;
  supportingTestcases: (number | null)[];
  contradictingTestcases: (number | null)[];
  inconclusiveTestcases: (number | null)[];
  supportCount: number;
  contradictionCount: number;
  inconclusiveCount: number;
  reason: string;
  assertionResults: AssertionResult[];
}

/** A testcase is only "contradicting" evidence when a *critical* assertion
 * genuinely failed (a real value mismatch, not missing evidence). A
 * non-critical FAIL or any INCONCLUSIVE assertion does not, by itself,
 * override otherwise-supporting evidence -- an unrelated/supplementary
 * check must not destroy an established PASSED verdict. */
function verdictFromAssertions(results: AssertionResult[]): TestcaseVerdict {
  const criticalFail = results.some((r) => r.verdict === 'FAIL' && r.critical !== false);
  if (criticalFail) return 'FAILED';
  if (results.some((r) => r.verdict === 'PASS')) return 'PASSED';
  return 'INCONCLUSIVE';
}

export function deriveTestcaseVerdicts(assertionResults: AssertionResult[]): TestcaseAssertionEvidence[] {
  const byTestcase = new Map<number, AssertionResult[]>();
  for (const result of assertionResults) {
    const list = byTestcase.get(result.testcaseIndex) ?? [];
    list.push(result);
    byTestcase.set(result.testcaseIndex, list);
  }

  return Array.from(byTestcase.entries()).map(([testcaseIndex, results]) => ({
    testcaseIndex,
    testcaseId: results[0]?.testcaseId ?? null,
    verdict: verdictFromAssertions(results)
  }));
}

export function evaluateHypothesis(assertionResults: AssertionResult[]): HypothesisEvaluation {
  const testcaseEvidence = deriveTestcaseVerdicts(assertionResults);
  const idOf = (e: TestcaseAssertionEvidence) => e.testcaseId ?? e.testcaseIndex;

  if (testcaseEvidence.length === 0) {
    return {
      result: 'INCONCLUSIVE',
      supportingTestcases: [],
      contradictingTestcases: [],
      inconclusiveTestcases: [],
      supportCount: 0,
      contradictionCount: 0,
      inconclusiveCount: 0,
      reason: 'No assertions were evaluated against any testcase, so the hypothesis cannot be assessed.',
      assertionResults
    };
  }

  const supporting = testcaseEvidence.filter((e) => e.verdict === 'PASSED');
  const contradicting = testcaseEvidence.filter((e) => e.verdict === 'FAILED');
  const inconclusive = testcaseEvidence.filter((e) => e.verdict === 'INCONCLUSIVE');

  let result: HypothesisResult;
  let reason: string;

  if (supporting.length > 0 && contradicting.length > 0) {
    result = 'PARTIALLY_SUPPORTED';
    reason = `${supporting.length} of ${testcaseEvidence.length} relevant testcase(s) support the hypothesis, while testcase(s) ${contradicting
      .map(idOf)
      .join(', ')} provide contradictory evidence.`;
  } else if (contradicting.length > 0) {
    result = 'UNSUPPORTED';
    reason = `Testcase(s) ${contradicting.map(idOf).join(', ')} directly contradict the hypothesis and no testcase supports it.`;
  } else if (supporting.length > 0) {
    result = 'SUPPORTED';
    reason = `${supporting.length} of ${testcaseEvidence.length} relevant testcase(s) support the hypothesis with no contradictory evidence.`;
  } else {
    result = 'INCONCLUSIVE';
    reason = 'All relevant testcases produced inconclusive evidence; the hypothesis could not be reliably assessed.';
  }

  return {
    result,
    supportingTestcases: supporting.map(idOf),
    contradictingTestcases: contradicting.map(idOf),
    inconclusiveTestcases: inconclusive.map(idOf),
    supportCount: supporting.length,
    contradictionCount: contradicting.length,
    inconclusiveCount: inconclusive.length,
    reason,
    assertionResults
  };
}
