import type { ForumClient } from "./client";
import { parseThreadPage } from "./parseThreadPage";
import type { FetchedThread, ParsedPost } from "../types";

const MAX_THREAD_PAGES = 200;

export async function fetchThread(client: ForumClient, url: string): Promise<FetchedThread> {
  const postsById = new Map<number, ParsedPost>();
  const warnings: string[] = [];
  const visited = new Set<string>();

  let pageUrl: string | null = url;
  let title = "";
  let categorySlug: string | null = null;
  let openingDate: string | null = null;
  let firstPage = true;
  let pagesFetched = 0;

  while (pageUrl) {
    const absolute = client.absoluteUrl(pageUrl);
    if (visited.has(absolute)) {
      throw new Error(`Thread pagination loop detected at ${absolute}`);
    }
    visited.add(absolute);
    pagesFetched += 1;
    if (pagesFetched > MAX_THREAD_PAGES) {
      throw new Error(`Thread has more than ${MAX_THREAD_PAGES} pages: ${url}`);
    }

    const html = await client.get(absolute);
    const parsed = parseThreadPage(html, absolute, { isFirstPage: firstPage });

    if (firstPage) {
      title = parsed.title;
      categorySlug = parsed.categorySlug;
      openingDate = parsed.openingDate;
      firstPage = false;
    }

    warnings.push(...parsed.warnings);
    for (const post of parsed.posts) {
      if (!postsById.has(post.forumPostId)) {
        postsById.set(post.forumPostId, post);
      }
    }

    pageUrl = parsed.nextPageUrl;
  }

  const posts = [...postsById.values()];
  posts.forEach((post, index) => {
    post.position = index + 1;
  });

  if (openingDate && posts[0]) {
    posts[0].createdAt = openingDate;
  }

  return {
    title,
    categorySlug,
    posts,
    url,
    warnings
  };
}
