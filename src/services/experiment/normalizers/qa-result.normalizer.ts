/**
 * Normalizes the QA Testing Framework's POST /api/v1/qa-testing/test-sync
 * response into an Experiment Service-owned shape. QA's `apiResponse` is a
 * JSON-encoded string carrying the ACTUAL HTTP response from the target
 * API, and `output` is a free-text QA-side assertion sentence -- neither
 * may be used as-is by the assertion engine, hence this dedicated layer.
 *
 * Verified QA response shape:
 * { result: { data: [ { id, output, apiResponse: "<json string>" } ], message }, error: null }
 */

export interface NormalizedQaTestcaseResult {
  testcaseId: number | null;
  status: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  body: unknown;
  /** QA's own "did I execute/assert this testcase ok" signal -- NOT the
   * Experiment hypothesis or assertion result. Never use this to decide
   * SUPPORTED/DISPROVED/INCONCLUSIVE. */
  passedByQa: boolean;
  raw: unknown;
}

export interface NormalizedQaExecutionResult {
  executionStatus: 'COMPLETED';
  message: string | null;
  testcases: NormalizedQaTestcaseResult[];
  raw: unknown;
}

interface ParsedApiResponse {
  status: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  body: unknown;
}

const EMPTY_PARSED_API_RESPONSE: ParsedApiResponse = {
  status: null,
  statusText: null,
  headers: {},
  body: null
};

function normalizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== undefined && value !== null) headers[key] = String(value);
  }
  return headers;
}

/** Parses `apiResponse` defensively -- it may be a JSON string or an
 * already-parsed object, and must never throw on malformed input. */
function parseApiResponse(value: unknown): ParsedApiResponse {
  let parsed: unknown = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { ...EMPTY_PARSED_API_RESPONSE };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ...EMPTY_PARSED_API_RESPONSE };
  }

  const obj = parsed as Record<string, unknown>;
  return {
    status: typeof obj.status === 'number' ? obj.status : null,
    statusText: typeof obj.statusText === 'string' ? obj.statusText : null,
    headers: normalizeHeaders(obj.headers),
    body: 'data' in obj ? (obj.data ?? null) : null
  };
}

/** Shared per-item mapping used by both single-flow execution results and
 * multi-flow /services/trigger results -- both embed the same
 * { id, output, apiResponse } shape. */
function mapQaResultItems(rawItems: unknown[]): NormalizedQaTestcaseResult[] {
  return rawItems
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const parsed = parseApiResponse(item.apiResponse);
      return {
        testcaseId: typeof item.id === 'number' ? item.id : null,
        status: parsed.status,
        statusText: parsed.statusText,
        headers: parsed.headers,
        body: parsed.body,
        passedByQa: item.output === 'Api response is valid ' || item.output === 'Api response is valid',
        raw: item
      };
    });
}

export function normalizeQaExecutionResult(qaResponse: unknown): NormalizedQaExecutionResult {
  const data = qaResponse as any;
  const resultBlock = data?.result;
  const rawItems: any[] = Array.isArray(resultBlock?.data) ? resultBlock.data : [];

  return {
    executionStatus: 'COMPLETED',
    message: typeof resultBlock?.message === 'string' ? resultBlock.message : null,
    testcases: mapQaResultItems(rawItems),
    raw: qaResponse
  };
}

export interface NormalizedTriggeredFlow {
  qaFlowId: number | null;
  status: string | null;
  testcases: NormalizedQaTestcaseResult[];
}

export interface NormalizedServiceTriggerResult {
  serviceName: string | null;
  status: string | null;
  message: string | null;
  flows: NormalizedTriggeredFlow[];
  raw: unknown;
}

/**
 * Normalizes POST /api/v1/qa-testing/services/trigger's response:
 * { result: { data: { serviceName, status, flows: [ { qaFlowId, status,
 * result: [ { id, output, apiResponse } ] } ] }, message }, error }
 */
export function normalizeServiceTriggerResult(qaResponse: unknown): NormalizedServiceTriggerResult {
  const data = qaResponse as any;
  const resultData = data?.result?.data;
  const rawFlows: any[] = Array.isArray(resultData?.flows) ? resultData.flows : [];

  const flows: NormalizedTriggeredFlow[] = rawFlows
    .filter((flow) => flow && typeof flow === 'object')
    .map((flow) => ({
      qaFlowId: typeof flow.qaFlowId === 'number' ? flow.qaFlowId : null,
      status: typeof flow.status === 'string' ? flow.status : null,
      testcases: mapQaResultItems(Array.isArray(flow.result) ? flow.result : [])
    }));

  return {
    serviceName: typeof resultData?.serviceName === 'string' ? resultData.serviceName : null,
    status: typeof resultData?.status === 'string' ? resultData.status : null,
    message: typeof data?.result?.message === 'string' ? data.result.message : null,
    flows,
    raw: qaResponse
  };
}

/** Safe nested field lookup (e.g. "result.data.token"). Never throws;
 * returns undefined for a missing/invalid path. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as any)[key] : undefined), obj);
}
