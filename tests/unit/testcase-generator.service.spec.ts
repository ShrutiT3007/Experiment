import { TestcaseGeneratorService, compileToQaPayload } from '../../src/services/testcase-generator.service';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { PlanTestcase } from '../../src/schemas/experiment-plan.schema';

function planTestcase(overrides: Partial<PlanTestcase> = {}): PlanTestcase {
  return {
    name: 'Login',
    description: 'Attempt login',
    method: 'POST',
    url: 'https://qa.test.local/api/v1/auth/signin',
    expectedOutput: { type: 'object' },
    body: { username: 'demo' },
    extract: [],
    ...overrides
  } as PlanTestcase;
}

describe('compileToQaPayload', () => {
  it('produces the exact QA wire format', () => {
    const payload = compileToQaPayload(planTestcase({ delay: 1 }));
    expect(payload).toMatchObject({
      description: 'Attempt login',
      method: 'POST',
      url: 'https://qa.test.local/api/v1/auth/signin',
      body: { username: 'demo' },
      delay: '1'
    });
  });
});

describe('TestcaseGeneratorService', () => {
  it('creates a new testcase when no reuse candidate exists', async () => {
    const qa = {
      findExistingTestcases: jest.fn().mockResolvedValue([]),
      createTestCase: jest.fn().mockResolvedValue({ id: 101 })
    } as unknown as QaAdapter;

    const service = new TestcaseGeneratorService(qa);
    const result = await service.createTestcases([planTestcase()], null);

    expect(qa.createTestCase).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({ qaTestcaseId: 101, reused: false, planIndex: 0 })
    ]);
  });

  it('reuses an existing testcase when a matching one is found', async () => {
    const qa = {
      findExistingTestcases: jest
        .fn()
        .mockResolvedValue([{ id: 55, method: 'POST', url: 'https://qa.test.local/api/v1/auth/signin' }]),
      createTestCase: jest.fn()
    } as unknown as QaAdapter;

    const service = new TestcaseGeneratorService(qa);
    const result = await service.createTestcases([planTestcase()], null);

    expect(qa.createTestCase).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ qaTestcaseId: 55, reused: true });
  });

  it('falls back to generation when discovery throws', async () => {
    const qa = {
      findExistingTestcases: jest.fn().mockRejectedValue(new Error('not supported')),
      createTestCase: jest.fn().mockResolvedValue({ id: 7 })
    } as unknown as QaAdapter;

    const service = new TestcaseGeneratorService(qa);
    const result = await service.createTestcases([planTestcase()], null);
    expect(result[0]).toMatchObject({ qaTestcaseId: 7, reused: false });
  });
});
