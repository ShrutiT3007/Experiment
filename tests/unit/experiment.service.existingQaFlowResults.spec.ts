import nock from 'nock';
import { buildExperimentService } from '../../src/services/container';
import { LLMClient } from '../../src/llm/llm.client';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { MockAdapter } from '../../src/adapters/mock.adapter';

const QA_SERVER = 'https://qa.test.local';

const planJson = JSON.stringify({
  hypothesis: 'The signin API should reject an incorrect password',
  experimentType: 'API',
  objective: 'Verify signin fails for an incorrect password',
  testcases: [
    {
      name: 'Signin',
      description: 'Attempt signin with an incorrect password',
      method: 'POST',
      url: '/api/v1/auth/signin',
      expectedOutput: { httpStatus: 401 },
      body: { email: 'a@b.com', password: 'wrong' }
    }
  ],
  flow: { name: 'Signin flow', testcaseOrder: [0] },
  execution: { concurrency: 1 },
  assertions: [{ type: 'HTTP_STATUS', expected: 401, testcaseIndex: 0 }]
});

function fakeLlm(): LLMClient {
  return { complete: jest.fn().mockResolvedValue({ text: planJson }) };
}

/** Exact response shape shared for POST /api/v1/qa-testing/services/trigger. */
const TRIGGER_RESPONSE = {
  result: {
    data: {
      serviceName: 'SQS',
      status: 'SUCCESS',
      flows: [
        {
          qaFlowId: 8,
          status: 'TRIGGERED',
          result: [
            {
              id: 5,
              output: 'Api response is valid ',
              apiResponse: JSON.stringify({
                status: 500,
                statusText: 'Internal Server Error',
                headers: { 'content-type': 'application/json; charset=utf-8' },
                data: { result: null, error: { errorCode: 'ERR-500', message: "Unknown column 'createdAt' in 'field list'" } }
              })
            },
            {
              id: 6,
              output: 'Api response is valid ',
              apiResponse: JSON.stringify({
                status: 500,
                statusText: 'Internal Server Error',
                headers: {},
                data: { result: null, error: { errorCode: 'ERR-500', message: "Unknown column 'createdAt' in 'field list'" } }
              })
            }
          ]
        }
      ]
    },
    message: 'QA flows for the service have been triggered.'
  },
  error: null
};

describe('ExperimentService response: EXISTING_QAFLOW_RESULTS', () => {
  afterEach(() => nock.cleanAll());

  it('includes EXISTING_QAFLOW_RESULTS in the response when runPreviousQaFlows=true', async () => {
    nock(QA_SERVER)
      .post('/api/v1/qa-testing/services/trigger', { serviceName: 'SQS' })
      .reply(200, TRIGGER_RESPONSE);
    nock(QA_SERVER).get('/api/v1/qa-testing/functions').query(true).reply(404);
    nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(200, { id: 101 });
    nock(QA_SERVER).post('/api/v1/qa-testing/flow').reply(200, { result: { data: { id: 20 } } });
    nock(QA_SERVER)
      .post('/api/v1/qa-testing/test-sync')
      .reply(200, {
        result: {
          data: [
            {
              id: 101,
              output: 'Api response is valid ',
              apiResponse: JSON.stringify({ status: 401, statusText: 'Unauthorized', headers: {}, data: {} })
            }
          ],
          message: 'ok'
        },
        error: null
      });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    const result = await experimentService.run({
      hypothesis: 'The signin API should reject an incorrect password',
      context: { service: 'SQS', endpoint: '/api/v1/auth/signin', method: 'POST' },
      runPreviousQaFlows: true
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.EXISTING_QAFLOW_RESULTS).toMatchObject({
      serviceName: 'SQS',
      status: 'SUCCESS',
      message: 'QA flows for the service have been triggered.'
    });
    expect(result.EXISTING_QAFLOW_RESULTS!.flows).toHaveLength(1);
    expect(result.EXISTING_QAFLOW_RESULTS!.flows[0]).toMatchObject({ qaFlowId: 8, status: 'TRIGGERED' });
    expect(result.EXISTING_QAFLOW_RESULTS!.flows[0].testcases).toHaveLength(2);
    expect(result.EXISTING_QAFLOW_RESULTS!.flows[0].testcases[0]).toMatchObject({
      testcaseId: 5,
      status: 500,
      statusText: 'Internal Server Error',
      passedByQa: true
    });
  });

  it('omits EXISTING_QAFLOW_RESULTS when runPreviousQaFlows is false/omitted', async () => {
    nock(QA_SERVER).get('/api/v1/qa-testing/functions').query(true).reply(404);
    nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(200, { id: 102 });
    nock(QA_SERVER).post('/api/v1/qa-testing/flow').reply(200, { result: { data: { id: 21 } } });
    nock(QA_SERVER)
      .post('/api/v1/qa-testing/test-sync')
      .reply(200, {
        result: {
          data: [
            {
              id: 102,
              output: 'Api response is valid ',
              apiResponse: JSON.stringify({ status: 401, statusText: 'Unauthorized', headers: {}, data: {} })
            }
          ],
          message: 'ok'
        },
        error: null
      });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    const result = await experimentService.run({
      hypothesis: 'The signin API should reject an incorrect password',
      context: { endpoint: '/api/v1/auth/signin', method: 'POST' }
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.EXISTING_QAFLOW_RESULTS).toBeUndefined();
  });
});
