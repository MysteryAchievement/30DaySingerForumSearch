# 30 Day Singer Forum Search

A local, full-text searchable archive of the discussions at
<https://www.30daysinger.com/forums>, plus a manual scan for finding new posts.

- Crawls every forum discussion with plain HTTP + cheerio (no browser needed).
- Stores discussions, categories, and posts in PostgreSQL 17.
- Searches titles and post bodies with PostgreSQL full-text search
  (`websearch_to_tsquery`, English stemming, ranking, highlighted snippets).
- Keeps a local copy of edits and deletions, and flags them in the UI.
- Quick scan from the web UI, or a full crawl from the CLI.

## Requirements

- Node.js 20 or newer (developed on Node 22)
- Docker (for PostgreSQL 17)

## First-time setup

1. Start PostgreSQL:

   ```bash
   docker compose up -d
   ```

2. Create your local environment file from the example:

   ```bash
   cp .env.example .env.local
   ```

   `.env.local` is git-ignored. Adjust `DATABASE_URL` if you changed the
   compose credentials.

3. Install dependencies and apply the schema:

   ```bash
   npm install
   npm run db:migrate
   ```

## Run the full crawl

From the repository root:

```bash
# assume 201 index pages, 2003 discussions and 6492 post for this example
npm run crawl:full
```

The crawl reads all 201 index pages, then syncs every discussion and every
thread page. It is deliberately polite: one request at a time with a 1 second
delay by default. A clean run currently takes roughly 35–45 minutes.

Progress is printed to the terminal every 10 discussions. The crawl is safe to
rerun: discussions and posts are upserted, so an interrupted run can simply be
started again (Ctrl-C to stop it).

To use a different delay (for example, a faster local test run):

```bash
CRAWL_DELAY_MS=400 npm run crawl:full
```

Only one scan can run at a time. If another scan holds the advisory lock, the
CLI exits with an error instead of running concurrently.

### Resume an interrupted full crawl

If a full crawl is interrupted (Ctrl-C, the laptop sleeps, the network drops),
continue it with:

```bash
npm run crawl:resume
```

or equivalently:

```bash
npm run crawl:full -- --resume
```

The resume run re-reads the index, then skips every discussion whose
`last_scraped_at` is at or after the interrupted run's start time. Those are the
discussions that were already fetched successfully. It reuses the interrupted
run's row in `scan_runs`, so running `npm run crawl:resume` again after another
interruption continues from the same point.

To deliberately refresh every discussion, run `npm run crawl:full` without
`--resume`.

## Check status

There are four ways to see what is happening.

### 1. Watch the crawl terminal

A running `npm run crawl:full` or `npm run crawl:scan` prints progress every 10
threads:

```text
Full crawl: 2003 discussions found. Syncing threads...
Full crawl progress: 1200/2003
```

### 2. Use the API status endpoints

Start the API if it is not already running (`npm run dev:api` in another
terminal), then:

```bash
curl -s http://127.0.0.1:3001/api/scan/status
curl -s http://127.0.0.1:3001/api/scan/progress
```

`/api/scan/status` returns the latest post, totals, the last scan run, recent
scan history, and the posts first seen in the latest scan.

`/api/scan/progress` returns the in-memory progress of a scan started by the
API. A full crawl started from the CLI reports its live progress only in its own
terminal, while `/api/scan/status` shows the database run row as `running`.

### 3. Use the Scan page

With the web app running, open <http://localhost:5174/scan>. It shows the
latest post, totals, the last scan summary, history, and a progress bar while a
scan started from the page is running.

### 4. Query the database directly

Recent scan runs:

```bash
docker exec 30daysinger-forum-search-db psql -U forum -d forum_search -c "
SELECT id, kind, status, started_at, finished_at, pages_fetched,
       discussions_new, discussions_updated, posts_new, posts_edited,
       posts_deleted, max_forum_post_id, error
  FROM scan_runs
 ORDER BY id DESC
 LIMIT 5;"
```

Live totals and the latest forum post ID:

```bash
docker exec 30daysinger-forum-search-db psql -U forum -d forum_search -c "
SELECT (SELECT count(*) FROM discussions) AS discussions,
       (SELECT count(*) FROM posts) AS posts,
       (SELECT max(forum_post_id) FROM posts) AS latest_forum_post_id,
       (SELECT count(*) FROM discussions WHERE deleted_at IS NOT NULL) AS deleted_discussions;"
```

During a running full crawl, the `scan_runs` counters are written when the run
finishes. The live totals above update continuously.

## Run the web app

Use two terminals from the repository root.

Terminal 1 — API:

```bash
npm run dev:api
```

Terminal 2 — web UI:

```bash
npm run dev:web
```

Open <http://localhost:5174>. The Vite dev server proxies `/api` to the Fastify
API on port 3001, so the API must be running for search, discussions, and scan
requests to work.

To check that the production web bundle builds:

```bash
npm run build:web
```

## Perform a quick check

The quick scan reads the forum index from page 1, re-syncs any discussion that
is new or whose reply count changed, and stops after a full index page with no
changes. It is much faster than a full crawl.

### From the web app

1. Start the API and web app as described above.
2. Open <http://localhost:5174/scan>.
3. Click **Scan for new posts**.
4. The page polls progress and refreshes the latest post, totals, and history
   when the scan finishes.

If another scan is already running, the API returns HTTP 409 and the page shows
"A scan is already running."

### From the CLI

```bash
npm run crawl:scan
```

This is the same quick scan the page button runs. It prints its summary when it
finishes and exits with an error if another scan holds the lock.

## Search and discussion view

The home page searches discussion titles and post bodies.

- **Title + body** (default) — matches the title, a post body, or terms split
  between the title and one post body.
- **Title only** — matches discussion titles.
- **Body only** — matches posts.

Search uses PostgreSQL's `websearch_to_tsquery`:

| Query | Meaning |
| --- | --- |
| `vibrato breath` | both terms must appear |
| `"breath support"` | exact phrase |
| `vibrato or resonance` | either term |
| `scales -beginner` | `scales`, excluding `beginner` |

English stemming is applied, so `sing` also finds `singing`. Results are one
card per discussion, ranked by the best-matching post. The card shows up to
three matching post snippets and links to the discussion view with all matches
highlighted.

The discussion view shows every stored post in order, with author, exact date
(when available), edited/deleted flags, and a link to the original forum thread.

## CLI commands

| Command | Description |
| --- | --- |
| `npm run db:migrate` | Apply pending SQL migrations. |
| `npm run crawl:full` | Walk every index page, sync every discussion, and flag discussions that disappeared from the index (only if the crawl completes cleanly). |
| `npm run crawl:resume` | Resume the most recent interrupted full crawl, skipping discussions already fetched. |
| `npm run crawl:scan` | Run the same quick scan the Scan page button runs. |
| `npm run dev:api` | Start the Fastify API on port 3001. |
| `npm run dev:web` | Start the Vite dev server on port 5174. |

## Configuration

Copy `.env.example` to `.env.local` and adjust as needed:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string (required). |
| `CRAWL_DELAY_MS` | `1000` | Minimum delay between forum requests. |
| `CRAWL_MAX_RETRIES` | `4` | Retries for 429/5xx/network errors, with jittered exponential backoff and `Retry-After` support. |
| `API_PORT` | `3001` | Fastify listen port. |
| `FORUM_USER_AGENT` | descriptive default | Optional User-Agent override. |
| `FORUM_BASE_URL` | `https://www.30daysinger.com` | Optional base URL override. |

## How dates and JSON-LD are handled

The forum exposes exact timestamps through a `DiscussionForumPosting` JSON-LD
block. Verification against real threads showed that its `comment[]` entries do
not line up one-to-one with the HTML posts:

- Comments are not in HTML order.
- One post is moved into the top-level `articleBody` and is not in `comment[]`.
- That omitted post is often, but not always, the newest post.

The parser matches comments to posts by normalized text plus author name. The
opening post's date comes from the top-level `datePublished`. Any post that
cannot be matched confidently keeps a `NULL` date instead of an approximate
one; it is filled in on a later scrape if the JSON-LD starts including it. See
`packages/core/test/fixtures/` for the verified samples and
`packages/core/test/parsers.test.ts` for the matching tests.

Other verified behavior:

- Long threads are paginated (`?page=N`); every page is followed.
- The index is sorted by latest activity; a quick scan can stop after a clean
  page.
- On 2026-11-08 the index label said "2004 results" but only 2003 discussion
  links were rendered (one page had 9 items). The archive contains the 2003
  linked discussions.
- Double-encoded entities are decoded for search text.
- Cloudflare email obfuscation (`[email protected]`) is preserved as-is.
- A Cloudflare challenge page aborts the run instead of saving an empty result.

## Project structure

```text
packages/core   database pool, migrations, parsers, fetcher, crawler, search SQL
apps/api        Fastify API and CLI entry points
apps/web        React + Vite + Mantine UI
```

The database schema is in `packages/core/migrations/001_init.sql`. The Docker
container does not run migrations; use `npm run db:migrate`.

## Development

```bash
npm test           # parser/sanitizer unit tests on saved fixtures
npm run typecheck  # all workspaces
npm run lint
npm run build:web
```

Set `DATABASE_URL` (or `TEST_DATABASE_URL`) when running the tests to include
the database-backed search tests; otherwise those tests are skipped.

## Notes and limitations

- Edits are detected when a discussion is re-synced; the quick scan only
  re-syncs threads whose reply count changed, so an edit with no new reply is
  picked up by the next full crawl.
- Flagged (deleted-on-forum) discussions and posts remain searchable and are
  marked with a badge.
- The crawler is deliberately slow and polite: one request at a time, a
  descriptive User-Agent, and backoff on errors.
