/**
 * Generic, API-agnostic assertion engine. Assertions describe WHERE the
 * evidence lives (source/path), WHAT operator to apply, and WHAT value is
 * expected -- they never encode API-specific concepts (e.g. "token",
 * "login"). Consumers (e.g. AssertionService) resolve testcase-specific
 * NormalizedHttpResponse objects and hand them to evaluateAssertion().
 */

export type AssertionSource = 'statusCode' | 'statusText' | 'header' | 'cookie' | 'body' | 'latencyMs';

export type AssertionOperator =
  | 'equals'
  | 'notEquals'
  | 'exists'
  | 'notExists'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'type'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual';

export interface ExperimentAssertion {
  testcaseIndex: number;
  source: AssertionSource;
  path?: string;
  operator: AssertionOperator;
  expected?: unknown;
  description?: string;
  /** Whether a FAIL verdict on this assertion should count as hypothesis-
   * contradicting evidence. Defaults to true when omitted -- callers must
   * explicitly opt an assertion out via `critical: false`. */
  critical?: boolean;
}

export interface NormalizedCookie {
  value: string;
  attributes?: Record<string, string | boolean>;
}

/** The generic HTTP evidence shape assertions operate against -- never QA's raw `apiResponse` string. */
export interface NormalizedHttpResponse {
  statusCode: number | null;
  statusText: string | null;
  headers: Record<string, string>;
  cookies: Record<string, NormalizedCookie>;
  body: unknown;
  latencyMs?: number;
}

export type AssertionVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface AssertionResult {
  testcaseIndex: number;
  testcaseId: number | null;
  source: AssertionSource;
  path?: string;
  operator: AssertionOperator;
  expected?: unknown;
  actual: unknown;
  verdict: AssertionVerdict;
  passed: boolean;
  reason: string;
  critical?: boolean;
}

/** Safe dot-notation lookup, e.g. "result.data.transactions.0.id". Never throws. */
export function getNestedValue(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Best-effort Set-Cookie parser. QA/runner headers are already flattened
 * to strings, so multiple cookies may arrive comma-joined -- split only
 * on commas that precede a new "name=" pair to avoid breaking on
 * comma-containing attribute values (e.g. Expires dates).
 */
export function extractCookies(headers: Record<string, string>): Record<string, NormalizedCookie> {
  const raw = findHeader(headers, 'set-cookie');
  if (!raw) return {};

  const cookies: Record<string, NormalizedCookie> = {};
  const parts = raw.split(/,(?=\s*[^;,=\s]+=)/);

  for (const part of parts) {
    const segments = part
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) continue;

    const [nameValue, ...attrSegments] = segments;
    const eqIndex = nameValue.indexOf('=');
    if (eqIndex === -1) continue;

    const name = nameValue.slice(0, eqIndex).trim();
    const value = nameValue.slice(eqIndex + 1).trim();
    if (!name) continue;

    if (attrSegments.length === 0) {
      cookies[name] = { value };
      continue;
    }

    const attributes: Record<string, string | boolean> = {};
    for (const attr of attrSegments) {
      const attrEqIndex = attr.indexOf('=');
      if (attrEqIndex === -1) attributes[attr] = true;
      else attributes[attr.slice(0, attrEqIndex).trim()] = attr.slice(attrEqIndex + 1).trim();
    }
    cookies[name] = { value, attributes };
  }

  return cookies;
}

interface ResolvedValue {
  value: unknown;
  /** false when the underlying evidence source itself was never captured
   * (e.g. no HTTP status at all) -- distinct from a path simply not being
   * present within available data. */
  available: boolean;
  unavailableReason?: string;
}

export function resolveAssertionValue(response: NormalizedHttpResponse, source: AssertionSource, path?: string): ResolvedValue {
  switch (source) {
    case 'statusCode':
      return response.statusCode === null
        ? { value: null, available: false, unavailableReason: 'No HTTP status was available for this testcase.' }
        : { value: response.statusCode, available: true };

    case 'statusText':
      return response.statusText === null
        ? { value: null, available: false, unavailableReason: 'No HTTP status text was available for this testcase.' }
        : { value: response.statusText, available: true };

    case 'header':
      return { value: path ? findHeader(response.headers, path) : undefined, available: true };

    case 'cookie': {
      const cookie = path ? response.cookies[path] : undefined;
      return { value: cookie?.value, available: true };
    }

    case 'body':
      return { value: path ? getNestedValue(response.body, path) : response.body, available: true };

    case 'latencyMs':
      return response.latencyMs === undefined
        ? { value: undefined, available: false, unavailableReason: 'No latency measurement was available for this testcase.' }
        : { value: response.latencyMs, available: true };

    default:
      return { value: undefined, available: true };
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

type OperatorOutcome = { passed: boolean; reason: string } | { error: string };

function evaluateOperator(operator: AssertionOperator, actual: unknown, expected: unknown): OperatorOutcome {
  switch (operator) {
    case 'equals':
      return {
        passed: JSON.stringify(actual) === JSON.stringify(expected),
        reason: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      };
    case 'notEquals':
      return {
        passed: JSON.stringify(actual) !== JSON.stringify(expected),
        reason: `expected a value different from ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      };
    case 'exists':
      return {
        passed: actual !== undefined && actual !== null,
        reason: actual !== undefined && actual !== null ? 'value is present' : 'value is missing'
      };
    case 'notExists':
      return {
        passed: actual === undefined || actual === null,
        reason: actual === undefined || actual === null ? 'value is absent' : 'value unexpectedly exists'
      };
    case 'contains':
      if (typeof actual === 'string') return { passed: actual.includes(String(expected)), reason: `checked substring ${JSON.stringify(expected)}` };
      if (Array.isArray(actual)) {
        return {
          passed: actual.some((item) => JSON.stringify(item) === JSON.stringify(expected)),
          reason: `checked array membership of ${JSON.stringify(expected)}`
        };
      }
      return { error: 'contains requires a string or array actual value' };
    case 'notContains':
      if (typeof actual === 'string') return { passed: !actual.includes(String(expected)), reason: `checked absence of substring ${JSON.stringify(expected)}` };
      if (Array.isArray(actual)) {
        return {
          passed: !actual.some((item) => JSON.stringify(item) === JSON.stringify(expected)),
          reason: `checked array non-membership of ${JSON.stringify(expected)}`
        };
      }
      return { error: 'notContains requires a string or array actual value' };
    case 'startsWith':
      if (typeof actual !== 'string') return { error: 'startsWith requires a string actual value' };
      return { passed: actual.startsWith(String(expected)), reason: `checked prefix ${JSON.stringify(expected)}` };
    case 'endsWith':
      if (typeof actual !== 'string') return { error: 'endsWith requires a string actual value' };
      return { passed: actual.endsWith(String(expected)), reason: `checked suffix ${JSON.stringify(expected)}` };
    case 'matches': {
      if (typeof actual !== 'string') return { error: 'matches requires a string actual value' };
      try {
        const pattern = new RegExp(String(expected));
        return { passed: pattern.test(actual), reason: `checked pattern ${String(expected)}` };
      } catch {
        return { error: `invalid regular expression: ${String(expected)}` };
      }
    }
    case 'type':
      return { passed: typeOf(actual) === expected, reason: `expected type ${String(expected)}, got ${typeOf(actual)}` };
    case 'greaterThan':
      if (typeof actual !== 'number' || typeof expected !== 'number') return { error: 'greaterThan requires numeric operands' };
      return { passed: actual > expected, reason: `checked ${actual} > ${expected}` };
    case 'greaterThanOrEqual':
      if (typeof actual !== 'number' || typeof expected !== 'number') return { error: 'greaterThanOrEqual requires numeric operands' };
      return { passed: actual >= expected, reason: `checked ${actual} >= ${expected}` };
    case 'lessThan':
      if (typeof actual !== 'number' || typeof expected !== 'number') return { error: 'lessThan requires numeric operands' };
      return { passed: actual < expected, reason: `checked ${actual} < ${expected}` };
    case 'lessThanOrEqual':
      if (typeof actual !== 'number' || typeof expected !== 'number') return { error: 'lessThanOrEqual requires numeric operands' };
      return { passed: actual <= expected, reason: `checked ${actual} <= ${expected}` };
    default:
      return { error: `Unsupported operator: ${operator as string}` };
  }
}

/**
 * Evaluates one generic assertion against one testcase's normalized HTTP
 * evidence. `response === null` means QA never produced usable evidence
 * for this testcase (e.g. execution failed before reaching the target) --
 * every assertion against it is INCONCLUSIVE, never FAIL.
 */
export function evaluateAssertion(assertion: ExperimentAssertion, response: NormalizedHttpResponse | null, testcaseId: number | null): AssertionResult {
  const base = {
    testcaseIndex: assertion.testcaseIndex,
    testcaseId,
    source: assertion.source,
    path: assertion.path,
    operator: assertion.operator,
    expected: assertion.expected,
    critical: assertion.critical
  };

  if (!response) {
    return { ...base, actual: undefined, verdict: 'INCONCLUSIVE', passed: false, reason: 'No HTTP response was available for this testcase.' };
  }

  const resolved = resolveAssertionValue(response, assertion.source, assertion.path);
  if (!resolved.available) {
    return {
      ...base,
      actual: resolved.value ?? null,
      verdict: 'INCONCLUSIVE',
      passed: false,
      reason: resolved.unavailableReason ?? 'Requested evidence was unavailable.'
    };
  }

  // A path/header/cookie that simply isn't present is missing evidence, not
  // a value that failed a comparison -- unless the assertion is explicitly
  // testing presence/absence, in which case undefined IS the answer.
  const testsPresence = assertion.operator === 'exists' || assertion.operator === 'notExists';
  if (resolved.value === undefined && !testsPresence) {
    return {
      ...base,
      actual: undefined,
      verdict: 'INCONCLUSIVE',
      passed: false,
      reason: `Path "${assertion.path ?? assertion.source}" does not exist in the response; treated as inconclusive rather than contradictory evidence.`
    };
  }

  const outcome = evaluateOperator(assertion.operator, resolved.value, assertion.expected);
  if ('error' in outcome) {
    return { ...base, actual: resolved.value, verdict: 'INCONCLUSIVE', passed: false, reason: `Invalid assertion: ${outcome.error}` };
  }

  return { ...base, actual: resolved.value, verdict: outcome.passed ? 'PASS' : 'FAIL', passed: outcome.passed, reason: outcome.reason };
}
