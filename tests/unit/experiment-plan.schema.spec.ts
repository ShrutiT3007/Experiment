import { experimentPlanSchema, validatePlanBusinessRules } from '../../src/schemas/experiment-plan.schema';

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    hypothesis: 'The login API should return a successful login response',
    experimentType: 'API',
    objective: 'Verify login succeeds with valid credentials',
    testcases: [
      {
        name: 'Login',
        description: 'Attempt login with valid credentials',
        method: 'POST',
        url: 'https://qa.test.local/api/v1/auth/signin',
        expectedOutput: { type: 'object' },
        body: { username: 'demo', password: 'demo' }
      }
    ],
    flow: { name: 'Login flow', testcaseOrder: [0] },
    execution: { concurrency: 1 },
    assertions: [],
    ...overrides
  };
}

describe('experimentPlanSchema', () => {
  it('accepts a minimal valid plan', () => {
    const result = experimentPlanSchema.safeParse(basePlan());
    expect(result.success).toBe(true);
  });

  it('rejects an invalid HTTP method', () => {
    const plan = basePlan({
      testcases: [
        {
          name: 'Bad',
          description: 'bad',
          method: 'FETCH',
          url: 'https://qa.test.local/x',
          expectedOutput: {}
        }
      ]
    });
    const result = experimentPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown experiment type', () => {
    const plan = basePlan({ experimentType: 'HACK' });
    const result = experimentPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });
});

describe('validatePlanBusinessRules', () => {
  it('passes for an in-allowlist target', () => {
    const plan = experimentPlanSchema.parse(basePlan());
    expect(() => validatePlanBusinessRules(plan)).not.toThrow();
  });

  it('rejects a target host outside the allow-list', () => {
    const plan = experimentPlanSchema.parse(
      basePlan({
        testcases: [
          {
            name: 'Evil',
            description: 'evil',
            method: 'POST',
            url: 'https://evil.example.com/steal',
            expectedOutput: {}
          }
        ]
      })
    );
    expect(() => validatePlanBusinessRules(plan)).toThrow(/DISALLOWED_TARGET|host/i);
  });

  it('rejects a flow.testcaseOrder index out of range', () => {
    const plan = experimentPlanSchema.parse(basePlan({ flow: { name: 'x', testcaseOrder: [5] } }));
    expect(() => validatePlanBusinessRules(plan)).toThrow();
  });

  it('rejects concurrency above MAX_CONCURRENCY', () => {
    expect(() =>
      experimentPlanSchema.parse(basePlan({ execution: { concurrency: 999999 } }))
    ).toThrow();
  });

  it('rejects a DB assertion query that is not a SELECT', () => {
    const plan = experimentPlanSchema.parse(
      basePlan({
        assertions: [{ type: 'DB_COUNT', expected: 1, query: 'DELETE FROM txn_details' }]
      })
    );
    expect(() => validatePlanBusinessRules(plan)).toThrow();
  });

  it('rejects body content containing shell/SQL injection patterns', () => {
    const plan = experimentPlanSchema.parse(
      basePlan({
        testcases: [
          {
            name: 'Injected',
            description: 'x',
            method: 'POST',
            url: 'https://qa.test.local/api/x',
            body: { note: 'DROP TABLE users' },
            expectedOutput: {}
          }
        ]
      })
    );
    expect(() => validatePlanBusinessRules(plan)).toThrow();
  });
});
