import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '../db/pool';
import { logger } from '../utils/logger';

export interface ExperimentRow extends RowDataPacket {
  id: number;
  uuid: string;
  hypothesis: string;
  status: string;
  hypothesis_result: string | null;
  experiment_type: string | null;
  environment_id: string | null;
  definition_json: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error: string | null;
}

/**
 * Persistence is best-effort: if DATABASE_URL isn't configured (e.g. local
 * dev without MySQL), the service still functions end-to-end -- it just
 * skips writing metadata rows. This keeps the manual QA/curl flow usable
 * without standing up infrastructure first.
 */
function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function createExperiment(params: {
  uuid: string;
  hypothesis: string;
  status: string;
  experimentType?: string | null;
}): Promise<number | null> {
  if (!isEnabled()) return null;
  try {
    const pool = getPool();
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO experiments (uuid, hypothesis, status, experiment_type, started_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [params.uuid, params.hypothesis, params.status, params.experimentType ?? null]
    );
    return result.insertId;
  } catch (err) {
    logger.error({ msg: 'createExperiment failed', error: (err as Error).message });
    return null;
  }
}

export async function updateExperimentStatus(
  id: number | null,
  status: string,
  extra: { hypothesisResult?: string; error?: string; completed?: boolean } = {}
): Promise<void> {
  if (!isEnabled() || id === null) return;
  try {
    const pool = getPool();
    await pool.execute(
      `UPDATE experiments
       SET status = ?, hypothesis_result = COALESCE(?, hypothesis_result),
           error = COALESCE(?, error),
           completed_at = CASE WHEN ? THEN NOW() ELSE completed_at END
       WHERE id = ?`,
      [status, extra.hypothesisResult ?? null, extra.error ?? null, Boolean(extra.completed), id]
    );
  } catch (err) {
    logger.error({ msg: 'updateExperimentStatus failed', error: (err as Error).message });
  }
}

export async function saveDefinitionJson(id: number | null, definition: unknown): Promise<void> {
  if (!isEnabled() || id === null) return;
  try {
    const pool = getPool();
    await pool.execute(`UPDATE experiments SET definition_json = ? WHERE id = ?`, [
      JSON.stringify(definition),
      id
    ]);
  } catch (err) {
    logger.error({ msg: 'saveDefinitionJson failed', error: (err as Error).message });
  }
}
