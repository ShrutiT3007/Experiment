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

export function normalizeQaExecutionResult(qaResponse: unknown): NormalizedQaExecutionResult {
  const data = qaResponse as any;
  const resultBlock = data?.result;
  const rawItems: any[] = Array.isArray(resultBlock?.data) ? resultBlock.data : [];

  const testcases: NormalizedQaTestcaseResult[] = rawItems
    .filter((item) => item && typeof item === 'object')
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

  return {
    executionStatus: 'COMPLETED',
    message: typeof resultBlock?.message === 'string' ? resultBlock.message : null,
    testcases,
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
