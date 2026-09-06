import { getPool } from '../db/pool';
import { logger } from '../utils/logger';

function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function recordTestcase(params: {
  experimentId: number | null;
  executionId: number | null;
  qaTestcaseId: number;
  name: string;
  definition: unknown;
}): Promise<void> {
  if (!isEnabled() || params.experimentId === null) return;
  try {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO experiment_testcases (experiment_id, execution_id, qa_testcase_id, name, definition_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        params.experimentId,
        params.executionId,
        params.qaTestcaseId,
        params.name,
        JSON.stringify(params.definition)
      ]
    );
  } catch (err) {
    logger.error({ msg: 'recordTestcase failed', error: (err as Error).message });
  }
}
