import { z } from 'zod';

/**
 * Public request contract for POST /api/v1/experiment.
 * The simplest supported request is just { hypothesis }.
 */
export const experimentContextSchema = z
  .object({
    service: z.string().min(1).max(200).optional(),
    endpoint: z.string().min(1).max(500).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    requestExample: z.record(z.unknown()).optional(),
    knownFields: z.array(z.string()).optional(),
    knownDependencies: z.array(z.string()).optional()
  })
  .strict()
  .partial();

export const experimentRequestSchema = z
  .object({
    hypothesis: z
      .string()
      .min(10, 'hypothesis must be a meaningful sentence (min 10 chars)')
      .max(2000),
    context: experimentContextSchema.optional(),
    /** When true, also triggers all previously created QA flows for
     * context.service via the QA service's /services/trigger endpoint
     * (section: runPreviousQaFlows). Defaults to false -- existing
     * callers/behavior are unaffected. */
    runPreviousQaFlows: z.boolean().optional().default(false)
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.runPreviousQaFlows && !data.context?.service?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['context', 'service'],
        message: 'context.service is required when runPreviousQaFlows is true'
      });
    }
  });

export type ExperimentContext = z.infer<typeof experimentContextSchema>;
export type ExperimentRequest = z.infer<typeof experimentRequestSchema>;

export const hypothesisResultSchema = z.enum(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'INCONCLUSIVE']);
export type HypothesisResult = z.infer<typeof hypothesisResultSchema>;

export const executionStatusSchema = z.enum(['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED']);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

const assertionResultResponseSchema = z.object({
  testcaseIndex: z.number().int(),
  testcaseId: z.number().nullable(),
  source: z.string(),
  path: z.string().optional(),
  operator: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  passed: z.boolean(),
  reason: z.string()
});

const hypothesisEvaluationSchema = z.object({
  result: hypothesisResultSchema,
  supportingTestcases: z.array(z.number().nullable()),
  contradictingTestcases: z.array(z.number().nullable()),
  inconclusiveTestcases: z.array(z.number().nullable()),
  supportCount: z.number(),
  contradictionCount: z.number(),
  inconclusiveCount: z.number(),
  reason: z.string(),
  assertionResults: z.array(assertionResultResponseSchema)
});

/** Result of triggering previously created QA flows for a service
 * (runPreviousQaFlows=true), normalized from the QA framework's
 * /services/trigger response. */
const existingQaFlowResultsSchema = z.object({
  serviceName: z.string().nullable(),
  status: z.string().nullable(),
  message: z.string().nullable(),
  flows: z.array(
    z.object({
      qaFlowId: z.number().nullable(),
      status: z.string().nullable(),
      testcases: z.array(
        z.object({
          testcaseId: z.number().nullable(),
          status: z.number().nullable(),
          statusText: z.string().nullable(),
          headers: z.record(z.string()),
          body: z.unknown(),
          passedByQa: z.boolean()
        })
      )
    })
  )
});

/** Public response contract returned to Person 1 -- the single source of truth shape. */
export const experimentResultSchema = z.object({
  experimentId: z.string(),
  hypothesis: z.string(),
  status: executionStatusSchema,
  hypothesisResult: hypothesisResultSchema,
  experiment: z.object({
    type: z.string(),
    testcaseIds: z.array(z.number()).optional(),
    flowId: z.number().nullable().optional(),
    generatedTestcases: z
      .array(
        z.object({
          qaTestcaseId: z.number(),
          url: z.string()
        })
      )
      .optional()
  }),
  execution: z.object({
    qaExecutionId: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    durationMs: z.number().nullable().optional(),
    requests: z.number().optional(),
    successful: z.number().optional(),
    failed: z.number().optional()
  }),
  testcases: z.array(
    z.object({
      testcaseId: z.number(),
      status: z.string(),
      actualStatus: z.number().nullable().optional(),
      apiResponse: z.unknown().optional(),
      expectedOutput: z.unknown().optional(),
      durationMs: z.number().optional()
    })
  ),
  assertions: z.array(assertionResultResponseSchema),
  hypothesisEvaluation: hypothesisEvaluationSchema,
  evidence: z.array(z.string()),
  generatedPlan: z.unknown().optional(),
  /** Only present when the request had runPreviousQaFlows=true. */
  EXISTING_QAFLOW_RESULTS: existingQaFlowResultsSchema.optional(),
  error: z.string().optional()
});

export type ExperimentResult = z.infer<typeof experimentResultSchema>;
