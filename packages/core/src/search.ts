import type { Pool } from "pg";
import type {
  DiscussionPost,
  DiscussionResponse,
  SearchMatch,
  SearchResponse,
  SearchResult,
  SearchResultDiscussion,
  SearchScope
} from "./types";
import { HEADLINE_OPTIONS, renderHighlight } from "./html";
import { sanitizeForumHtml } from "./sanitize";

const MAX_QUERY_LENGTH = 500;
const MAX_PAGE_SIZE = 50;

export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQueryError";
  }
}

export interface SearchInput {
  q: string;
  scope: SearchScope;
  page: number;
  pageSize: number;
}

interface DiscussionRow {
  id: number;
  slug: string;
  title: string;
  url: string;
  created_at: Date | null;
  last_post_at: Date | null;
  post_count: number;
  deleted_at: Date | null;
  category_name: string | null;
  category_slug: string | null;
}

interface RankedRow extends DiscussionRow {
  rank: number | string;
}

interface MatchedPostRow {
  discussion_id: number;
  forum_post_id: number;
  author: string | null;
  created_at: Date | null;
  rank: number | string;
  snippet: string;
  total_matches: string | number;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapDiscussion(row: DiscussionRow | RankedRow): SearchResultDiscussion {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    url: row.url,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    createdAt: iso(row.created_at),
    lastPostAt: iso(row.last_post_at),
    postCount: row.post_count,
    deletedAt: iso(row.deleted_at)
  };
}

function normalizeSearchInput(input: SearchInput): SearchInput {
  const q = input.q.trim();
  if (!q) throw new InvalidQueryError("Search query is required.");
  if (q.length > MAX_QUERY_LENGTH) {
    throw new InvalidQueryError(`Search query must be ${MAX_QUERY_LENGTH} characters or fewer.`);
  }
  if (!["both", "title", "body"].includes(input.scope)) {
    throw new InvalidQueryError("scope must be one of: both, title, body.");
  }
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new InvalidQueryError("page must be an integer >= 1.");
  }
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_PAGE_SIZE) {
    throw new InvalidQueryError(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return { ...input, q };
}

async function ensureSearchableTerms(pool: Pool, q: string): Promise<void> {
  const result = await pool.query<{ nodes: number }>(
    `SELECT numnode(websearch_to_tsquery('english', $1)) AS nodes`,
    [q]
  );
  if (Number(result.rows[0]?.nodes ?? 0) <= 0) {
    throw new InvalidQueryError(
      "Search query contains no searchable terms (they may all be stop words)."
    );
  }
}

interface CteParts {
  sql: string;
  resultParams: unknown[];
}

function matchCondition(scope: SearchScope): string {
  if (scope === "title") return "d.title_tsv @@ tsq.q";
  if (scope === "body") return "p.body_tsv @@ tsq.q";
  return "(d.title_tsv || p.body_tsv) @@ tsq.q";
}

function buildCountQuery(scope: SearchScope, q: string): { sql: string; params: unknown[] } {
  if (scope === "title") {
    return {
      sql: `SELECT count(*) AS total
              FROM discussions d
              CROSS JOIN (SELECT websearch_to_tsquery('english', $1) AS q) tsq
             WHERE d.title_tsv @@ tsq.q`,
      params: [q]
    };
  }

  return {
    sql: `SELECT count(DISTINCT d.id) AS total
            FROM discussions d
            JOIN posts p ON p.discussion_id = d.id
            CROSS JOIN (SELECT websearch_to_tsquery('english', $1) AS q) tsq
           WHERE ${matchCondition(scope)}`,
    params: [q]
  };
}

function buildCte(scope: SearchScope, q: string, pageSize: number, offset: number): CteParts {
  if (scope === "title") {
    return {
      sql: `
        WITH tsq AS (SELECT websearch_to_tsquery('english', $1) AS q),
        ranked AS (
          SELECT d.id, ts_rank(d.title_tsv, tsq.q) AS rank
            FROM discussions d
            CROSS JOIN tsq
           WHERE d.title_tsv @@ tsq.q
        )`,
      resultParams: [q, pageSize, offset]
    };
  }

  const condition = matchCondition(scope);
  const rankVector = scope === "body" ? "p.body_tsv" : "d.title_tsv || p.body_tsv";

  const matchFlags =
    scope === "both"
      ? `(p.body_tsv @@ tsq.q) AS body_matches,
               (d.title_tsv @@ tsq.q) AS title_matches`
      : `true AS body_matches,
               false AS title_matches`;

  return {
    sql: `
      WITH tsq AS (SELECT websearch_to_tsquery('english', $1) AS q),
      matched AS (
        SELECT d.id AS discussion_id,
               p.forum_post_id,
               p.author,
               p.created_at,
               ts_rank(${rankVector}, tsq.q) AS rank,
               ${matchFlags},
               ts_headline('english', p.body_text, tsq.q, $2) AS snippet
          FROM discussions d
          JOIN posts p ON p.discussion_id = d.id
          CROSS JOIN tsq
         WHERE ${condition}
      ),
      post_rank AS (
        SELECT discussion_id, max(rank) AS rank FROM matched GROUP BY discussion_id
      ),
      ranked AS (
        SELECT discussion_id AS id, rank FROM post_rank
      )`,
    resultParams: [q, HEADLINE_OPTIONS, pageSize, offset]
  };
}

async function fetchMatches(
  pool: Pool,
  scope: SearchScope,
  q: string,
  discussionIds: number[]
): Promise<Map<number, { matches: SearchMatch[]; moreCount: number }>> {
  const grouped = new Map<number, { matches: SearchMatch[]; moreCount: number }>();
  if (scope === "title" || discussionIds.length === 0) return grouped;

  const cte = buildCte(scope, q, 1, 0);
  const result = await pool.query<MatchedPostRow>(
    `${cte.sql}
     SELECT m.discussion_id,
            m.forum_post_id,
            m.author,
            m.created_at,
            m.rank,
            m.snippet,
            count(*) OVER (PARTITION BY m.discussion_id) AS total_matches
       FROM matched m
      WHERE m.discussion_id = ANY($3::int[])
        AND (m.body_matches OR NOT m.title_matches)
      ORDER BY m.discussion_id, m.rank DESC, m.forum_post_id DESC`,
    [q, HEADLINE_OPTIONS, discussionIds]
  );

  for (const row of result.rows) {
    const existing = grouped.get(row.discussion_id) ?? { matches: [], moreCount: 0 };
    if (existing.matches.length < 3) {
      existing.matches.push({
        postId: Number(row.forum_post_id),
        forumPostId: Number(row.forum_post_id),
        author: row.author,
        createdAt: iso(row.created_at),
        snippet: renderHighlight(row.snippet)
      });
    }
    existing.moreCount = Math.max(
      0,
      Number(row.total_matches) - Math.min(3, Number(row.total_matches))
    );
    grouped.set(row.discussion_id, existing);
  }

  return grouped;
}

export async function searchDiscussions(
  pool: Pool,
  rawInput: SearchInput
): Promise<SearchResponse> {
  const input = normalizeSearchInput(rawInput);
  await ensureSearchableTerms(pool, input.q);

  const pageSize = input.pageSize;
  const offset = (input.page - 1) * pageSize;
  const cte = buildCte(input.scope, input.q, pageSize, offset);
  const countQuery = buildCountQuery(input.scope, input.q);

  const countResult = await pool.query<{ total: string | number }>(
    countQuery.sql,
    countQuery.params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  if (total === 0) {
    return {
      total: 0,
      page: input.page,
      pageSize,
      query: input.q,
      scope: input.scope,
      results: []
    };
  }

  const limitParam = input.scope === "title" ? 2 : 3;
  const result = await pool.query<RankedRow>(
    `${cte.sql}
     SELECT d.id,
            d.slug,
            d.title,
            d.url,
            d.created_at,
            d.last_post_at,
            d.post_count,
            d.deleted_at,
            c.name AS category_name,
            c.slug AS category_slug,
            r.rank
       FROM ranked r
       JOIN discussions d ON d.id = r.id
       LEFT JOIN categories c ON c.id = d.category_id
      ORDER BY r.rank DESC, d.last_post_at DESC NULLS LAST, d.id DESC
      LIMIT $${limitParam} OFFSET $${limitParam + 1}`,
    cte.resultParams
  );

  const discussionIds = result.rows.map((row) => row.id);
  const matchMap = await fetchMatches(pool, input.scope, input.q, discussionIds);

  const results: SearchResult[] = result.rows.map((row) => {
    const matchInfo = matchMap.get(row.id) ?? { matches: [], moreCount: 0 };
    return {
      discussion: mapDiscussion(row),
      rank: Number(row.rank),
      matches: matchInfo.matches,
      moreCount: matchInfo.moreCount
    };
  });

  return {
    total,
    page: input.page,
    pageSize,
    query: input.q,
    scope: input.scope,
    results
  };
}

interface DiscussionDetailRow extends DiscussionRow {
  category_name: string | null;
  category_slug: string | null;
}

export async function getDiscussion(
  pool: Pool,
  slug: string,
  query: string | null
): Promise<DiscussionResponse | null> {
  const discussionResult = await pool.query<DiscussionDetailRow>(
    `SELECT d.id,
            d.slug,
            d.title,
            d.url,
            d.created_at,
            d.last_post_at,
            d.post_count,
            d.deleted_at,
            c.name AS category_name,
            c.slug AS category_slug
       FROM discussions d
       LEFT JOIN categories c ON c.id = d.category_id
      WHERE d.slug = $1`,
    [slug]
  );
  const discussionRow = discussionResult.rows[0];
  if (!discussionRow) return null;

  let q = query?.trim() || null;
  if (q) {
    const nodes = await pool.query<{ nodes: number }>(
      `SELECT numnode(websearch_to_tsquery('english', $1)) AS nodes`,
      [q]
    );
    if (Number(nodes.rows[0]?.nodes ?? 0) <= 0) q = null;
  }

  const postsResult = await pool.query<{
    id: number;
    forum_post_id: number;
    position: number;
    author: string | null;
    body_html: string;
    body_text: string;
    created_at: Date | null;
    edited_at: Date | null;
    deleted_at: Date | null;
    is_match: boolean;
    highlight_html: string | null;
  }>(
    `SELECT p.id,
            p.forum_post_id,
            p.position,
            p.author,
            p.body_html,
            p.body_text,
            p.created_at,
            p.edited_at,
            p.deleted_at,
            CASE
              WHEN $2::text IS NOT NULL
               AND p.body_tsv @@ websearch_to_tsquery('english', $2)
              THEN true ELSE false
            END AS is_match,
            CASE
              WHEN $2::text IS NOT NULL
               AND p.body_tsv @@ websearch_to_tsquery('english', $2)
              THEN ts_headline('english', p.body_text, websearch_to_tsquery('english', $2), $3)
              ELSE NULL
            END AS highlight_html
       FROM posts p
      WHERE p.discussion_id = $1
      ORDER BY p.position ASC, p.forum_post_id ASC`,
    [discussionRow.id, q, HEADLINE_OPTIONS]
  );

  const posts: DiscussionPost[] = postsResult.rows.map((row) => ({
    id: row.id,
    forumPostId: row.forum_post_id,
    position: row.position,
    author: row.author,
    bodyHtml: sanitizeForumHtml(row.body_html),
    bodyText: row.body_text,
    createdAt: iso(row.created_at),
    editedAt: iso(row.edited_at),
    deletedAt: iso(row.deleted_at),
    isMatch: row.is_match,
    highlightHtml: row.highlight_html ? renderHighlight(row.highlight_html) : null
  }));

  return {
    discussion: mapDiscussion(discussionRow),
    posts,
    query: q
  };
}
