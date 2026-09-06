import { z } from 'zod';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

/**
 * Everything below this line is the ONLY shape the LLM is allowed to
 * produce. The LLM never sees or touches anything past this schema --
 * it only emits declarative JSON that we validate here, then compile
 * into calls against the existing QA Testing Framework ourselves.
 */

export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const extractSchema = z.object({
  responsePath: z.string().min(1),
  variableName: z.string().min(1)
});

export const planTestcaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  method: httpMethodSchema,
  url: z.string().min(1).max(500),
  headers: z.record(z.string()).optional(),
  params: z.record(z.unknown()).optional(),
  body: z.record(z.unknown()).optional(),
  expectedOutput: z.record(z.unknown()).default({ type: 'object' }),
  delay: z.number().optional(),
 // extract: z.array(extractSchema).optional().default([])
});
export type PlanTestcase = z.infer<typeof planTestcaseSchema>;

export const assertionTypeSchema = z.enum(['HTTP_STATUS', 'RESPONSE_FIELD', 'DB_COUNT', 'DB_VALUE']);

export const planAssertionSchema = z.object({
  type: assertionTypeSchema,
  expected: z.unknown(),
  /** Only used for DB_COUNT / DB_VALUE. Must go through the QA query abstraction, never raw exec. */
  query: z.string().optional(),
  field: z.string().optional(),
  /** Which testcase (by position in flow.testcaseOrder) this assertion targets. Defaults to 0. */
  testcaseIndex: z.number().int().nonnegative().optional(),
  /** Whether a failing assertion should count as hypothesis-contradicting
   * evidence. Defaults to true (critical) when omitted. */
  critical: z.boolean().optional()
});
export type PlanAssertion = z.infer<typeof planAssertionSchema>;

export const experimentTypeSchema = z.enum(['API', 'FLOW', 'CONCURRENCY', 'MOCK']);

export const experimentPlanSchema = z.object({
  hypothesis: z.string().min(1),
  experimentType: experimentTypeSchema,
  objective: z.string().min(1),
  testcases: z.array(planTestcaseSchema).min(1).max(env.maxFlowSteps),
  flow: z.object({
    name: z.string().min(1),
    testcaseOrder: z.array(z.number().int().nonnegative()),
    // Passed through verbatim as the QA flow payload's `data` field (e.g. accesstoken).
    data: z.record(z.unknown()).optional().default({})
  }),
  execution: z
    .object({
      concurrency: z.number().int().positive().max(env.maxConcurrency).default(1)
    })
    .default({ concurrency: 1 }),
  assertions: z.array(planAssertionSchema).default([]),
  mock: z
    .object({
      apiName: z.string(),
      endpoint: z.string(),
      method: httpMethodSchema,
      response: z.object({
        status: z.number().int(),
        body: z.record(z.unknown())
      })
    })
    .optional()
});
export type ExperimentPlan = z.infer<typeof experimentPlanSchema>;

/** Sentinel the LLM must return verbatim when it cannot identify a valid target. */
export const INSUFFICIENT_CONTEXT = 'INSUFFICIENT_CONTEXT';

const DISALLOWED_SHELL_PATTERNS = [
  /\bexec\s*\(/i,
  /\bsystem\s*\(/i,
  /\bsubprocess\b/i,
  /;\s*rm\s+-rf/i,
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /<script/i
];

function assertNoInjection(value: string, context: string) {
  for (const pattern of DISALLOWED_SHELL_PATTERNS) {
    if (pattern.test(value)) {
      throw AppError.badRequest(
        'INVALID_EXPERIMENT_PLAN',
        `Generated plan contains disallowed content in ${context}`,
        { pattern: pattern.source }
      );
    }
  }
}

function hostnameOf(url: string): string | null {
  try {
    // Relative URLs (e.g. "/api/v1/auth/signin") are resolved against the
    // configured QA server for allow-list purposes.
    const resolved = url.startsWith('http') ? url : `${env.qaServer}${url}`;
    return new URL(resolved).hostname;
  } catch {
    return null;
  }
}

/**
 * Business + security validation layer. Runs AFTER Zod structural
 * validation and BEFORE anything is compiled into a QA testcase.
 *
 * GLM-5 -> JSON.parse -> Zod -> [this function] -> Testcase Builder -> QA Framework
 */
export function validatePlanBusinessRules(plan: ExperimentPlan): void {
  if (plan.testcases.length > env.maxTestcasesPerExperiment) {
    throw AppError.badRequest(
      'INVALID_EXPERIMENT_PLAN',
      `Plan requests ${plan.testcases.length} testcases, exceeding MAX_TESTCASES_PER_EXPERIMENT (${env.maxTestcasesPerExperiment})`
    );
  }

  if (plan.execution.concurrency > env.maxConcurrency) {
    throw AppError.badRequest(
      'INVALID_EXPERIMENT_PLAN',
      `Requested concurrency ${plan.execution.concurrency} exceeds MAX_CONCURRENCY (${env.maxConcurrency})`
    );
  }

  const maxIndex = plan.testcases.length - 1;
  for (const idx of plan.flow.testcaseOrder) {
    if (idx > maxIndex) {
      throw AppError.badRequest(
        'INVALID_EXPERIMENT_PLAN',
        `flow.testcaseOrder references testcase index ${idx} but only ${plan.testcases.length} testcases were generated`
      );
    }
  }

  for (const [i, tc] of plan.testcases.entries()) {
    const host = hostnameOf(tc.url);
    if (!host || !env.allowedTargetHosts.includes(host)) {
      throw AppError.badRequest(
        'DISALLOWED_TARGET',
        `Testcase ${i} targets a host not in the allowed environment configuration`,
        { url: tc.url, host }
      );
    }
    assertNoInjection(tc.url, `testcases[${i}].url`);
    assertNoInjection(JSON.stringify(tc.body ?? {}), `testcases[${i}].body`);
    assertNoInjection(JSON.stringify(tc.headers ?? {}), `testcases[${i}].headers`);
  }

  for (const [i, assertion] of plan.assertions.entries()) {
    if ((assertion.type === 'DB_COUNT' || assertion.type === 'DB_VALUE') && assertion.query) {
      assertNoInjection(assertion.query, `assertions[${i}].query`);
      if (!/^\s*SELECT\b/i.test(assertion.query)) {
        throw AppError.badRequest(
          'INVALID_EXPERIMENT_PLAN',
          `assertions[${i}] must use a read-only SELECT query via the QA query abstraction`
        );
      }
    }
  }

  if (plan.mock) {
    const host = hostnameOf(plan.mock.endpoint);
    // Mock targets describe the endpoint being mocked, not necessarily a
    // full URL, so we don't hard-fail on host resolution here -- but we
    // still scan for injection attempts.
    assertNoInjection(plan.mock.endpoint, 'mock.endpoint');
    assertNoInjection(JSON.stringify(plan.mock.response.body), 'mock.response.body');
    void host;
  }
}
