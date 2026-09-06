import { EvidenceService } from '../../src/services/evidence.service';
import { NormalizedExecutionResult } from '../../src/services/experiment-runner.service';
import { EvaluatedAssertion } from '../../src/schemas/assertion.schema';

function execution(status: NormalizedExecutionResult['qaExecution']['status'] = 'COMPLETED'): NormalizedExecutionResult {
  return {
    qaExecution: { id: 'run-1', status },
    testcases: [{ testcaseId: 1, status: 'PASSED' }],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100
  };
}

describe('EvidenceService', () => {
  const service = new EvidenceService();

  it('classifies as INCONCLUSIVE when execution did not complete', () => {
    const result = service.classifyHypothesis('FAILED', [{ type: 'DB_COUNT', expected: 1, actual: 1, passed: true }]);
    expect(result).toBe('INCONCLUSIVE');
  });

  it('classifies as INCONCLUSIVE when there are no assertions', () => {
    const result = service.classifyHypothesis('COMPLETED', []);
    expect(result).toBe('INCONCLUSIVE');
  });

  it('classifies as SUPPORTED when an assertion failed to match (predicted bad behavior observed)', () => {
    const assertions: EvaluatedAssertion[] = [{ type: 'DB_COUNT', expected: 1, actual: 2, passed: false }];
    const result = service.classifyHypothesis('COMPLETED', assertions);
    expect(result).toBe('SUPPORTED');
  });

  it('classifies as DISPROVED when all assertions pass', () => {
    const assertions: EvaluatedAssertion[] = [{ type: 'DB_COUNT', expected: 1, actual: 1, passed: true }];
    const result = service.classifyHypothesis('COMPLETED', assertions);
    expect(result).toBe('DISPROVED');
  });

  it('compiles readable evidence strings', () => {
    const assertions: EvaluatedAssertion[] = [{ type: 'DB_COUNT', expected: 1, actual: 2, passed: false }];
    const evidence = service.compile(execution(), assertions);
    expect(evidence.some((e) => e.includes('executed successfully'))).toBe(true);
    expect(evidence.some((e) => e.includes('DB_COUNT'))).toBe(true);
  });

  it('notes concurrency summary in evidence', () => {
    const exec = execution();
    exec.concurrencySummary = { requests: 100, successful: 98, failed: 2 };
    const evidence = service.compile(exec, []);
    expect(evidence.some((e) => e.includes('100 concurrent requests'))).toBe(true);
  });
});
