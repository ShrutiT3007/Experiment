import { getPool } from '../db/pool';
import { logger } from '../utils/logger';

function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function recordFlow(params: {
  experimentId: number | null;
  executionId: number | null;
  qaFlowId: number;
  definition: unknown;
}): Promise<void> {
  if (!isEnabled() || params.experimentId === null) return;
  try {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO experiment_flows (experiment_id, execution_id, qa_flow_id, definition_json)
       VALUES (?, ?, ?, ?)`,
      [params.experimentId, params.executionId, params.qaFlowId, JSON.stringify(params.definition)]
    );
  } catch (err) {
    logger.error({ msg: 'recordFlow failed', error: (err as Error).message });
  }
}
