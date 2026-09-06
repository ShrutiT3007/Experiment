import { ExperimentPlanner } from '../../src/services/experiment-planner.service';
import { LLMClient } from '../../src/llm/llm.client';
import { AppError } from '../../src/utils/errors';

function fakeLlm(text: string): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue({ text })
  };
}

const validPlanJson = JSON.stringify({
  hypothesis: 'The login API should return a successful login response',
  experimentType: 'API',
  objective: 'Verify login succeeds',
  testcases: [
    {
      name: 'Login',
      description: 'Attempt login',
      method: 'POST',
      url: 'https://qa.test.local/api/v1/auth/signin',
      expectedOutput: { type: 'object' },
      body: {}
    }
  ],
  flow: { name: 'Login flow', testcaseOrder: [0] },
  execution: { concurrency: 1 },
  assertions: []
});

describe('ExperimentPlanner', () => {
  it('parses and validates a well-formed LLM response', async () => {
    const planner = new ExperimentPlanner(fakeLlm(validPlanJson));
    const plan = await planner.plan({ hypothesis: 'The login API should return a successful login response' });
    expect(plan.experimentType).toBe('API');
    expect(plan.testcases).toHaveLength(1);
  });

  it('strips markdown code fences before parsing', async () => {
    const planner = new ExperimentPlanner(fakeLlm('```json\n' + validPlanJson + '\n```'));
    const plan = await planner.plan({ hypothesis: 'x'.repeat(20) });
    expect(plan.experimentType).toBe('API');
  });

  it('throws INSUFFICIENT_CONTEXT when the model declines', async () => {
    const planner = new ExperimentPlanner(fakeLlm('"INSUFFICIENT_CONTEXT"'));
    await expect(planner.plan({ hypothesis: 'something vague happens sometimes' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_CONTEXT'
    });
  });

  it('throws LLM_INVALID_OUTPUT for unparseable JSON', async () => {
    const planner = new ExperimentPlanner(fakeLlm('not json at all'));
    await expect(planner.plan({ hypothesis: 'x'.repeat(20) })).rejects.toMatchObject({
      code: 'LLM_INVALID_OUTPUT'
    });
  });

  it('throws INVALID_EXPERIMENT_PLAN for JSON that fails schema validation', async () => {
    const planner = new ExperimentPlanner(fakeLlm(JSON.stringify({ hypothesis: 'x' })));
    await expect(planner.plan({ hypothesis: 'x'.repeat(20) })).rejects.toMatchObject({
      code: 'INVALID_EXPERIMENT_PLAN'
    });
  });

  it('rejects a plan targeting a disallowed host even if structurally valid', async () => {
    const plan = JSON.parse(validPlanJson);
    plan.testcases[0].url = 'https://evil.example.com/hack';
    const planner = new ExperimentPlanner(fakeLlm(JSON.stringify(plan)));
    await expect(planner.plan({ hypothesis: 'x'.repeat(20) })).rejects.toBeInstanceOf(AppError);
  });
});
