import pino from 'pino';
import { env } from '../config/env';

/**
 * Central logger. Redaction paths cover every place a secret could leak:
 * request/response headers, LiteLLM key, DB connection strings, cookies.
 * NEVER log env.litellmApiKey, Authorization headers, cookies, passwords,
 * or env.databaseUrl directly -- always go through this logger's redaction
 * or scrub the value yourself before logging.
 */
export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.authorization',
      '*.Authorization',
      '*.apiKey',
      '*.api_key',
      '*.litellmApiKey',
      '*.LITELLM_API_KEY',
      '*.password',
      '*.databaseUrl',
      '*.DATABASE_URL',
      '*.cookie',
      '*.cookies'
    ],
    censor: '[REDACTED]'
  },
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
