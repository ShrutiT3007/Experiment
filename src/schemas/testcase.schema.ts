import { z } from 'zod';

/**
 * This is the EXACT shape the existing QA Testing Framework's
 * POST /api/v1/qa-testing/testcases endpoint expects. This shape is never
 * exposed to Person 1 -- it is an internal compilation target produced by
 * the Testcase Builder from a validated ExperimentPlan.
 */
export const qaTestcasePayloadSchema = z.object({
  description: z.string(),
  method: z.enum(['get', 'post', 'put', 'patch', 'delete']),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  params: z.record(z.unknown()).optional(),
  body: z.record(z.unknown()).optional(),
  expectedOutput: z.record(z.unknown()),
  delay: z.number().optional(),
  // extract: z
  //   .array(
  //     z.object({
  //       responsePath: z.string(),
  //       variableName: z.string()
  //     })
  //   )
  //   .optional()
});
export type QaTestcasePayload = z.infer<typeof qaTestcasePayloadSchema>;

export const qaTestcaseResponseSchema = z.object({
  id: z.number(),
  description: z.string().optional(),
  method: z.string().optional(),
  url: z.string().optional()
});
export type QaTestcaseResponse = z.infer<typeof qaTestcaseResponseSchema>;

export const qaFlowPayloadSchema = z.object({
  flowName: z.string(),
  flow: z.record(z.unknown()).default({}),
  data: z.record(z.unknown()).default({})
});
export type QaFlowPayload = z.infer<typeof qaFlowPayloadSchema>;

export const qaFlowResponseSchema = z.object({
  id: z.number(),
  flowName: z.string().optional()
});
export type QaFlowResponse = z.infer<typeof qaFlowResponseSchema>;

export const qaExecutePayloadSchema = z.object({
  testcases: z.array(z.number()),
  flowId: z.number(),
  servicesUrls: z.record(z.string()).default({})
});
export type QaExecutePayload = z.infer<typeof qaExecutePayloadSchema>;
