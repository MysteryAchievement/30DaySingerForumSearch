import type {
  DiscussionResponse,
  ScanProgress,
  ScanStatusResponse,
  SearchResponse,
  SearchScope
} from "./types";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = `Request failed with HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the HTTP status message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function searchDiscussions(
  q: string,
  scope: SearchScope,
  page: number,
  pageSize: number,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q,
    scope,
    page: String(page),
    pageSize: String(pageSize)
  });
  return getJson<SearchResponse>(`/api/search?${params.toString()}`, signal);
}

export function fetchDiscussion(
  slug: string,
  q: string | null,
  signal?: AbortSignal
): Promise<DiscussionResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return getJson<DiscussionResponse>(
    `/api/discussions/${encodeURIComponent(slug)}${suffix}`,
    signal
  );
}

export function fetchScanStatus(signal?: AbortSignal): Promise<ScanStatusResponse> {
  return getJson<ScanStatusResponse>("/api/scan/status", signal);
}

export function fetchScanProgress(signal?: AbortSignal): Promise<ScanProgress> {
  return getJson<ScanProgress>("/api/scan/progress", signal);
}

export async function startScan(): Promise<void> {
  const response = await fetch("/api/scan", { method: "POST" });
  if (response.status === 202) return;
  if (response.status === 409) {
    throw new Error("A scan is already running.");
  }
  let message = `Could not start scan (HTTP ${response.status}).`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the HTTP status message
  }
  throw new Error(message);
}
