import type { Pool } from "pg";
import {
  ScanAlreadyRunningError,
  acquireScanLock,
  runQuickScan,
  type ForumClient
} from "@forum/core";

let activeScan: Promise<void> | null = null;

export function isScanRunning(): boolean {
  return activeScan !== null;
}

export async function startQuickScan(pool: Pool, client: ForumClient): Promise<void> {
  if (activeScan) throw new ScanAlreadyRunningError();

  const lock = await acquireScanLock(pool);

  const run = runQuickScan({ pool, client })
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error(`Scan failed: ${(error as Error).message}`);
    })
    .finally(async () => {
      await lock.release();
      activeScan = null;
    });

  activeScan = run;
}
