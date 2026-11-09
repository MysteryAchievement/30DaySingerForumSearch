import type { Pool } from "pg";
import type {
  LatestPost,
  ScanRunRow,
  ScanStatusResponse
} from "../types";

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface RunRow {
  id: number;
  kind: "full" | "quick";
  started_at: Date;
  finished_at: Date | null;
  status: "running" | "succeeded" | "failed";
  pages_fetched: number;
  discussions_new: number;
  discussions_updated: number;
  posts_new: number;
  posts_edited: number;
  posts_deleted: number;
  max_forum_post_id: number | null;
  error: string | null;
}

function mapRun(row: RunRow): ScanRunRow {
  return {
    id: row.id,
    kind: row.kind,
    startedAt: iso(row.started_at) ?? "",
    finishedAt: iso(row.finished_at),
    status: row.status,
    pagesFetched: row.pages_fetched,
    discussionsNew: row.discussions_new,
    discussionsUpdated: row.discussions_updated,
    postsNew: row.posts_new,
    postsEdited: row.posts_edited,
    postsDeleted: row.posts_deleted,
    maxForumPostId: row.max_forum_post_id,
    error: row.error
  };
}

export async function getScanStatus(pool: Pool): Promise<ScanStatusResponse> {
  const latestPostResult = await pool.query<{
    id: number;
    forum_post_id: number;
    author: string | null;
    created_at: Date | null;
    discussion_slug: string;
    discussion_title: string;
    url: string;
  }>(
    `SELECT p.id,
            p.forum_post_id,
            p.author,
            p.created_at,
            d.slug AS discussion_slug,
            d.title AS discussion_title,
            d.url
       FROM posts p
       JOIN discussions d ON d.id = p.discussion_id
      WHERE p.deleted_at IS NULL
        AND d.deleted_at IS NULL
      ORDER BY p.forum_post_id DESC
      LIMIT 1`
  );

  const latestPostRow = latestPostResult.rows[0];
  const latestPost: LatestPost | null = latestPostRow
    ? {
        id: latestPostRow.id,
        forumPostId: latestPostRow.forum_post_id,
        author: latestPostRow.author,
        createdAt: iso(latestPostRow.created_at),
        discussionSlug: latestPostRow.discussion_slug,
        discussionTitle: latestPostRow.discussion_title,
        url: latestPostRow.url
      }
    : null;

  const lastRunResult = await pool.query<RunRow>(
    `SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1`
  );
  const lastRunRow = lastRunResult.rows[0];
  const lastRun = lastRunRow ? mapRun(lastRunRow) : null;

  const historyResult = await pool.query<RunRow>(
    `SELECT * FROM scan_runs ORDER BY id DESC LIMIT 20`
  );
  const history = historyResult.rows.map(mapRun);

  const totalsResult = await pool.query<{
    discussions: string;
    posts: string;
    categories: string;
    deleted_discussions: string;
    deleted_posts: string;
  }>(
    `SELECT (SELECT count(*) FROM discussions) AS discussions,
            (SELECT count(*) FROM posts) AS posts,
            (SELECT count(*) FROM categories) AS categories,
            (SELECT count(*) FROM discussions WHERE deleted_at IS NOT NULL) AS deleted_discussions,
            (SELECT count(*) FROM posts WHERE deleted_at IS NOT NULL) AS deleted_posts`
  );
  const totalsRow = totalsResult.rows[0];

  const latestScanPostsResult = lastRun
    ? await pool.query<{
        id: number;
        forum_post_id: number;
        author: string | null;
        created_at: Date | null;
        discussion_slug: string;
        discussion_title: string;
      }>(
        `SELECT p.id,
                p.forum_post_id,
                p.author,
                p.created_at,
                d.slug AS discussion_slug,
                d.title AS discussion_title
           FROM posts p
           JOIN discussions d ON d.id = p.discussion_id
          WHERE p.first_seen_at >= $1
          ORDER BY p.forum_post_id DESC
          LIMIT 50`,
        [new Date(lastRun.startedAt)]
      )
    : { rows: [] };

  return {
    latestPost,
    lastRun,
    totals: {
      discussions: Number(totalsRow?.discussions ?? 0),
      posts: Number(totalsRow?.posts ?? 0),
      categories: Number(totalsRow?.categories ?? 0),
      deletedDiscussions: Number(totalsRow?.deleted_discussions ?? 0),
      deletedPosts: Number(totalsRow?.deleted_posts ?? 0)
    },
    latestScanPosts: latestScanPostsResult.rows.map((row) => ({
      id: row.id,
      forumPostId: row.forum_post_id,
      author: row.author,
      createdAt: iso(row.created_at),
      discussionSlug: row.discussion_slug,
      discussionTitle: row.discussion_title
    })),
    history
  };
}
