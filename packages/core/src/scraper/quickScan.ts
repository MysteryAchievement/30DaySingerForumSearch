import { consoleLogger } from "./client";
import { fetchIndexPage, syncOne, type CrawlContext, type SyncAccumulator } from "./syncRunner";
import { emptyCounts, finishScanRun, startScanRun } from "./scanRuns";
import {
  finishScanProgress,
  resetScanProgress,
  updateScanProgress
} from "./progress";
import type { IndexItem, ScanCounts } from "../types";

function hasCountChanges(before: ScanCounts, after: ScanCounts): boolean {
  return (
    before.discussionsNew !== after.discussionsNew ||
    before.discussionsUpdated !== after.discussionsUpdated ||
    before.postsNew !== after.postsNew ||
    before.postsEdited !== after.postsEdited ||
    before.postsDeleted !== after.postsDeleted ||
    before.discussionsFlaggedDeleted !== after.discussionsFlaggedDeleted
  );
}

export async function runQuickScan(ctx: CrawlContext): Promise<ScanCounts> {
  const logger = ctx.logger ?? consoleLogger;
  const counts = emptyCounts();
  resetScanProgress("quick");
  const runId = await startScanRun(ctx.pool, "quick");

  let fatalError: Error | null = null;

  try {
    const firstPage = await fetchIndexPage(ctx.client, 1);
    counts.pagesFetched = 1;
    const lastPage = Math.max(1, firstPage.lastPage);
    const totalDiscussions = firstPage.total ?? lastPage * 10;

    if (firstPage.items.length === 0) {
      throw new Error(
        "Forum index page 1 returned no discussions; refusing to treat this as an empty forum."
      );
    }

    updateScanProgress({
      phase: "index",
      pagesFetched: counts.pagesFetched,
      pagesTotal: lastPage,
      threadsTotal: totalDiscussions,
      threadsDone: 0,
      message: `Checking forum index page 1 of ${lastPage}`
    });

    const accumulator: SyncAccumulator = { counts };
    const failed: IndexItem[] = [];
    let page = 1;
    let scanned = 0;

    for (;;) {
      const parsed = page === 1 ? firstPage : await fetchIndexPage(ctx.client, page);
      if (page > 1) counts.pagesFetched += 1;

      let pageChanged = false;
      updateScanProgress({
        phase: "threads",
        pagesFetched: counts.pagesFetched,
        pagesTotal: lastPage,
        message: `Checking ${parsed.items.length} discussions on page ${page} of ${lastPage}`
      });

      for (const item of parsed.items) {
        const existing = await ctx.pool.query<{
          post_count: number;
          deleted_at: Date | null;
        }>("SELECT post_count, deleted_at FROM discussions WHERE slug = $1", [item.slug]);
        const row = existing.rows[0];

        const needsSync =
          !row || row.deleted_at !== null || row.post_count !== item.replyCount + 1;

        if (needsSync) {
          const before = { ...counts };
          const ok = await syncOne(ctx, item, accumulator);
          if (!ok) {
            failed.push(item);
            pageChanged = true;
          } else if (hasCountChanges(before, counts)) {
            pageChanged = true;
          }
        }

        scanned += 1;
        if (scanned % 5 === 0) {
          updateScanProgress({
            ...counts,
            threadsDone: scanned,
            threadsTotal: Math.max(totalDiscussions, scanned),
            pagesFetched: counts.pagesFetched,
            pagesTotal: lastPage,
            message: `Checked ${scanned} discussions (page ${page} of ${lastPage})`
          });
        }
      }

      updateScanProgress({
        ...counts,
        threadsDone: scanned,
        threadsTotal: Math.max(totalDiscussions, scanned),
        pagesFetched: counts.pagesFetched,
        pagesTotal: lastPage
      });

      if (!pageChanged) {
        logger.info(`Quick scan: no changes on index page ${page}; stopping.`);
        break;
      }

      if (page >= lastPage) {
        logger.info("Quick scan: reached the last index page.");
        break;
      }

      page += 1;
    }

    if (failed.length > 0) {
      logger.warn(`Quick scan: retrying ${failed.length} failed threads...`);
      const stillFailing: IndexItem[] = [];
      for (const item of failed) {
        const ok = await syncOne(ctx, item, accumulator);
        if (!ok) stillFailing.push(item);
      }
      if (stillFailing.length > 0) {
        throw new Error(
          `Quick scan did not finish cleanly: ${stillFailing.length} threads failed after retry.`
        );
      }
    }

    logger.info(
      `Quick scan complete: ${counts.discussionsNew} new, ${counts.discussionsUpdated} updated, ` +
        `${counts.postsNew} new posts, ${counts.postsEdited} edited, ${counts.postsDeleted} deleted.`
    );
    updateScanProgress({ ...counts, message: "Scan complete" });
  } catch (error) {
    fatalError = error as Error;
    logger.error(`Quick scan failed: ${fatalError.message}`);
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
