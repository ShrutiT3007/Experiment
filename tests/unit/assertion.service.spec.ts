import { AssertionService } from '../../src/services/assertion.service';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { NormalizedTestcaseResult } from '../../src/services/experiment-runner.service';

function testcaseResults(): NormalizedTestcaseResult[] {
  return [
    {
      testcaseId: 1,
      status: 'PASSED',
      apiResponse: { statusCode: 200, body: { txnRef: 'abc' } }
    }
  ];
}

describe('AssertionService', () => {
  it('evaluates HTTP_STATUS against testcase results', async () => {
    const qa = {} as QaAdapter;
    const service = new AssertionService(qa);
    const result = await service.evaluate(
      [{ type: 'HTTP_STATUS', expected: 200 }],
      testcaseResults()
    );
    expect(result[0].passed).toBe(true);
  });

  it('evaluates RESPONSE_FIELD by path', async () => {
    const qa = {} as QaAdapter;
    const service = new AssertionService(qa);
    const result = await service.evaluate(
      [{ type: 'RESPONSE_FIELD', field: 'body.txnRef', expected: 'abc' }],
      testcaseResults()
    );
    expect(result[0].passed).toBe(true);
  });

  it('fails HTTP_STATUS when expected 200 but actual is 500', async () => {
    const qa = {} as QaAdapter;
    const service = new AssertionService(qa);
    const results: NormalizedTestcaseResult[] = [
      { testcaseId: 213, status: 'FAILED', apiResponse: { statusCode: 500, body: null } }
    ];
    const result = await service.evaluate([{ type: 'HTTP_STATUS', expected: 200 }], results);
    expect(result[0]).toMatchObject({ actual: 500, passed: false });
  });

  it('passes HTTP_STATUS when expecting a negative-path 401', async () => {
    const qa = {} as QaAdapter;
    const service = new AssertionService(qa);
    const results: NormalizedTestcaseResult[] = [
      { testcaseId: 214, status: 'FAILED', apiResponse: { statusCode: 401, body: null } }
    ];
    const result = await service.evaluate([{ type: 'HTTP_STATUS', expected: 401 }], results);
    expect(result[0]).toMatchObject({ actual: 401, passed: true });
  });

  it('treats a null actual status as inconclusive, not a failed assertion', async () => {
    const qa = {} as QaAdapter;
    const service = new AssertionService(qa);
    const results: NormalizedTestcaseResult[] = [
      { testcaseId: 1, status: 'UNKNOWN', apiResponse: { statusCode: null, body: null } }
    ];
    const result = await service.evaluate([{ type: 'HTTP_STATUS', expected: 200 }], results);
    expect(result[0].passed).toBeUndefined();
    expect(result[0].actual).toBeNull();
  });

  it('resolves an assertion against the referenced testcaseIndex, not the first testcase', async () => {
    const qa = {} as QaAdapter;
    const service = new AssertionService(qa);
    const results: NormalizedTestcaseResult[] = [
      { testcaseId: 213, status: 'FAILED', apiResponse: { statusCode: 500, body: null } },
      { testcaseId: 214, status: 'FAILED', apiResponse: { statusCode: 401, body: null } }
    ];
    const result = await service.evaluate(
      [{ type: 'HTTP_STATUS', expected: 401, testcaseIndex: 1 }],
      results
    );
    expect(result[0]).toMatchObject({ actual: 401, passed: true, testcaseIndex: 1 });
  });

  it('evaluates DB_COUNT via the QA query abstraction', async () => {
    const qa = {
      createQuery: jest.fn().mockResolvedValue({ id: 1, result: [{ count: 2 }] })
    } as unknown as QaAdapter;
    const service = new AssertionService(qa, 5);
    const result = await service.evaluate(
      [{ type: 'DB_COUNT', expected: 1, query: 'SELECT COUNT(*) as count FROM txn_details' }],
      testcaseResults()
    );
    expect(qa.createQuery).toHaveBeenCalledWith(
      expect.objectContaining({ dbId: 5, queryType: 'SELECT' })
    );
    expect(result[0].actual).toBe(2);
    expect(result[0].passed).toBe(false);
  });

  it('marks DB assertion unevaluable when no dbId is configured', async () => {
    const qa = { createQuery: jest.fn() } as unknown as QaAdapter;
    const service = new AssertionService(qa);
    const result = await service.evaluate(
      [{ type: 'DB_COUNT', expected: 1, query: 'SELECT 1' }],
      testcaseResults()
    );
    expect(result[0].passed).toBeUndefined();
    expect(qa.createQuery).not.toHaveBeenCalled();
  });

  it('never throws even if the QA query call fails', async () => {
    const qa = {
      createQuery: jest.fn().mockRejectedValue(new Error('qa down'))
    } as unknown as QaAdapter;
    const service = new AssertionService(qa, 5);
    const result = await service.evaluate(
      [{ type: 'DB_COUNT', expected: 1, query: 'SELECT 1' }],
      testcaseResults()
    );
    expect(result[0].passed).toBeUndefined();
    expect(result[0].reason).toMatch(/qa down/);
  });
});
