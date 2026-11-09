import "./env";
import Fastify from "fastify";
import {
  ForumClient,
  InvalidQueryError,
  ScanAlreadyRunningError,
  createPool,
  getDiscussion,
  getScanProgress,
  getScanStatus,
  loadConfig,
  searchDiscussions,
  type SearchScope
} from "@forum/core";
import { startQuickScan } from "./scanService";

const searchQuerySchema = {
  type: "object",
  required: ["q"],
  properties: {
    q: { type: "string", minLength: 1, maxLength: 500 },
    scope: { type: "string", enum: ["both", "title", "body"], default: "both" },
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50, default: 20 }
  }
} as const;

const scanQuerySchema = {
  type: "object",
  properties: {
    q: { type: "string", maxLength: 500 }
  }
} as const;

interface SearchQuery {
  q: string;
  scope?: SearchScope;
  page?: number;
  pageSize?: number;
}

interface DiscussionParams {
  slug: string;
}

interface DiscussionQuery {
  q?: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = new ForumClient({
    baseUrl: config.forumBaseUrl,
    userAgent: config.userAgent,
    delayMs: config.crawlDelayMs,
    maxRetries: config.crawlMaxRetries
  });

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    console.error(
      `Could not connect to PostgreSQL. Is the Docker container running? ${(error as Error).message}`
    );
    process.exitCode = 1;
    await pool.end();
    return;
  }

  const app = Fastify({ logger: true });

  app.get<{ Querystring: SearchQuery }>(
    "/api/search",
    { schema: { querystring: searchQuerySchema } },
    async (request, reply) => {
      try {
        return await searchDiscussions(pool, {
          q: request.query.q,
          scope: request.query.scope ?? "both",
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20
        });
      } catch (error) {
        if (error instanceof InvalidQueryError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  app.get<{ Params: DiscussionParams; Querystring: DiscussionQuery }>(
    "/api/discussions/:slug",
    { schema: { querystring: scanQuerySchema } },
    async (request, reply) => {
      const discussion = await getDiscussion(
        pool,
        request.params.slug,
        request.query.q ?? null
      );
      if (!discussion) {
        return reply.code(404).send({ error: "Discussion not found." });
      }
      return discussion;
    }
  );

  app.get("/api/scan/status", async () => getScanStatus(pool));

  app.get("/api/scan/progress", async () => getScanProgress());

  app.post("/api/scan", async (_request, reply) => {
    try {
      await startQuickScan(pool, client);
      return reply.code(202).send({ started: true });
    } catch (error) {
      if (error instanceof ScanAlreadyRunningError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down.`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.apiPort, host: "127.0.0.1" });
  app.log.info(`API listening on http://127.0.0.1:${config.apiPort}`);
}

void main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
