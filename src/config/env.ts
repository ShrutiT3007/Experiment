import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseServicesUrls(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Every downstream module MUST read configuration through this object.
 * Never read process.env directly elsewhere, so secrets stay centrally
 * controlled and easy to audit for accidental logging.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  port: optionalNumber('PORT', 3100),

  // Existing QA Testing Framework (never exposed directly to callers).
  qaServer: required('QA_SERVER', 'http://localhost:1337'),
  qaApiKey: process.env.QA_API_KEY ?? '',
  // Credentials for POST /api/v1/auth/signin against the QA Testing
  // Framework. When unset, the adapter skips session authentication.
  qaAuthEmail: process.env.QA_AUTH_EMAIL ?? '',
  qaAuthPassword: process.env.QA_AUTH_PASSWORD ?? '',
  mockServer: required('MOCK_SERVER', 'https://mock-server-staging.fcinternal.in'),
  servicesUrls: parseServicesUrls(process.env.SERVICES_URLS_JSON),

  // LiteLLM / GLM-5. LITELLM_API_KEY must never be logged.
  litellmApiKey: process.env.LITELLM_API_KEY ?? '',
  litellmBaseUrl: process.env.LITELLM_BASE_URL ?? '',
  llmModel: process.env.LLM_MODEL ?? 'glm-5',

  // Experiment Service own metadata store (NOT the application DB).
  databaseUrl: process.env.DATABASE_URL ?? '',

  qaRequestTimeoutMs: optionalNumber('QA_REQUEST_TIMEOUT_MS', 30_000),
  llmRequestTimeoutMs: optionalNumber('LLM_REQUEST_TIMEOUT_MS', 60_000),
  experimentTimeoutMs: optionalNumber('EXPERIMENT_TIMEOUT_MS', 120_000),

  maxTestcasesPerExperiment: optionalNumber('MAX_TESTCASES_PER_EXPERIMENT', 20),
  maxFlowSteps: optionalNumber('MAX_FLOW_STEPS', 20),
  maxConcurrency: optionalNumber('MAX_CONCURRENCY', 100),

  llmMaxRetries: optionalNumber('LLM_MAX_RETRIES', 2),

  /**
   * Allow-list of hosts the generated plan is permitted to target.
   * Anything outside this list is rejected before any HTTP call is made
   * (see schemas/experiment-plan.schema.ts -> business validation).
   */
  allowedTargetHosts: (process.env.ALLOWED_TARGET_HOSTS ??
    'merchant-portal-backend-staging-01.fcinternal.in,mock-server-staging.fcinternal.in,merchanteventorchestrator-staging.fcinternal.in')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
};

export type Env = typeof env;

/** Fields that must never appear in logs, even accidentally via object spread. */
export const SENSITIVE_ENV_KEYS = ['litellmApiKey', 'databaseUrl', 'qaApiKey', 'qaAuthPassword'] as const;
