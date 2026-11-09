import {
  CloudflareChallengeError,
  NotFoundError,
  consoleLogger,
  type ForumClient,
  type Logger
} from "./client";
import { parseIndexPage } from "./parseIndexPage";
import { syncThread, flagDiscussionDeleted } from "./syncThread";
import { mergeMaxPostId } from "./scanRuns";
import type { IndexItem, ParsedIndexPage, ScanCounts } from "../types";

export interface CrawlContext {
  pool: import("pg").Pool;
  client: ForumClient;
  logger?: Logger;
}

export interface SyncAccumulator {
  counts: ScanCounts;
}

export async function fetchIndexPage(
  client: ForumClient,
  page: number
): Promise<ParsedIndexPage> {
  const url = client.absoluteUrl(`/forums?page=${page}`);
  const html = await client.get(url);
  return parseIndexPage(html, url);
}

export async function syncOne(
  ctx: CrawlContext,
  item: IndexItem,
  accum: SyncAccumulator
): Promise<boolean> {
  const logger = ctx.logger ?? consoleLogger;
  try {
    const result = await syncThread(ctx.pool, ctx.client, item);
    if (result.createdDiscussion) accum.counts.discussionsNew += 1;
    else if (result.updatedDiscussion) accum.counts.discussionsUpdated += 1;
    accum.counts.postsNew += result.postsNew;
    accum.counts.postsEdited += result.postsEdited;
    accum.counts.postsDeleted += result.postsDeleted;
    accum.counts.maxForumPostId = mergeMaxPostId(
      accum.counts.maxForumPostId,
      result.maxForumPostId
    );
    for (const warning of result.warnings) {
      logger.warn(`[${item.slug}] ${warning}`);
    }
    return true;
  } catch (error) {
    if (error instanceof CloudflareChallengeError) throw error;
    if (error instanceof NotFoundError) {
      const flagged = await flagDiscussionDeleted(ctx.pool, item.slug);
      if (flagged) accum.counts.discussionsFlaggedDeleted += 1;
      logger.warn(`Thread not found, flagged discussion as deleted: ${item.url}`);
      return true;
    }
    logger.error(`Failed to sync ${item.url}: ${(error as Error).message}`);
    return false;
  }
}
