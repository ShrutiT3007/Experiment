import nock from 'nock';
import { buildExperimentService } from '../../src/services/container';
import { LLMClient } from '../../src/llm/llm.client';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { MockAdapter } from '../../src/adapters/mock.adapter';

const QA_SERVER = 'https://qa.test.local';

const planJson = JSON.stringify({
  hypothesis: 'The login API should return a successful login response',
  experimentType: 'API',
  objective: 'Verify login succeeds with valid credentials',
  testcases: [
    {
      name: 'Login',
      description: 'Attempt login with valid credentials',
      method: 'POST',
      url: '/api/v1/auth/signin',
      expectedOutput: { type: 'object' },
      body: { username: 'demo', password: 'demo' },
      extract: []
    }
  ],
  flow: { name: 'Login flow', testcaseOrder: [0] },
  execution: { concurrency: 1 },
  assertions: [{ type: 'HTTP_STATUS', expected: 200 }]
});

function fakeLlm(): LLMClient {
  return { complete: jest.fn().mockResolvedValue({ text: planJson }) };
}

describe('ExperimentService integration (MVP #1: login hypothesis)', () => {
  afterEach(() => nock.cleanAll());

  it('produces a single normalized ExperimentResult end-to-end', async () => {
    nock(QA_SERVER).get('/api/v1/qa-testing/functions').query(true).reply(404);
    nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(200, { id: 123 });
    nock(QA_SERVER).post('/api/v1/qa-testing/flow').reply(200, { id: 55 });
    nock(QA_SERVER)
      .post('/api/v1/qa-testing/test')
      .reply(200, {
        status: 'COMPLETED',
        executionId: 'QA-RUN-123',
        results: [
          {
            testcaseId: 123,
            status: 'PASSED',
            apiResponse: { statusCode: 200, body: { result: { token: 'abc' } } }
          }
        ]
      });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    const result = await experimentService.run({
      hypothesis: 'The login API should return a successful login response',
      context: { endpoint: '/api/v1/auth/signin', method: 'POST' }
    });

    expect(result.experimentId).toMatch(/^EXP-/);
    expect(result.status).toBe('COMPLETED');
    expect(result.experiment.testcaseIds).toEqual([123]);
    expect(result.experiment.flowId).toBe(55);
    expect(result.execution.qaExecutionId).toBe('QA-RUN-123');
    expect(result.testcases[0]).toMatchObject({ testcaseId: 123, status: 'PASSED' });
    expect(result.assertions[0]).toMatchObject({ type: 'HTTP_STATUS', passed: true });
    expect(result.hypothesisResult).toBe('DISPROVED'); // all assertions passed => predicted failure not observed
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('returns INCONCLUSIVE and does not throw a fabricated verdict when QA execution fails', async () => {
    nock(QA_SERVER).get('/api/v1/qa-testing/functions').query(true).reply(404);
    nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(200, { id: 124 });
    nock(QA_SERVER).post('/api/v1/qa-testing/flow').reply(200, { id: 56 });
    nock(QA_SERVER).post('/api/v1/qa-testing/test').reply(500, { message: 'downstream unavailable' });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    const result = await experimentService.run({
      hypothesis: 'The login API should return a successful login response'
    });

    expect(result.status).toBe('FAILED');
    expect(result.hypothesisResult).toBe('INCONCLUSIVE');
  });

  it('propagates INSUFFICIENT_CONTEXT as a 400-mapped AppError without calling QA at all', async () => {
    const qaScope = nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(200, { id: 1 });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: { complete: jest.fn().mockResolvedValue({ text: '"INSUFFICIENT_CONTEXT"' }) }
    });

    await expect(
      experimentService.run({ hypothesis: 'Something is sometimes wrong somewhere' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CONTEXT', httpStatus: 400 });

    expect(qaScope.isDone()).toBe(false);
  });
});
