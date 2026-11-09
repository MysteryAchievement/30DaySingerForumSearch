import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseIndexPage } from "../src/scraper/parseIndexPage";
import { parseThreadPage } from "../src/scraper/parseThreadPage";
import { fetchThread } from "../src/scraper/fetchThread";
import type { ForumClient } from "../src/scraper/client";
import { sanitizeForumHtml } from "../src/sanitize";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

class FixtureClient {
  constructor(private readonly pages: Record<string, string>) {}
  absoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
    return `https://www.30daysinger.com${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }
  async get(pathOrUrl: string): Promise<string> {
    const html = this.pages[pathOrUrl];
    if (!html) throw new Error(`No fixture for ${pathOrUrl}`);
    return html;
  }
}

describe("parseIndexPage", () => {
  const parsed = parseIndexPage(fixture("index-page1.html"));

  it("reads the result total and last page", () => {
    expect(parsed.total).toBe(2004);
    expect(parsed.lastPage).toBe(201);
  });

  it("parses every discussion on the page", () => {
    expect(parsed.items).toHaveLength(10);
    expect(parsed.items[0]).toMatchObject({
      slug: "Range-and-Song-Guide",
      categorySlug: "open-discussion",
      title: "Range and Song Guide?",
      replyCount: 1
    });
    expect(parsed.items[0]?.url).toBe(
      "https://www.30daysinger.com/forums/discussion/open-discussion/Range-and-Song-Guide"
    );
  });
});

describe("parseThreadPage", () => {
  it("parses a short thread and dates the opening post", () => {
    const parsed = parseThreadPage(
      fixture("thread-short.html"),
      "https://www.30daysinger.com/forums/discussion/open-discussion/Range-and-Song-Guide"
    );

    expect(parsed.title).toBe("Range and Song Guide?");
    expect(parsed.categorySlug).toBe("open-discussion");
    expect(parsed.posts.map((post) => post.forumPostId)).toEqual([11864, 11865]);
    expect(parsed.openingDate).toBe("2026-11-06T15:57:05.000Z");
    expect(parsed.posts[0]?.createdAt).toBe("2026-11-06T15:57:05.000Z");
    expect(parsed.posts[1]?.createdAt).toBeNull();
    expect(parsed.posts[1]?.bodyText).toContain("[email protected]");
    expect(parsed.posts[1]?.bodyHtml).toContain("cdn-cgi/l/email-protection");
    expect(parsed.nextPageUrl).toBeNull();
  });

  it("matches JSON-LD comments by text when the order differs", () => {
    const parsed = parseThreadPage(
      fixture("thread-mismatched.html"),
      "https://www.30daysinger.com/forums/discussion/open-discussion/Daily-routines-for-intermediateadvance-singers"
    );

    expect(parsed.posts.map((post) => post.forumPostId)).toEqual([11857, 11858, 11859]);
    expect(parsed.posts[0]?.createdAt).toBe("2026-10-05T20:37:16.000Z");
    expect(parsed.posts[1]?.createdAt).toBeNull();
    expect(parsed.posts[2]?.createdAt).toBe("2026-10-12T21:06:46.000Z");
    expect(parsed.warnings.some((warning) => warning.includes("11858"))).toBe(true);
  });

  it("parses a single-post thread", () => {
    const parsed = parseThreadPage(
      fixture("thread-single.html"),
      "https://www.30daysinger.com/forums/discussion/open-discussion/Changing-the-key-of-a-song"
    );

    expect(parsed.posts).toHaveLength(1);
    expect(parsed.posts[0]?.forumPostId).toBe(4067);
    expect(parsed.posts[0]?.createdAt).toBe("2020-10-25T02:17:47.000Z");
    expect(parsed.nextPageUrl).toBeNull();
  });

  it("finds the next page of a long thread", () => {
    const parsed = parseThreadPage(
      fixture("thread-long-page1.html"),
      "https://www.30daysinger.com/forums/discussion/lesson-qa/Are-there-warm-up-and-exercise-audio-only-files-where-there-is-very-little-talking"
    );

    expect(parsed.posts).toHaveLength(10);
    expect(parsed.nextPageUrl).toContain("?page=2");
    expect(parsed.posts[0]?.createdAt).toBe("2025-07-11T10:47:27.000Z");
    const body = parsed.posts.map((post) => post.bodyText).join(" ");
    expect(body).not.toContain("&nbsp;");
  });

  it("does not apply the opening date to posts on later pages", () => {
    const parsed = parseThreadPage(
      fixture("thread-long-page2.html"),
      "https://www.30daysinger.com/forums/discussion/lesson-qa/Are-there-warm-up-and-exercise-audio-only-files-where-there-is-very-little-talking?page=2",
      { isFirstPage: false }
    );

    expect(parsed.posts.map((post) => post.forumPostId)).toEqual([11829, 11842]);
    expect(parsed.posts[0]?.createdAt).toBe("2026-09-03T11:46:26.000Z");
    expect(parsed.posts[0]?.createdAt).not.toBe(parsed.openingDate);
  });
});

describe("fetchThread", () => {
  it("follows thread pagination and merges all posts", async () => {
    const base =
      "https://www.30daysinger.com/forums/discussion/lesson-qa/Are-there-warm-up-and-exercise-audio-only-files-where-there-is-very-little-talking";
    const client = new FixtureClient({
      [base]: fixture("thread-long-page1.html"),
      [`${base}?page=2`]: fixture("thread-long-page2.html")
    });

    const thread = await fetchThread(client as unknown as ForumClient, base);

    expect(thread.posts).toHaveLength(12);
    expect(thread.posts.map((post) => post.forumPostId)).toEqual([
      11655, 11658, 11686, 11771, 11772, 11799, 11802, 11805, 11806, 11807, 11829, 11842
    ]);
    expect(thread.posts[0]?.createdAt).toBe("2025-07-11T10:47:27.000Z");
    expect(thread.posts.at(-1)?.createdAt).toBeNull();
    expect(thread.posts.at(-2)?.createdAt).toBe("2026-09-03T11:46:26.000Z");
    expect(thread.posts.map((post) => post.position)).toEqual(
      Array.from({ length: 12 }, (_value, index) => index + 1)
    );
  });
});

describe("sanitizeForumHtml", () => {
  it("removes scripts and event handler attributes", () => {
    const cleaned = sanitizeForumHtml(
      '<p onclick="alert(1)">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>'
    );
    expect(cleaned).not.toContain("<script");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).toContain("Hello");
  });

  it("keeps safe links and strips relative images", () => {
    const cleaned = sanitizeForumHtml(
      '<a href="https://example.com">link</a><img src="/relative.png"><img src="https://example.com/p.png">'
    );
    expect(cleaned).toContain('href="https://example.com"');
    expect(cleaned).not.toContain("/relative.png");
    expect(cleaned).toContain('src="https://example.com/p.png"');
  });
});
