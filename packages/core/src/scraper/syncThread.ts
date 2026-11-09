import type { Pool } from "pg";
import type { ForumClient } from "./client";
import { fetchThread } from "./fetchThread";

export interface SyncThreadInput {
  slug: string;
  url: string;
  categorySlug: string;
  categoryName?: string;
  title?: string;
}

export interface SyncThreadResult {
  discussionId: number;
  discussionSlug: string;
  createdDiscussion: boolean;
  updatedDiscussion: boolean;
  postsNew: number;
  postsEdited: number;
  postsDeleted: number;
  warnings: string[];
  maxForumPostId: number | null;
  forumPostIds: number[];
}

interface DiscussionRow {
  id: number;
  title: string;
  category_id: number | null;
  post_count: number;
  last_post_at: Date | null;
  deleted_at: Date | null;
}

interface PostRow {
  id: number;
  forum_post_id: number;
  body_html: string;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function newestDate(values: Array<string | null>): string | null {
  let newest: string | null = null;
  for (const value of values) {
    if (value && (newest === null || value > newest)) newest = value;
  }
  return newest;
}

function normalizeBodyHtml(html: string): string {
  return html.replace(/\sdata-cfemail=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export async function syncThread(
  pool: Pool,
  client: ForumClient,
  item: SyncThreadInput
): Promise<SyncThreadResult> {
  const thread = await fetchThread(client, item.url);
  if (thread.posts.length === 0) {
    throw new Error(`Thread ${item.url} returned no posts.`);
  }

  const categorySlug = thread.categorySlug ?? item.categorySlug;
  const categoryName = item.categoryName ?? humanizeSlug(categorySlug);
  const title = thread.title || item.title || item.slug;
  const lastPostAt = newestDate(thread.posts.map((post) => post.createdAt));
  const openingDate = thread.posts[0]?.createdAt ?? null;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const categoryResult = await db.query<{ id: number }>(
      `INSERT INTO categories (slug, name)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [categorySlug, categoryName]
    );
    const categoryId = categoryResult.rows[0]?.id;
    if (categoryId === undefined) throw new Error("Failed to upsert category.");

    const existingResult = await db.query<DiscussionRow>(
      `SELECT id, title, category_id, post_count, last_post_at, deleted_at
         FROM discussions WHERE slug = $1`,
      [item.slug]
    );
    const existing = existingResult.rows[0];

    let discussionId: number;
    let createdDiscussion = false;
    let discussionChanged = false;

    if (!existing) {
      const inserted = await db.query<{ id: number }>(
        `INSERT INTO discussions
           (slug, category_id, title, url, created_at, last_post_at, post_count, last_scraped_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING id`,
        [item.slug, categoryId, title, item.url, openingDate, lastPostAt, thread.posts.length]
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("Failed to insert discussion.");
      discussionId = id;
      createdDiscussion = true;
      discussionChanged = true;
    } else {
      discussionId = existing.id;
      discussionChanged =
        existing.title !== title ||
        existing.category_id !== categoryId ||
        existing.post_count !== thread.posts.length ||
        (existing.last_post_at ? existing.last_post_at.toISOString() : null) !== lastPostAt ||
        existing.deleted_at !== null;

      await db.query(
        `UPDATE discussions
            SET category_id = $2,
                title = $3,
                url = $4,
                created_at = COALESCE(created_at, $5),
                last_post_at = COALESCE($6, last_post_at),
                post_count = $7,
                last_scraped_at = now(),
                deleted_at = NULL
          WHERE id = $1`,
        [discussionId, categoryId, title, item.url, openingDate, lastPostAt, thread.posts.length]
      );
    }

    const existingPostsResult = await db.query<PostRow>(
      `SELECT id, forum_post_id, body_html FROM posts WHERE discussion_id = $1`,
      [discussionId]
    );
    const existingPosts = new Map(
      existingPostsResult.rows.map((row) => [row.forum_post_id, row])
    );
    const seenPostIds = new Set<number>();
    let postsNew = 0;
    let postsEdited = 0;

    for (const post of thread.posts) {
      seenPostIds.add(post.forumPostId);
      const existingPost = existingPosts.get(post.forumPostId);

      if (!existingPost) {
        await db.query(
          `INSERT INTO posts
             (forum_post_id, discussion_id, position, author, body_html, body_text, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            post.forumPostId,
            discussionId,
            post.position,
            post.author,
            normalizeBodyHtml(post.bodyHtml),
            post.bodyText,
            post.createdAt
          ]
        );
        postsNew += 1;
      } else {
        const bodyHtml = normalizeBodyHtml(post.bodyHtml);
        const bodyChanged = normalizeBodyHtml(existingPost.body_html) !== bodyHtml;
        if (bodyChanged) postsEdited += 1;
        await db.query(
          `UPDATE posts
              SET position = $2,
                  author = $3,
                  body_html = $4,
                  body_text = $5,
                  edited_at = CASE WHEN $7 THEN now() ELSE edited_at END,
                  created_at = COALESCE($6, created_at),
                  deleted_at = NULL
            WHERE id = $1`,
          [
            existingPost.id,
            post.position,
            post.author,
            bodyHtml,
            post.bodyText,
            post.createdAt,
            bodyChanged
          ]
        );
      }
    }

    let postsDeleted = 0;
    for (const existingPost of existingPosts.values()) {
      if (seenPostIds.has(existingPost.forum_post_id)) continue;
      const deleted = await db.query(
        `UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [existingPost.id]
      );
      postsDeleted += deleted.rowCount ?? 0;
    }

    await db.query("COMMIT");

    return {
      discussionId,
      discussionSlug: item.slug,
      createdDiscussion,
      updatedDiscussion:
        !createdDiscussion &&
        (discussionChanged || postsNew > 0 || postsEdited > 0 || postsDeleted > 0),
      postsNew,
      postsEdited,
      postsDeleted,
      warnings: thread.warnings,
      maxForumPostId:
        thread.posts.length > 0
          ? Math.max(...thread.posts.map((post) => post.forumPostId))
          : null,
      forumPostIds: thread.posts.map((post) => post.forumPostId)
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function flagDiscussionDeleted(pool: Pool, slug: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE discussions SET deleted_at = now(), last_scraped_at = now()
      WHERE slug = $1 AND deleted_at IS NULL`,
    [slug]
  );
  return (result.rowCount ?? 0) > 0;
}
