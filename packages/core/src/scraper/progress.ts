import type { ScanProgress } from "../types";

const emptyProgress = (): ScanProgress => ({
  running: false,
  kind: null,
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  pagesFetched: 0,
  pagesTotal: null,
  threadsTotal: 0,
  threadsDone: 0,
  discussionsNew: 0,
  discussionsUpdated: 0,
  postsNew: 0,
  postsEdited: 0,
  postsDeleted: 0,
  discussionsFlaggedDeleted: 0,
  maxForumPostId: null,
  message: null,
  error: null
});

let current = emptyProgress();

export function getScanProgress(): ScanProgress {
  return { ...current };
}

export function resetScanProgress(kind: "full" | "quick"): void {
  current = {
    ...emptyProgress(),
    running: true,
    kind,
    phase: "index",
    startedAt: new Date().toISOString()
  };
}

export function updateScanProgress(patch: Partial<ScanProgress>): void {
  current = { ...current, ...patch };
}

export function finishScanProgress(
  status: "finished" | "failed",
  patch: Partial<ScanProgress> = {}
): void {
  current = {
    ...current,
    ...patch,
    running: false,
    phase: status,
    finishedAt: new Date().toISOString()
  };
}
