import { load } from "cheerio";
import { cleanText } from "../text";
import type { IndexItem, ParsedIndexPage } from "../types";

function parsePath(href: string): { categorySlug: string; slug: string } | null {
  const match = href.match(/\/forums\/discussion\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  const categorySlug = decodeURIComponent(match[1] ?? "");
  const slug = decodeURIComponent(match[2] ?? "");
  if (!categorySlug || !slug) return null;
  return { categorySlug, slug };
}

export function parseIndexPage(html: string, sourceUrl = "forum index"): ParsedIndexPage {
  const $ = load(html);
  const items: IndexItem[] = [];

  $("a.discussion_list").each((_index, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    if (!href) return;

    const parsedPath = parsePath(href);
    if (!parsedPath) return;

    const titleNode = anchor.find(".chatter_middle_title").first().clone();
    const categoryName = cleanText(titleNode.find(".chatter_cat").first().text());
    titleNode.find(".chatter_cat").remove();
    const title = cleanText(titleNode.text());

    const countText = cleanText(anchor.find(".chatter_count").first().text());
    const replyCount = Number.parseInt(countText.replace(/[^\d]/g, ""), 10);

    items.push({
      url: href.startsWith("http") ? href : `https://www.30daysinger.com${href}`,
      slug: parsedPath.slug,
      categorySlug: parsedPath.categorySlug,
      title: title || parsedPath.slug,
      replyCount: Number.isFinite(replyCount) ? replyCount : 0,
      ...(categoryName ? { categoryName } : {})
    });
  });

  const paginationText = cleanText($("#pagination").text());
  const totalMatch = paginationText.match(/of\s+([\d,]+)\s+results/i);
  const total = totalMatch ? Number.parseInt((totalMatch[1] ?? "").replace(/,/g, ""), 10) : null;

  let lastPage = 1;
  $("#pagination a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const pageMatch = href.match(/[?&]page=(\d+)/);
    if (pageMatch) {
      const page = Number.parseInt(pageMatch[1] ?? "", 10);
      if (Number.isFinite(page)) lastPage = Math.max(lastPage, page);
    }
  });

  if (total !== null && total > 0) {
    lastPage = Math.max(lastPage, Math.ceil(total / 10));
  }

  const hasIndexMarkup = $("a.discussion_list").length > 0 || total !== null;
  if (!hasIndexMarkup) {
    throw new Error(
      `Unexpected forum index markup at ${sourceUrl}: no discussion list and no result count found.`
    );
  }

  return { items, total, lastPage, currentPage: null };
}
