import { experimentRequestSchema } from '../../src/schemas/experiment.schema';

describe('experimentRequestSchema (runPreviousQaFlows)', () => {
  it('accepts runPreviousQaFlows=true together with context.service', () => {
    const result = experimentRequestSchema.safeParse({
      hypothesis: 'Concurrent signups should not create duplicates',
      context: { service: 'payment-service' },
      runPreviousQaFlows: true
    });
    expect(result.success).toBe(true);
  });

  it('defaults runPreviousQaFlows to false when omitted', () => {
    const result = experimentRequestSchema.safeParse({
      hypothesis: 'Something meaningful happens here'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runPreviousQaFlows).toBe(false);
    }
  });

  it('rejects runPreviousQaFlows=true without context.service', () => {
    const result = experimentRequestSchema.safeParse({
      hypothesis: 'Something meaningful happens here',
      runPreviousQaFlows: true
    });
    expect(result.success).toBe(false);
  });

  it('rejects runPreviousQaFlows=true with a whitespace-only context.service', () => {
    const result = experimentRequestSchema.safeParse({
      hypothesis: 'Something meaningful happens here',
      context: { service: '   ' },
      runPreviousQaFlows: true
    });
    expect(result.success).toBe(false);
  });

  it('still accepts requests with no runPreviousQaFlows and no context.service (backward compatible)', () => {
    const result = experimentRequestSchema.safeParse({
      hypothesis: 'Something meaningful happens here',
      context: { endpoint: '/api/v1/auth/signin', method: 'POST' }
    });
    expect(result.success).toBe(true);
  });
});
