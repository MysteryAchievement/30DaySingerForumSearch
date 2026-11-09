export const FORUM_BASE_URL = "https://www.30daysinger.com";
export const DEFAULT_USER_AGENT =
  "30DaySingerForumSearch/0.1 (local personal archive; +https://www.30daysinger.com/forums)";

export interface AppConfig {
  databaseUrl: string;
  crawlDelayMs: number;
  crawlMaxRetries: number;
  apiPort: number;
  userAgent: string;
  forumBaseUrl: string;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min} (received "${value}")`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env.local and adjust it if needed."
    );
  }

  return {
    databaseUrl,
    crawlDelayMs: parseInteger(env.CRAWL_DELAY_MS, 1000, "CRAWL_DELAY_MS", 0),
    crawlMaxRetries: parseInteger(env.CRAWL_MAX_RETRIES, 4, "CRAWL_MAX_RETRIES", 0),
    apiPort: parseInteger(env.API_PORT, 3001, "API_PORT", 1),
    userAgent: env.FORUM_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    forumBaseUrl: env.FORUM_BASE_URL?.trim() || FORUM_BASE_URL
  };
}
