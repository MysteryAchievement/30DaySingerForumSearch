import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { createPool } from "../src/db";
import { searchDiscussions } from "../src/search";
import type { SearchScope } from "../src/types";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const runIfDb = databaseUrl ? describe : describe.skip;

runIfDb("searchDiscussions (database)", () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = createPool(databaseUrl as string);
    client = await pool.connect();
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO categories (slug, name) VALUES ('test-category', 'Test Category')
       ON CONFLICT (slug) DO NOTHING`
    );
    const category = await client.query<{ id: number }>(
      `SELECT id FROM categories WHERE slug = 'test-category'`
    );
    const categoryId = category.rows[0]?.id;

    const discussions: Array<[string, string, string]> = [
      ["test-warmups", "Vocal warmups for beginners", "This post talks about breathing and posture."],
      ["test-mix", "Finding your mix", "Use a straw to practice the transition."],
      ["test-breath", "Breath support basics", "Good breath support is important for singing. We were snarfing loudly."],
      ["test-scales", "Daily scales", "Practice scales every morning."]
    ];

    for (const [slug, title, body] of discussions) {
      const discussion = await client.query<{ id: number }>(
        `INSERT INTO discussions (slug, category_id, title, url, created_at, last_post_at, post_count)
         VALUES ($1, $2, $3, $4, now(), now(), 1) RETURNING id`,
        [slug, categoryId, title, `https://example.test/${slug}`]
      );
      const discussionId = discussion.rows[0]?.id;
      await client.query(
        `INSERT INTO posts
           (forum_post_id, discussion_id, position, author, body_html, body_text, created_at)
         VALUES ($1, $2, 1, 'Tester', $3, $3, now())`,
        [1_900_000_000 + discussions.findIndex((entry) => entry[0] === slug), discussionId, body]
      );
    }
  });

  afterAll(async () => {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  });

  const search = async (q: string, scope: SearchScope) => {
    const response = await searchDiscussions(client as unknown as Pool, {
      q,
      scope,
      page: 1,
      pageSize: 50
    });
    return new Set(response.results.map((result) => result.discussion.slug));
  };

  it("finds a term that appears only in a title", async () => {
    expect(await search("warmup", "title")).toContain("test-warmups");
    expect(await search("warmup", "body")).not.toContain("test-warmups");
  });

  it("finds a term that appears only in a body", async () => {
    expect(await search("posture", "body")).toContain("test-warmups");
    expect(await search("posture", "title")).not.toContain("test-warmups");
  });

  it("matches terms split between the title and a body only in both scope", async () => {
    expect(await search("mix straw", "both")).toContain("test-mix");
    expect(await search("mix straw", "title")).not.toContain("test-mix");
    expect(await search("mix straw", "body")).not.toContain("test-mix");
  });

  it("supports quoted phrases", async () => {
    expect(await search('"breath support"', "both")).toContain("test-breath");
    expect(await search('"support breath"', "both")).not.toContain("test-breath");
  });

  it("supports exclusions", async () => {
    const matches = await search("scales -morning", "both");
    expect(matches).not.toContain("test-scales");
  });

  it("applies English stemming", async () => {
    expect(await search("snarf", "body")).toContain("test-breath");
  });
});
