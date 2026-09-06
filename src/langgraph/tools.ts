import axios from 'axios';

export interface RunExperimentInput {
  hypothesis: string;
  context?: {
    service?: string;
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    requestExample?: Record<string, unknown>;
    knownFields?: string[];
    knownDependencies?: string[];
  };
}

/**
 * LangGraph tool definition. Person 1's agent only ever sees `run_experiment`
 * -- every internal step (planning, testcase creation, flow creation,
 * execution, assertion evaluation, cleanup) is hidden behind the single
 * POST /api/v1/experiment call. Do NOT add create_testcase/create_flow/
 * execute_test/etc. as separate tools (section 35).
 */
export const runExperimentTool = {
  name: 'run_experiment',
  description:
    'Turn a debugging hypothesis into an executable API experiment: generates QA testcases and a flow, ' +
    'executes them against the existing QA framework, evaluates assertions, and returns a compiled result ' +
    'with a SUPPORTED / PARTIALLY_SUPPORTED / UNSUPPORTED / INCONCLUSIVE verdict plus evidence.',
  parameters: {
    type: 'object',
    properties: {
      hypothesis: { type: 'string', description: 'The debugging hypothesis to test.' },
      context: {
        type: 'object',
        description: 'Optional known context about the API/service under test.',
        properties: {
          service: { type: 'string' },
          endpoint: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          requestExample: { type: 'object' },
          knownFields: { type: 'array', items: { type: 'string' } },
          knownDependencies: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    required: ['hypothesis']
  }
};

export interface RunExperimentToolOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Executor for the `run_experiment` tool. Calls the single public REST
 * endpoint and returns the ExperimentResult unchanged.
 */
export async function runExperiment(
  input: RunExperimentInput,
  options: RunExperimentToolOptions = {}
): Promise<unknown> {
  const baseUrl = options.baseUrl ?? process.env.EXPERIMENT_SERVICE_URL ?? 'http://localhost:3100';
  const { data } = await axios.post(`${baseUrl}/api/v1/experiment`, input, {
    timeout: options.timeoutMs ?? 130_000
  });
  return data;
}
