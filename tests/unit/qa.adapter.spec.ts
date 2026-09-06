import nock from 'nock';
import { QaAdapter } from '../../src/adapters/qa.adapter';

const QA_SERVER = 'https://qa.test.local';

describe('QaAdapter', () => {
  afterEach(() => nock.cleanAll());

  it('creates a testcase and normalizes the id', async () => {
    nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(200, { id: 144 });
    const qa = new QaAdapter();
    const result = await qa.createTestCase({
      description: 'desc',
      method: 'POST',
      url: '/api/v1/auth/signin',
      expectedOutput: { type: 'object' },
      body: {}
    });
    expect(result.id).toBe(144);
  });

  it('wraps a QA failure as QA_SERVICE_UNAVAILABLE', async () => {
    nock(QA_SERVER).post('/api/v1/qa-testing/testcases').reply(500, { message: 'boom' });
    const qa = new QaAdapter();
    await expect(
      qa.createTestCase({
        description: 'desc',
        method: 'POST',
        url: '/x',
        expectedOutput: {},
        body: {}
      })
    ).rejects.toMatchObject({ code: 'QA_SERVICE_UNAVAILABLE' });
  });

  it('creates a flow and normalizes the id', async () => {
    nock(QA_SERVER).post('/api/v1/qa-testing/flow').reply(200, { id: 7 });
    const qa = new QaAdapter();
    const result = await qa.createFlow({ flowName: 'Flow', flow: {}, data: {} });
    expect(result.id).toBe(7);
  });

  it('executes a test with merged servicesUrls', async () => {
    const scope = nock(QA_SERVER)
      .post('/api/v1/qa-testing/test', (body) => {
        expect(body.testcases).toEqual([144]);
        expect(body.flowId).toBe(7);
        return true;
      })
      .reply(200, { status: 'COMPLETED', results: [] });

    const qa = new QaAdapter();
    const result = await qa.executeTest({ testcases: [144], flowId: 7, servicesUrls: {} });
    expect(scope.isDone()).toBe(true);
    expect((result.raw as any).status).toBe('COMPLETED');
  });

  it('findExistingTestcases returns [] instead of throwing when discovery is unsupported', async () => {
    nock(QA_SERVER).get('/api/v1/qa-testing/functions').query(true).reply(404);
    const qa = new QaAdapter();
    const result = await qa.findExistingTestcases({ method: 'POST', url: '/x' });
    expect(result).toEqual([]);
  });

  it('creates a query via the QA query abstraction', async () => {
    nock(QA_SERVER).post('/api/v1/qa-testing/queries').reply(200, { id: 88, result: [{ count: 1 }] });
    const qa = new QaAdapter();
    const result = await qa.createQuery({ dbId: 5, queryType: 'SELECT', query: 'SELECT COUNT(*) as count FROM t' });
    expect(result.id).toBe(88);
  });
});
