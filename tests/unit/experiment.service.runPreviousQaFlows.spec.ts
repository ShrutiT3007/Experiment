import nock from 'nock';
import { buildExperimentService } from '../../src/services/container';
import { LLMClient } from '../../src/llm/llm.client';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { MockAdapter } from '../../src/adapters/mock.adapter';

const QA_SERVER = 'https://qa.test.local';

function fakeLlm(): LLMClient {
  return { complete: jest.fn().mockResolvedValue({ text: '"INSUFFICIENT_CONTEXT"' }) };
}

/**
 * These tests only assert on the runPreviousQaFlows trigger behavior
 * (section: "Trigger Previous QA Flows"). The rest of the pipeline is
 * intentionally left unmocked/short-circuited (planner returns
 * INSUFFICIENT_CONTEXT) so the experiment fails fast right after the
 * trigger call, which is fine here -- we only care whether/how
 * /services/trigger was invoked.
 */
describe('ExperimentService runPreviousQaFlows', () => {
  afterEach(() => nock.cleanAll());

  it('does not call /services/trigger when runPreviousQaFlows is false', async () => {
    const triggerScope = nock(QA_SERVER).post('/api/v1/qa-testing/services/trigger').reply(200, { triggered: true });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    await expect(
      experimentService.run({
        hypothesis: 'Something meaningful happens here',
        context: { service: 'payment-service' },
        runPreviousQaFlows: false
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CONTEXT' });

    expect(triggerScope.isDone()).toBe(false);
  });

  it('does not call /services/trigger when runPreviousQaFlows is omitted', async () => {
    const triggerScope = nock(QA_SERVER).post('/api/v1/qa-testing/services/trigger').reply(200, { triggered: true });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    await expect(
      experimentService.run({
        hypothesis: 'Something meaningful happens here',
        context: { service: 'payment-service' }
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CONTEXT' });

    expect(triggerScope.isDone()).toBe(false);
  });

  it('calls POST /api/v1/qa-testing/services/trigger with the requested serviceName when runPreviousQaFlows is true', async () => {
    const triggerScope = nock(QA_SERVER)
      .post('/api/v1/qa-testing/services/trigger', { serviceName: 'payment-service' })
      .reply(200, { triggered: true });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    // The pipeline fails afterwards (INSUFFICIENT_CONTEXT from the planner)
    // -- that failure must not hide the fact that the trigger call already
    // happened.
    await expect(
      experimentService.run({
        hypothesis: 'Something meaningful happens here',
        context: { service: 'payment-service' },
        runPreviousQaFlows: true
      })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CONTEXT' });

    expect(triggerScope.isDone()).toBe(true);
  });

  it('propagates a /services/trigger failure as an AppError instead of silently continuing', async () => {
    nock(QA_SERVER)
      .post('/api/v1/qa-testing/services/trigger', { serviceName: 'payment-service' })
      .reply(500, { message: 'downstream unavailable' });

    const { experimentService } = buildExperimentService({
      qaAdapter: new QaAdapter(),
      mockAdapter: new MockAdapter(),
      llmClient: fakeLlm()
    });

    await expect(
      experimentService.run({
        hypothesis: 'Something meaningful happens here',
        context: { service: 'payment-service' },
        runPreviousQaFlows: true
      })
    ).rejects.toMatchObject({ code: 'QA_SERVICE_UNAVAILABLE' });
  });
});
