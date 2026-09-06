import { getPool } from '../db/pool';
import { logger } from '../utils/logger';
import { AssertionResult } from '../services/assertion/assertion-engine';

function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function recordAssertion(params: {
  experimentId: number | null;
  executionId: number | null;
  assertion: AssertionResult;
}): Promise<void> {
  if (!isEnabled() || params.experimentId === null) return;
  try {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO experiment_assertions (experiment_id, execution_id, type, expected_json, actual_json, passed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        params.experimentId,
        params.executionId,
        `${params.assertion.source}:${params.assertion.operator}`,
        JSON.stringify(params.assertion.expected ?? null),
        JSON.stringify(params.assertion.actual ?? null),
        params.assertion.passed
      ]
    );
  } catch (err) {
    logger.error({ msg: 'recordAssertion failed', error: (err as Error).message });
  }
}
