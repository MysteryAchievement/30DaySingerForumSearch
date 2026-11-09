import { consoleLogger } from "./client";
import { fetchIndexPage, syncOne, type CrawlContext, type SyncAccumulator } from "./syncRunner";
import {
  emptyCounts,
  findResumableFullRun,
  finishScanRun,
  getRecentlyScrapedSlugs,
  reopenScanRun,
  startScanRun
} from "./scanRuns";
import {
  finishScanProgress,
  resetScanProgress,
  updateScanProgress
} from "./progress";
import type { IndexItem, ScanCounts } from "../types";

export type { CrawlContext } from "./syncRunner";

export interface FullCrawlOptions {
  resume?: boolean;
}

export async function runFullCrawl(
  ctx: CrawlContext,
  options: FullCrawlOptions = {}
): Promise<ScanCounts> {
  const logger = ctx.logger ?? consoleLogger;
  const counts = emptyCounts();
  resetScanProgress("full");

  let runId: number;
  let resumeCutoff: Date | null = null;

  if (options.resume) {
    const resumable = await findResumableFullRun(ctx.pool);
    if (resumable) {
      resumeCutoff = resumable.startedAt;
      runId = resumable.id;
      await reopenScanRun(ctx.pool, resumable.id);
      logger.info(
        `Resuming full crawl run ${resumable.id} from discussions not yet fetched since ` +
          `${resumable.startedAt.toISOString()}.`
      );
    } else {
      logger.info("No interrupted full crawl found; starting a new full crawl.");
      runId = await startScanRun(ctx.pool, "full");
    }
  } else {
    runId = await startScanRun(ctx.pool, "full");
  }

  let fatalError: Error | null = null;

  try {
    logger.info("Full crawl: reading forum index...");
    const firstPage = await fetchIndexPage(ctx.client, 1);
    const lastPage = Math.max(1, firstPage.lastPage);
    counts.pagesFetched = 1;

    const items = new Map<string, IndexItem>();
    for (const item of firstPage.items) items.set(item.slug, item);

    updateScanProgress({
      phase: "index",
      pagesFetched: counts.pagesFetched,
      pagesTotal: lastPage,
      threadsTotal: 0,
      message: `Reading forum index page 1 of ${lastPage}`
    });

    for (let page = 2; page <= lastPage; page += 1) {
      const parsed = await fetchIndexPage(ctx.client, page);
      counts.pagesFetched += 1;
      for (const item of parsed.items) {
        if (!items.has(item.slug)) items.set(item.slug, item);
      }
      updateScanProgress({
        pagesFetched: counts.pagesFetched,
        pagesTotal: lastPage,
        message: `Reading forum index page ${page} of ${lastPage}`
      });
      if (parsed.items.length === 0 && (parsed.total ?? 0) > 0) {
        throw new Error(
          `Forum index page ${page} returned no discussions; aborting instead of flagging data as deleted.`
        );
      }
    }

    const allItems = [...items.values()];
    let skippedCount = 0;
    let pending: IndexItem[] = allItems;

    if (resumeCutoff) {
      const recentlyScraped = await getRecentlyScrapedSlugs(ctx.pool, resumeCutoff);
      pending = allItems.filter((item) => !recentlyScraped.has(item.slug));
      skippedCount = allItems.length - pending.length;
    }

    logger.info(
      `Full crawl: ${allItems.length} discussions found. ` +
        `${pending.length} to sync` +
        (skippedCount > 0 ? `, ${skippedCount} already fetched since the resume point.` : ".")
    );
    updateScanProgress({
      phase: "threads",
      threadsTotal: allItems.length,
      threadsDone: skippedCount,
      message:
        skippedCount > 0
          ? `Syncing ${pending.length} discussions (${skippedCount} already fetched)`
          : `Syncing ${pending.length} discussions`
    });

    const accumulator: SyncAccumulator = { counts };
    const failed: IndexItem[] = [];
    let done = 0;

    for (const item of pending) {
      const ok = await syncOne(ctx, item, accumulator);
      if (!ok) failed.push(item);
      done += 1;
      if (done % 10 === 0 || done === pending.length) {
        const completed = skippedCount + done;
        updateScanProgress({
          ...counts,
          threadsDone: completed,
          threadsTotal: allItems.length,
          message: `Synced ${completed} of ${allItems.length} discussions`
        });
        logger.info(`Full crawl progress: ${completed}/${allItems.length}`);
      }
    }

    if (pending.length === 0) {
      updateScanProgress({
        ...counts,
        threadsDone: allItems.length,
        threadsTotal: allItems.length,
        message: "All discussions already fetched; checking for deletions"
      });
    }

    if (failed.length > 0) {
      logger.warn(`Full crawl: retrying ${failed.length} failed threads...`);
      const stillFailing: IndexItem[] = [];
      for (const item of failed) {
        const ok = await syncOne(ctx, item, accumulator);
        if (!ok) stillFailing.push(item);
      }
      if (stillFailing.length > 0) {
        throw new Error(
          `Full crawl did not finish cleanly: ${stillFailing.length} threads failed after retry. ` +
            "Discussions that were not seen were not flagged as deleted."
        );
      }
    }

    if (items.size > 0) {
      const seenSlugs = [...items.keys()];
      const flagged = await ctx.pool.query(
        `UPDATE discussions
            SET deleted_at = now()
          WHERE deleted_at IS NULL
            AND NOT (slug = ANY($1::text[]))`,
        [seenSlugs]
      );
      counts.discussionsFlaggedDeleted += flagged.rowCount ?? 0;
      if ((flagged.rowCount ?? 0) > 0) {
        logger.info(
          `Full crawl: flagged ${flagged.rowCount} discussions not present in the forum index.`
        );
      }
    }

    updateScanProgress({ ...counts, message: "Full crawl complete" });
    logger.info(
      `Full crawl complete: ${counts.discussionsNew} new, ${counts.discussionsUpdated} updated, ` +
        `${counts.postsNew} new posts, ${counts.postsEdited} edited, ${counts.postsDeleted} deleted.`
    );
  } catch (error) {
    fatalError = error as Error;
    logger.error(`Full crawl failed: ${fatalError.message}`);
  } finally {
    await finishScanRun(
      ctx.pool,
      runId,
      fatalError ? "failed" : "succeeded",
      counts,
      fatalError ? fatalError.message : null
    );
    finishScanProgress(fatalError ? "failed" : "finished", {
      ...counts,
      error: fatalError ? fatalError.message : null
    });
  }

  if (fatalError) throw fatalError;
  return counts;
}
