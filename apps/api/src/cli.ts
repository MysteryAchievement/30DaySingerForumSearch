import "./env";
import {
  ForumClient,
  ScanAlreadyRunningError,
  acquireScanLock,
  createPool,
  loadConfig,
  runFullCrawl,
  runMigrations,
  runQuickScan
} from "@forum/core";

async function main(): Promise<void> {
  const command = process.argv[2];
  const resume =
    process.argv.includes("--resume") || process.env.CRAWL_RESUME === "1";
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    if (command === "migrate") {
      await runMigrations(pool);
      return;
    }

    if (command === "crawl:full" || command === "crawl:scan") {
      const client = new ForumClient({
        baseUrl: config.forumBaseUrl,
        userAgent: config.userAgent,
        delayMs: config.crawlDelayMs,
        maxRetries: config.crawlMaxRetries
      });

      const lock = await acquireScanLock(pool);
      try {
        if (command === "crawl:full") {
          await runFullCrawl({ pool, client }, { resume });
        } else {
          await runQuickScan({ pool, client });
        }
      } finally {
        await lock.release();
      }
      return;
    }

    console.error(
      "Usage: tsx apps/api/src/cli.ts <migrate|crawl:full [--resume]|crawl:scan>"
    );
    process.exitCode = 1;
  } catch (error) {
    if (error instanceof ScanAlreadyRunningError) {
      console.error("A scan is already running. Try again when it finishes.");
    } else {
      console.error((error as Error).message);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
