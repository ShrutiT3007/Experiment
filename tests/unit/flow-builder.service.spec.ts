import { FlowBuilderService } from '../../src/services/flow-builder.service';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { ExperimentPlan } from '../../src/schemas/experiment-plan.schema';
import { CreatedTestcase } from '../../src/services/testcase-generator.service';

function plan(overrides: Partial<ExperimentPlan> = {}): ExperimentPlan {
  return {
    hypothesis: 'x',
    experimentType: 'FLOW',
    objective: 'x',
    testcases: [
      {
        name: 'Login',
        description: 'login',
        method: 'POST',
        url: 'https://qa.test.local/login',
        expectedOutput: {},
        body: {},
        extract: [{ responsePath: 'response.token', variableName: 'authToken' }]
      },
      {
        name: 'Loan',
        description: 'loan',
        method: 'POST',
        url: 'https://qa.test.local/loan',
        headers: { Authorization: 'Bearer ${authToken}' },
        expectedOutput: {},
        body: {},
        extract: []
      }
    ],
    flow: { name: 'Login then loan', testcaseOrder: [0, 1] },
    execution: { concurrency: 1 },
    assertions: [],
    ...overrides
  } as ExperimentPlan;
}

function created(): CreatedTestcase[] {
  return [
    { planIndex: 0, qaTestcaseId: 10, name: 'Login', url: 'https://qa.test.local/login', payload: {} as any, reused: false },
    { planIndex: 1, qaTestcaseId: 11, name: 'Loan', url: 'https://qa.test.local/loan', payload: {} as any, reused: false }
  ];
}

describe('FlowBuilderService', () => {
  it('creates a flow preserving testcase order and extraction', async () => {
    const qa = {
      createFlow: jest.fn().mockResolvedValue({ id: 999 })
    } as unknown as QaAdapter;

    const service = new FlowBuilderService(qa);
    const result = await service.buildFlow(plan(), created(), null);

    expect(result.qaFlowId).toBe(999);
    expect(result.orderedTestcaseIds).toEqual([10, 11]);

    const payloadArg = (qa.createFlow as jest.Mock).mock.calls[0][0];
    expect(payloadArg.flowName).toBe('Login then loan');
    expect(payloadArg.flow.steps).toHaveLength(2);
    expect(payloadArg.flow.steps[0].extract[0].variableName).toBe('authToken');
  });

  it('throws if a testcaseOrder index has no corresponding created testcase', async () => {
    const qa = { createFlow: jest.fn() } as unknown as QaAdapter;
    const service = new FlowBuilderService(qa);
    const badPlan = plan({ flow: { name: 'bad', testcaseOrder: [0, 5] } });
    await expect(service.buildFlow(badPlan, created(), null)).rejects.toThrow();
  });
});
