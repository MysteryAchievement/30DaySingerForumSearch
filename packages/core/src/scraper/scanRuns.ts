import type { Pool } from "pg";
import type { ScanCounts } from "../types";

export async function startScanRun(pool: Pool, kind: "full" | "quick"): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO scan_runs (kind, status) VALUES ($1, 'running') RETURNING id`,
    [kind]
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("Failed to create scan run.");
  return id;
}

export async function finishScanRun(
  pool: Pool,
  id: number,
  status: "succeeded" | "failed",
  counts: ScanCounts,
  error: string | null
): Promise<void> {
  await pool.query(
    `UPDATE scan_runs
        SET finished_at = now(),
            status = $2,
            pages_fetched = $3,
            discussions_new = $4,
            discussions_updated = $5,
            posts_new = $6,
            posts_edited = $7,
            posts_deleted = $8,
            max_forum_post_id = $9,
            error = $10
      WHERE id = $1`,
    [
      id,
      status,
      counts.pagesFetched,
      counts.discussionsNew,
      counts.discussionsUpdated,
      counts.postsNew,
      counts.postsEdited,
      counts.postsDeleted,
      counts.maxForumPostId,
      error
    ]
  );
}

export function emptyCounts(): ScanCounts {
  return {
    pagesFetched: 0,
    discussionsNew: 0,
    discussionsUpdated: 0,
    postsNew: 0,
    postsEdited: 0,
    postsDeleted: 0,
    discussionsFlaggedDeleted: 0,
    maxForumPostId: null
  };
}

export function mergeMaxPostId(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  if (current === null) return next;
  return Math.max(current, next);
}

export interface ResumableFullRun {
  id: number;
  startedAt: Date;
}

export async function findResumableFullRun(pool: Pool): Promise<ResumableFullRun | null> {
  const result = await pool.query<{ id: number; started_at: Date }>(
    `SELECT id, started_at
       FROM scan_runs
      WHERE kind = 'full'
        AND status IN ('running', 'failed')
      ORDER BY id DESC
      LIMIT 1`
  );
  const row = result.rows[0];
  return row ? { id: row.id, startedAt: row.started_at } : null;
}

export async function reopenScanRun(pool: Pool, id: number): Promise<void> {
  await pool.query(
    `UPDATE scan_runs
        SET status = 'running',
            finished_at = NULL,
            error = NULL,
            pages_fetched = 0,
            discussions_new = 0,
            discussions_updated = 0,
            posts_new = 0,
            posts_edited = 0,
            posts_deleted = 0,
            max_forum_post_id = NULL
      WHERE id = $1`,
    [id]
  );
}

export async function getRecentlyScrapedSlugs(
  pool: Pool,
  since: Date
): Promise<Set<string>> {
  const result = await pool.query<{ slug: string }>(
    `SELECT slug
       FROM discussions
      WHERE last_scraped_at IS NOT NULL
        AND last_scraped_at >= $1`,
    [since]
  );
  return new Set(result.rows.map((row) => row.slug));
}
