export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, url: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

export class NotFoundError extends HttpError {
  constructor(url: string) {
    super(`404 Not Found: ${url}`, 404, url);
    this.name = "NotFoundError";
  }
}

export class CloudflareChallengeError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(
      `Cloudflare challenge or interstitial page received for ${url}. ` +
        "The crawl was aborted instead of saving an empty response."
    );
    this.name = "CloudflareChallengeError";
    this.url = url;
  }
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message)
};

export interface ForumClientOptions {
  baseUrl: string;
  userAgent: string;
  delayMs: number;
  maxRetries: number;
  timeoutMs?: number;
  logger?: Logger;
}

const CHALLENGE_PATTERN =
  /just a moment|cf-challenge|attention required|enable javascript and cookies|checking your browser/i;

export function looksLikeChallenge(html: string): boolean {
  return CHALLENGE_PATTERN.test(html.slice(0, 20_000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export class ForumClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly delayMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: ForumClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.userAgent = options.userAgent;
    this.delayMs = options.delayMs;
    this.maxRetries = options.maxRetries;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.logger = options.logger ?? consoleLogger;
  }

  absoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.delayMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async requestOnce(url: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new HttpError(
        `Network error for ${url}: ${(error as Error).message}`,
        0,
        url
      );
    }

    if (response.status === 404) {
      throw new NotFoundError(url);
    }

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw new HttpError(
        `HTTP ${response.status} for ${url}`,
        response.status,
        url,
        retryAfterMs
      );
    }

    const html = await response.text();
    if (looksLikeChallenge(html)) {
      throw new CloudflareChallengeError(url);
    }
    return html;
  }

  async get(pathOrUrl: string): Promise<string> {
    const url = this.absoluteUrl(pathOrUrl);

    return this.enqueue(async () => {
      let attempt = 0;
      for (;;) {
        try {
          return await this.requestOnce(url);
        } catch (error) {
          if (error instanceof CloudflareChallengeError) throw error;
          if (error instanceof NotFoundError) throw error;

          const httpError = error instanceof HttpError ? error : null;
          const status = httpError?.status ?? 0;
          const retryable =
            status === 0 || status === 408 || status === 429 || status >= 500;
          if (!retryable || attempt >= this.maxRetries) {
            throw error;
          }

          const backoff = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
          const waitMs = httpError?.retryAfterMs ?? backoff;
          attempt += 1;
          this.logger.warn(
            `Retrying ${url} after ${waitMs}ms (attempt ${attempt}/${this.maxRetries}): ${(error as Error).message}`
          );
          await sleep(waitMs);
        }
      }
    });
  }
}
