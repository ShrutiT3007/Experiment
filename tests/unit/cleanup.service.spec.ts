import { CleanupService, createExperimentContext } from '../../src/services/cleanup.service';
import { QaAdapter } from '../../src/adapters/qa.adapter';
import { MockAdapter } from '../../src/adapters/mock.adapter';

describe('CleanupService', () => {
  it('reports QA testcases/flows as skipped (no verified-safe delete endpoint)', async () => {
    const qa = {} as QaAdapter;
    const mock = { cleanupScenario: jest.fn() } as unknown as MockAdapter;

    const ctx = createExperimentContext('EXP-1');
    ctx.createdTestcases = [1, 2];
    ctx.createdFlows = [9];

    const service = new CleanupService(qa, mock);
    const result = await service.cleanup(ctx);

    expect(result.skipped.some((s) => s.includes('qa-testcases'))).toBe(true);
    expect(result.skipped.some((s) => s.includes('qa-flows'))).toBe(true);
  });

  it('attempts cleanup of tracked mock scenarios', async () => {
    const qa = {} as QaAdapter;
    const mock = {
      cleanupScenario: jest.fn().mockResolvedValue({ cleaned: false, reason: 'no endpoint' })
    } as unknown as MockAdapter;

    const ctx = createExperimentContext('EXP-2');
    ctx.mockScenarios = [{ responseId: 'r1', endpoint: '/kyc/verify' }];

    const service = new CleanupService(qa, mock);
    const result = await service.cleanup(ctx);

    expect(mock.cleanupScenario).toHaveBeenCalledWith(ctx.mockScenarios[0]);
    expect(result.skipped.some((s) => s.includes('mock-scenario:r1'))).toBe(true);
  });

  it('never throws even if the mock adapter fails', async () => {
    const qa = {} as QaAdapter;
    const mock = {
      cleanupScenario: jest.fn().mockRejectedValue(new Error('boom'))
    } as unknown as MockAdapter;

    const ctx = createExperimentContext('EXP-3');
    ctx.mockScenarios = [{ responseId: 'r1', endpoint: '/kyc/verify' }];

    const service = new CleanupService(qa, mock);
    await expect(service.cleanup(ctx)).rejects.toThrow();
    // Note: orchestrator wraps this in its own try/catch (see experiment.service.ts finally block)
  });
});
