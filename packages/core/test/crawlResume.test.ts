import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { createPool } from "../src/db";
import {
  findResumableFullRun,
  getRecentlyScrapedSlugs,
  reopenScanRun
} from "../src/scraper/scanRuns";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const runIfDb = databaseUrl ? describe : describe.skip;

runIfDb("full crawl resume helpers", () => {
  let pool: Pool;
  let client: PoolClient;
  let runId: number;
  let cutoff: Date;

  beforeAll(async () => {
    pool = createPool(databaseUrl as string);
    client = await pool.connect();
    await client.query("BEGIN");

    cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const run = await client.query<{ id: number }>(
      `INSERT INTO scan_runs (kind, status, started_at, finished_at, error)
       VALUES ('full', 'failed', $1, now(), 'interrupted')
       RETURNING id`,
      [cutoff]
    );
    const id = run.rows[0]?.id;
    if (id === undefined) throw new Error("Failed to insert test scan run.");
    runId = id;

    const rows: Array<[string, Date | null]> = [
      ["resume-recent", new Date()],
      ["resume-old", new Date(Date.now() - 2 * 60 * 60 * 1000)],
      ["resume-never", null]
    ];
    for (const [slug, scrapedAt] of rows) {
      await client.query(
        `INSERT INTO discussions (slug, title, url, last_scraped_at)
         VALUES ($1, $2, $3, $4)`,
        [slug, slug, `https://example.test/${slug}`, scrapedAt]
      );
    }
  });

  afterAll(async () => {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  });

  it("finds the latest failed or interrupted full run", async () => {
    const resumable = await findResumableFullRun(client as unknown as Pool);
    expect(resumable?.id).toBe(runId);
    expect(resumable?.startedAt.toISOString()).toBe(cutoff.toISOString());
  });

  it("returns only discussions fetched at or after the cutoff", async () => {
    const slugs = await getRecentlyScrapedSlugs(
      client as unknown as Pool,
      cutoff
    );
    expect(slugs.has("resume-recent")).toBe(true);
    expect(slugs.has("resume-old")).toBe(false);
    expect(slugs.has("resume-never")).toBe(false);
  });

  it("reopens the run and resets its counters", async () => {
    await reopenScanRun(client as unknown as Pool, runId);
    const result = await client.query<{
      status: string;
      finished_at: Date | null;
      error: string | null;
      pages_fetched: number;
      posts_new: number;
    }>(
      `SELECT status, finished_at, error, pages_fetched, posts_new
         FROM scan_runs WHERE id = $1`,
      [runId]
    );
    expect(result.rows[0]).toMatchObject({
      status: "running",
      finished_at: null,
      error: null,
      pages_fetched: 0,
      posts_new: 0
    });
  });
});
