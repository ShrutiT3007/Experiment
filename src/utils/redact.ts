/**
 * Generic, reusable redaction for anything that might get logged --
 * headers, request bodies, evidence snapshots. Recurses through
 * objects/arrays and masks any key that looks sensitive, regardless of
 * which endpoint or experiment produced it.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|authorization|auth[-_]?header|cookie|session|api[-_]?key|apikey|access[-_]?key|private[-_]?key/i;

const REDACTED = '[REDACTED]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}
