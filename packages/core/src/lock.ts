import type { Pool } from "pg";

export const SCAN_LOCK_KEY = 7_231_001;

export class ScanAlreadyRunningError extends Error {
  constructor() {
    super("Another scan is already running.");
    this.name = "ScanAlreadyRunningError";
  }
}

export interface ScanLock {
  release(): Promise<void>;
}

export async function acquireScanLock(pool: Pool): Promise<ScanLock> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [SCAN_LOCK_KEY]
    );
    if (!result.rows[0]?.locked) {
      client.release();
      throw new ScanAlreadyRunningError();
    }
  } catch (error) {
    if (!(error instanceof ScanAlreadyRunningError)) client.release();
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [SCAN_LOCK_KEY]);
      } finally {
        client.release();
      }
    }
  };
}
