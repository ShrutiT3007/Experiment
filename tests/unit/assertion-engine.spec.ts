import {
  ExperimentAssertion,
  NormalizedHttpResponse,
  evaluateAssertion
} from '../../src/services/assertion/assertion-engine';
import { evaluateHypothesis } from '../../src/services/assertion/hypothesis-evaluator';

function response(overrides: Partial<NormalizedHttpResponse> = {}): NormalizedHttpResponse {
  return {
    statusCode: null,
    statusText: null,
    headers: {},
    cookies: {},
    body: null,
    ...overrides
  };
}

function assertion(overrides: Partial<ExperimentAssertion>): ExperimentAssertion {
  return {
    testcaseIndex: 0,
    source: 'statusCode',
    operator: 'equals',
    expected: 200,
    ...overrides
  };
}

describe('evaluateAssertion', () => {
  it('passes when statusCode matches', () => {
    const result = evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), response({ statusCode: 200 }), 1);
    expect(result.verdict).toBe('PASS');
    expect(result.passed).toBe(true);
  });

  it('fails when statusCode genuinely differs', () => {
    const result = evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), response({ statusCode: 500 }), 1);
    expect(result.verdict).toBe('FAIL');
    expect(result.actual).toBe(500);
  });

  it('is inconclusive (not FAIL) when a body path does not exist', () => {
    const result = evaluateAssertion(
      assertion({ source: 'body', operator: 'equals', expected: true, path: 'success' }),
      response({ statusCode: 200, body: { result: { data: {}, message: 'ok' } } }),
      228
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/does not exist/);
  });

  it('passes for an existing nested body path', () => {
    const result = evaluateAssertion(
      assertion({ source: 'body', operator: 'equals', expected: 'ekansh.k@freecharge.com', path: 'result.data.email' }),
      response({ body: { result: { data: { email: 'ekansh.k@freecharge.com' } } } }),
      228
    );
    expect(result.verdict).toBe('PASS');
  });

  it('fails when a nested body path exists but differs from expected', () => {
    const result = evaluateAssertion(
      assertion({ source: 'body', operator: 'equals', expected: 'someone@example.com', path: 'result.data.email' }),
      response({ body: { result: { data: { email: 'ekansh.k@freecharge.com' } } } }),
      228
    );
    expect(result.verdict).toBe('FAIL');
  });

  it('finds headers case-insensitively', () => {
    const result = evaluateAssertion(
      assertion({ source: 'header', operator: 'exists', path: 'Content-Type' }),
      response({ headers: { 'content-type': 'application/json' } }),
      1
    );
    expect(result.verdict).toBe('PASS');
  });

  it('treats a missing cookie as inconclusive for equals but a valid presence check for exists', () => {
    const withCookie = response({ headers: { 'set-cookie': 'access-token=abc123; HttpOnly' } });
    const exists = evaluateAssertion(assertion({ source: 'cookie', operator: 'exists', path: 'access-token' }), withCookie, 1);
    expect(exists.verdict).toBe('PASS');

    const notExists = evaluateAssertion(assertion({ source: 'cookie', operator: 'exists', path: 'refresh-token' }), withCookie, 1);
    expect(notExists.verdict).toBe('FAIL');
  });

  it('supports the "exists" operator returning FAIL (not inconclusive) for a genuinely missing field', () => {
    const result = evaluateAssertion(
      assertion({ source: 'body', operator: 'exists', path: 'result.data.transactionId' }),
      response({ body: { result: { data: {} } } }),
      1
    );
    expect(result.verdict).toBe('FAIL');
  });

  it('supports the "notExists" operator', () => {
    const result = evaluateAssertion(
      assertion({ source: 'body', operator: 'notExists', path: 'error' }),
      response({ body: { result: { data: {} }, error: null } }),
      1
    );
    expect(result.verdict).toBe('PASS');
  });

  it('is inconclusive when statusCode was never captured', () => {
    const result = evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), response({ statusCode: null }), 1);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('supports type comparisons', () => {
    const result = evaluateAssertion(
      assertion({ source: 'body', operator: 'type', expected: 'array', path: 'result.data.transactions' }),
      response({ body: { result: { data: { transactions: [1, 2] } } } }),
      1
    );
    expect(result.verdict).toBe('PASS');
  });

  it('supports greaterThan/lessThan and contains', () => {
    const gt = evaluateAssertion(
      assertion({ source: 'body', operator: 'greaterThan', expected: 100, path: 'result.data.amount' }),
      response({ body: { result: { data: { amount: 150 } } } }),
      1
    );
    expect(gt.verdict).toBe('PASS');

    const contains = evaluateAssertion(
      assertion({ source: 'body', operator: 'contains', expected: 'logged in', path: 'result.message' }),
      response({ body: { result: { message: 'User logged in successfully.' } } }),
      1
    );
    expect(contains.verdict).toBe('PASS');
  });
});

describe('testcase aggregation via evaluateHypothesis', () => {
  it('PASS + INCONCLUSIVE on the same testcase does not become a contradiction', () => {
    const withResponse = response({ statusCode: 200, body: { result: { data: {}, message: 'ok' } } });
    const results = [
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), withResponse, 228),
      evaluateAssertion(assertion({ source: 'body', operator: 'equals', expected: true, path: 'success' }), withResponse, 228)
    ];

    const evaluation = evaluateHypothesis(results);
    expect(evaluation.result).toBe('SUPPORTED');
    expect(evaluation.contradictingTestcases).toEqual([]);
    expect(evaluation.supportingTestcases).toEqual([228]);
  });

  it('a critical PASS + critical FAIL on the same testcase becomes a contradiction', () => {
    const withResponse = response({ statusCode: 500 });
    const results = [
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), withResponse, 228),
      evaluateAssertion(assertion({ source: 'body', operator: 'exists', path: 'result.data' }), response({ body: { result: { data: {} } } }), 228)
    ];

    const evaluation = evaluateHypothesis(results);
    expect(evaluation.result).toBe('UNSUPPORTED');
    expect(evaluation.contradictingTestcases).toEqual([228]);
  });

  it('a non-critical FAIL does not override an otherwise supporting testcase', () => {
    const withResponse = response({ statusCode: 200, body: { result: { message: 'different message' } } });
    const results = [
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200, critical: true }), withResponse, 228),
      evaluateAssertion(
        assertion({ source: 'body', operator: 'equals', expected: 'expected message', path: 'result.message', critical: false }),
        withResponse,
        228
      )
    ];

    const evaluation = evaluateHypothesis(results);
    expect(evaluation.result).toBe('SUPPORTED');
    expect(evaluation.contradictingTestcases).toEqual([]);
  });

  it('hypothesis is INCONCLUSIVE when the only evidence is inconclusive', () => {
    const results = [evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), response({ statusCode: null }), 228)];
    const evaluation = evaluateHypothesis(results);
    expect(evaluation.result).toBe('INCONCLUSIVE');
  });

  it('is PARTIALLY_SUPPORTED when one testcase supports and another contradicts', () => {
    const supportingResponse = response({ statusCode: 200 });
    const contradictingResponse = response({ statusCode: 500 });
    const results = [
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), supportingResponse, 101),
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200, testcaseIndex: 1 }), contradictingResponse, 102)
    ];

    const evaluation = evaluateHypothesis(results);
    expect(evaluation.result).toBe('PARTIALLY_SUPPORTED');
    expect(evaluation.supportingTestcases).toEqual([101]);
    expect(evaluation.contradictingTestcases).toEqual([102]);
  });

  it('is UNSUPPORTED when two testcases both directly contradict and none support', () => {
    const results = [
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), response({ statusCode: 500 }), 101),
      evaluateAssertion(assertion({ source: 'statusCode', expected: 200, testcaseIndex: 1 }), response({ statusCode: 500 }), 102)
    ];

    const evaluation = evaluateHypothesis(results);
    expect(evaluation.result).toBe('UNSUPPORTED');
    expect(evaluation.contradictingTestcases).toEqual([101, 102]);
  });

  it('preserves the raw QA execution/testcase data path for evidence', () => {
    const result = evaluateAssertion(assertion({ source: 'statusCode', expected: 200 }), response({ statusCode: 200 }), 228);
    expect(result.testcaseId).toBe(228);
    expect(result.source).toBe('statusCode');
  });
});
