import { getPool } from '../db/pool';
import { logger } from '../utils/logger';

function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function recordEvidence(params: {
  experimentId: number | null;
  executionId: number | null;
  source: string;
  type: string;
  summary: string;
  data?: unknown;
}): Promise<void> {
  if (!isEnabled() || params.experimentId === null) return;
  try {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO experiment_evidence (experiment_id, execution_id, source, type, summary, data_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        params.experimentId,
        params.executionId,
        params.source,
        params.type,
        params.summary,
        params.data ? JSON.stringify(params.data) : null
      ]
    );
  } catch (err) {
    logger.error({ msg: 'recordEvidence failed', error: (err as Error).message });
  }
}
