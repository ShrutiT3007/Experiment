import { ResultSetHeader } from 'mysql2';
import { getPool } from '../db/pool';
import { logger } from '../utils/logger';

function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function createExecution(params: {
  uuid: string;
  experimentId: number | null;
  status: string;
}): Promise<number | null> {
  if (!isEnabled() || params.experimentId === null) return null;
  try {
    const pool = getPool();
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO experiment_executions (uuid, experiment_id, status, started_at)
       VALUES (?, ?, ?, NOW())`,
      [params.uuid, params.experimentId, params.status]
    );
    return result.insertId;
  } catch (err) {
    logger.error({ msg: 'createExecution failed', error: (err as Error).message });
    return null;
  }
}

export async function completeExecution(
  id: number | null,
  params: { status: string; qaExecutionId?: string | null; durationMs?: number; metadata?: unknown }
): Promise<void> {
  if (!isEnabled() || id === null) return;
  try {
    const pool = getPool();
    await pool.execute(
      `UPDATE experiment_executions
       SET status = ?, qa_execution_id = COALESCE(?, qa_execution_id),
           duration_ms = COALESCE(?, duration_ms),
           metadata_json = COALESCE(?, metadata_json),
           completed_at = NOW()
       WHERE id = ?`,
      [
        params.status,
        params.qaExecutionId ?? null,
        params.durationMs ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        id
      ]
    );
  } catch (err) {
    logger.error({ msg: 'completeExecution failed', error: (err as Error).message });
  }
}
