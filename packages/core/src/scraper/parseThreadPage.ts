import { load } from "cheerio";
import { cleanText, normalizeForMatch } from "../text";
import type { ParsedPost, ParsedThreadPage } from "../types";

interface JsonLdComment {
  text: string;
  author: string | null;
  date: string | null;
  index: number;
}

interface DiscussionJsonLd {
  headline?: string;
  datePublished?: string;
  comment?: unknown;
  articleBody?: string;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function extractDiscussionJsonLd(html: string): DiscussionJsonLd | null {
  const $ = load(html);
  let found: DiscussionJsonLd | null = null;

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const candidates = asArray<Record<string, unknown>>(parsed).flatMap((entry) => {
      if (entry && typeof entry === "object" && Array.isArray(entry["@graph"])) {
        return asArray<Record<string, unknown>>(entry["@graph"]);
      }
      return [entry];
    });
    for (const candidate of candidates) {
      if (candidate && candidate["@type"] === "DiscussionForumPosting") {
        found = candidate as DiscussionJsonLd;
      }
    }
  });

  return found;
}

function extractComments(jsonLd: DiscussionJsonLd | null): JsonLdComment[] {
  if (!jsonLd) return [];
  return asArray<Record<string, unknown>>(jsonLd.comment).map((comment, index) => {
    const authorValue = comment.author as { name?: unknown } | undefined;
    const author =
      authorValue && typeof authorValue.name === "string"
        ? cleanText(authorValue.name)
        : null;
    const text =
      typeof comment.text === "string"
        ? comment.text
        : typeof comment.articleBody === "string"
          ? comment.articleBody
          : "";
    return {
      text,
      author,
      date: validIsoDate(comment.datePublished),
      index
    };
  });
}

function parseCategorySlug(url: string): string | null {
  const match = url.match(/\/forums\/discussion\/([^/]+)\//);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

export function parseThreadPage(
  html: string,
  sourceUrl = "thread",
  options: { isFirstPage?: boolean } = {}
): ParsedThreadPage {
  const isFirstPage = options.isFirstPage !== false;
  const $ = load(html);
  const jsonLd = extractDiscussionJsonLd(html);
  const comments = extractComments(jsonLd);
  const warnings: string[] = [];

  const posts: ParsedPost[] = [];
  $("ul.discussions > li[data-id]").each((index, element) => {
    const node = $(element);
    const idText = node.attr("data-id") ?? "";
    const forumPostId = Number.parseInt(idText, 10);
    if (!Number.isFinite(forumPostId)) return;

    const author = cleanText(node.find(".chatter_middle_details > a").first().text()) || null;
    const bodyNode = node.find(".chatter_body").first();
    const bodyHtml = bodyNode.html() ?? "";
    const bodyText = cleanText(bodyNode.text());

    posts.push({
      forumPostId,
      position: index + 1,
      author,
      bodyHtml,
      bodyText,
      createdAt: null
    });
  });

  if (posts.length === 0) {
    throw new Error(
      `Unexpected thread markup at ${sourceUrl}: no ul.discussions > li[data-id] posts found.`
    );
  }

  const openingDate = validIsoDate(jsonLd?.datePublished);

  const usedComments = new Set<number>();
  for (const post of posts) {
    const postKey = normalizeForMatch(post.bodyText);
    if (!postKey) continue;

    const candidates = comments.filter(
      (comment) => !usedComments.has(comment.index) && normalizeForMatch(comment.text) === postKey
    );
    if (candidates.length === 0) continue;

    const authorKey = post.author ? normalizeForMatch(post.author) : "";
    const authorMatch = candidates.find(
      (comment) => comment.author !== null && normalizeForMatch(comment.author) === authorKey
    );

    if (!authorMatch) {
      warnings.push(
        `Post ${post.forumPostId} matched a JSON-LD comment by text but not by author ` +
          `(HTML author: ${post.author ?? "unknown"}); leaving its date null.`
      );
      continue;
    }

    if (authorMatch.date) {
      post.createdAt = authorMatch.date;
    }
    usedComments.add(authorMatch.index);
  }

  if (isFirstPage && openingDate && posts[0] && !posts[0].createdAt) {
    posts[0].createdAt = openingDate;
  }

  posts.forEach((post, index) => {
    const isLastOnPage = index === posts.length - 1;
    if (!post.createdAt && !isLastOnPage) {
      warnings.push(
        `No exact JSON-LD date matched for post ${post.forumPostId} ` +
          `(author: ${post.author ?? "unknown"}) at ${sourceUrl}.`
      );
    }
  });

  const title =
    cleanText(jsonLd?.headline ?? "") ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text()) ||
    "Untitled discussion";

  const nextPageUrl = $("#pagination a[rel=\"next\"]").first().attr("href") ?? null;

  return {
    title,
    categorySlug: parseCategorySlug(sourceUrl),
    posts,
    openingDate,
    nextPageUrl,
    warnings
  };
}
