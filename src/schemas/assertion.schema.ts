import { z } from 'zod';
import { assertionTypeSchema } from './experiment-plan.schema';

export { assertionTypeSchema };

/**
 * Structured evidence produced by the generic assertion engine
 * (services/assertion/assertion-engine.ts). Superseded the old
 * type-keyed EvaluatedAssertion shape.
 */
export const assertionResultSchema = z.object({
  testcaseIndex: z.number().int(),
  testcaseId: z.number().nullable(),
  source: z.enum(['statusCode', 'statusText', 'header', 'cookie', 'body', 'latencyMs']),
  path: z.string().optional(),
  operator: z.enum([
    'equals',
    'notEquals',
    'exists',
    'notExists',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'matches',
    'type',
    'greaterThan',
    'greaterThanOrEqual',
    'lessThan',
    'lessThanOrEqual'
  ]),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  passed: z.boolean(),
  reason: z.string()
});
export type AssertionResultDto = z.infer<typeof assertionResultSchema>;
