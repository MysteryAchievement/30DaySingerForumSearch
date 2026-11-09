# 30 Day Singer Forum Search — Plan

Status: **Ready for implementation.** All design decisions were approved by the user.
Repo: this repository (the repo was initially empty except for an outdated `PLAN.md`, which this file replaces).

## Goal

A local app that crawls every discussion on https://www.30daysinger.com/forums, stores each post in PostgreSQL, lets you search for terms in discussion titles and post bodies, and tracks the latest post. A Scan page lets you check for new posts manually. A full crawl can be resumed after an interruption without re-fetching discussions that were already synced.

## Forum findings (analysis on 2026-11-08)

- Built on Laravel + `devdojo/chatter`. Pages are rendered on the server, so cheerio and plain HTTP are enough (no headless browser).
- Reading needs no login. `robots.txt`: `User-agent: * / Disallow:` (crawling is allowed). The site is behind Cloudflare.
- Index: `/forums?page=N`, 10 per page. There were 2,004 discussions over 201 pages; read the total from the "of N results" text.
- Each index item: `a.discussion_list[href]`, `.chatter_middle_title` (title + `.chatter_cat`), `.chatter_count` (reply count).
- 8 categories, listed in the sidebar `ul.nav-stacked a[href^="/forums/category/"]`.
- Thread URL: `/forums/discussion/{category-slug}/{discussion-slug}`. There is **no public discussion ID**, so use the slug as the key.
- Posts: `ul.discussions > li[data-id]` (numeric post ID), author `.chatter_middle_details > a`, body `.chatter_body`.
- Exact dates come from the JSON-LD `<script type="application/ld+json">` (`@type: DiscussionForumPosting`). Each `comment[]` entry has `datePublished`, `author.name` and `text`.
- The index is sorted by latest activity (confirmed in Task 1).

### Verify first (Task 1). Each item changes the parser if it turns out wrong

1. The `comment[]` count and order are not guaranteed to match the HTML `li[data-id]` entries. Match by normalized text plus author; if there is no confident match, log a warning and leave the date null rather than guessing. (Verified: order differs and one post is omitted.)
2. The opening post's date comes from the top-level `datePublished`. `articleBody` holds a post that is omitted from `comment[]` (often, but not always, the newest), so do not use it for position. (Verified.)
3. Whether long threads are split across pages (`#pagination` on thread pages). If they are, follow every page.
4. Whether the index is sorted by latest activity. If not, the quick scan must walk every index page.
5. Some bodies contain double-encoded entities (`&amp;nbsp;`). Cloudflare replaces email addresses with `[email protected]`; keep that as is.

Save the HTML of the threads you verify as test fixtures.

### Verification outcome (2026-11-09)

- `comment[]` is not position-aligned with the HTML posts and is not always complete. One post is moved into the top-level `articleBody` and omitted from `comment[]` (often, but not always, the newest). The parser matches comments to posts by normalized text plus author; unmatched posts keep `createdAt = NULL` instead of an approximate date. The opening post uses the top-level `datePublished`.
- Long threads are paginated; `#pagination a[rel="next"]` works and every page is followed.
- The index is sorted by latest activity; the quick scan can stop after a clean page. Confirmed.
- `post_count = reply_count + 1` is correct; the quick scan uses it to detect changed threads.
- The index label said "2004 results" but only 2003 discussion links were rendered (page 11 had 9 items). The archive contains the 2003 visible discussions.
- Some bodies contain double-encoded entities; `body_text` decodes twice and normalizes NBSP/whitespace. Cloudflare email obfuscation is preserved.
- Exact dates are unavailable for the post omitted from each thread's JSON-LD (roughly 30% of posts); they stay `NULL` by design and are filled in later if the JSON-LD starts including them.
- Cloudflare challenge detection aborts the run; 429/5xx/network errors use jittered backoff and `Retry-After`.
- Verified with fixtures saved in `packages/core/test/fixtures/`: short thread, single-post thread, mismatched JSON-LD order, entities/obfuscated email, and multi-page thread.

## Decisions

| Area | Decision |
|---|---|
| Database | PostgreSQL 17 in Docker. The user creates the container from the provided `docker-compose.yml`. |
| Backend | Node.js + TypeScript, Fastify API |
| Frontend | React + Vite + **Mantine** (`Highlight`, `SegmentedControl`, `Pagination`, `Progress`, `Badge`) |
| Repo layout | npm workspaces: `packages/core` (db, migrations, parsers, scraper), `apps/api` (Fastify + CLI), `apps/web` (Vite; dev server proxies `/api`) |
| Timestamps | Exact `datePublished` from JSON-LD, stored as `TIMESTAMPTZ` |
| Search syntax | `websearch_to_tsquery('english', q)`: all terms required, `"phrases"`, `or`, `-exclude`; English stemming; `ts_rank` ranking; `ts_headline` snippets |
| Search scope | Selector: **Title + body** (default; matches `title_tsv \|\| body_tsv`, so terms may be split between title and post) / Title only / Body only |
| Results | One result per discussion, ranked by its best-matching post. The card shows title, category, up to 3 matching post snippets (author, date), and "N more matching posts", which links to the discussion view with matches highlighted. Paginated by discussion. |
| Scans | The Scan page button calls `POST /api/scan`, which runs a quick scan as a background job; the UI polls progress. Full crawl is CLI only: `npm run crawl:full`. Both use the same core scraper. |
| Concurrency | One scan at a time across the CLI and the API, using `pg_try_advisory_lock`. If a scan is already running, the API returns 409 and the CLI exits with an error. |
| Resume | `npm run crawl:resume` (equivalently `npm run crawl:full -- --resume` or `CRAWL_RESUME=1`) continues the latest interrupted or failed full crawl. It re-reads the index, then skips discussions whose `last_scraped_at` is at or after the interrupted run's `started_at`. The interrupted `scan_runs` row is reopened (counters reset, original `started_at` kept), so repeated resumes continue from the same cutoff. No schema change. If no interrupted/failed full run exists, it starts a normal full crawl. |
| Edits/deletions | Keep and flag. Changed bodies are updated (`edited_at`). Posts missing from a re-fetched thread get `deleted_at` (cleared if they reappear). A thread returning 404 flags its discussion. A full crawl flags discussions it didn't see **only if the crawl completed successfully**. Flagged items stay searchable with a "Deleted on forum" badge. |
| Crawl rate | One request at a time. `CRAWL_DELAY_MS=1000` by default. Exponential backoff with jitter on 429/5xx/network errors, honoring `Retry-After`. Configurable retry cap. Descriptive User-Agent. |
| Body storage | Store both `body_html` (the original markup) and `body_text` (for search). `body_html` is cleaned with sanitize-html on the server before it's served, then displayed in the discussion view. |

## Data model (`packages/core/migrations/001_init.sql`)

- `categories(id, slug UNIQUE, name)`
- `discussions(id, slug UNIQUE, category_id FK, title, url, created_at, last_post_at, post_count, first_seen_at, last_scraped_at, deleted_at NULL, title_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title)) STORED)`
- `posts(id, forum_post_id INT UNIQUE, discussion_id FK ON DELETE CASCADE, position, author, body_html, body_text, created_at, first_seen_at, edited_at NULL, deleted_at NULL, body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', body_text)) STORED)`
- `scan_runs(id, kind 'full'|'quick', started_at, finished_at, status 'running'|'succeeded'|'failed', pages_fetched, discussions_new, discussions_updated, posts_new, posts_edited, posts_deleted, max_forum_post_id, error)`
- Indexes: GIN on `title_tsv` and `body_tsv`; B-tree on `posts(discussion_id)` and `posts(created_at)`.
- "Latest post" = the post with the highest `forum_post_id` (and its `created_at`), shown on the Scan page with a link.
- Resume needs no extra columns: `scan_runs.started_at` is the cutoff and `discussions.last_scraped_at` marks successfully fetched discussions. The interrupted run row is reopened rather than creating a new one, so repeated resumes keep the original cutoff.
- Use a simple migration runner in core that applies the SQL files in order and tracks them in `schema_migrations`. The Docker container doesn't apply migrations itself.

## Crawl logic (`packages/core`)

- `parseIndexPage(html)` returns `{ items: [{url, slug, categorySlug, title, replyCount}], total, lastPage }`
- `parseThreadPage(html)` returns `{ title, categorySlug, posts: [{forumPostId, position, author, bodyHtml, bodyText, createdAt}], nextPageUrl? }`, merging the HTML with the JSON-LD.
- `syncThread()` runs in one transaction per thread: upsert the discussion and its posts, apply edit/delete flags, and update `post_count`/`last_post_at`.
- **Full crawl**: walk every index page, then sync every thread. A failed thread is logged and retried at the end without aborting the run. Flag missing discussions only after a successful finish.
- **Full crawl resume**: `runFullCrawl(ctx, { resume: true })` calls `findResumableFullRun()` (latest `full` run with status `running` or `failed`), reopens it with `reopenScanRun()`, and uses its `started_at` as the cutoff. After re-reading the index, `getRecentlyScrapedSlugs()` returns discussions with `last_scraped_at >= cutoff`; those are skipped. Progress starts at the skipped count, and the run still flags missing discussions based on the full index. If there is no resumable run, it logs that and starts a normal full crawl.
- **Quick scan**: walk index pages from page 1. Re-sync a thread if it's new, or if its reply count differs from what's stored (`post_count - 1`, confirmed). Stop after one full page with no changes (the index is sorted by activity).
- Progress (phase, pages, threads done/total, counts) is kept in memory and exposed through the API.

## API (`apps/api`, Fastify with JSON-schema validation)

- `GET /api/search?q&scope=both|title|body&page&pageSize` returns `{ total, page, results: [{discussion, rank, matches: [{postId, author, createdAt, snippet}], moreCount}] }`. An empty or invalid `q` returns 400.
- `GET /api/discussions/:slug` returns the discussion plus all posts (sanitized HTML), with matching posts marked when `q` is given.
- `GET /api/scan/status` returns the latest post, the last scan run, totals, and recent scan history.
- `POST /api/scan` returns 202 when it starts a quick scan, or 409 if a scan is already running.
- `GET /api/scan/progress` returns the in-memory progress.
- CLI: `npm run crawl:full`, `npm run crawl:resume`, `npm run crawl:scan`, `npm run db:migrate`.
- Config: `DATABASE_URL`, `CRAWL_DELAY_MS`, `CRAWL_MAX_RETRIES`, `API_PORT`. Commit `.env.example`; the user creates `.env.local`. **Agents must not read `.env` / `.env.local` / `.env.production`** (user rule).

## UI (`apps/web`)

- **Search** (home): query input (debounced, Enter submits), scope control, result cards with highlighted snippets, `Badge`s for category and deleted items, link to the original forum URL, pagination, and empty, loading and error states.
- **Discussion view**: all posts with author and date, sanitized HTML, matched terms highlighted, and a link to the original.
- **Scan**: latest post (ID, date, title, link), totals, last scan summary, a "Scan for new posts" button (disabled while running), `Progress` that updates by polling, a scan history table, and a list of the posts found in the latest scan.

## Task order

1. Set up the workspace skeleton (npm workspaces, TypeScript, lint) and `docker-compose.yml` (postgres:17, named volume, port 5432).
2. Verify the 5 items above against real threads; save fixtures.
3. Core: migrations and runner, db pool, rate-limited fetcher with backoff, parsers (with fixture tests), `syncThread`.
4. Full-crawl CLI. Run it and validate the counts.
5. Quick scan, advisory lock, and `scan_runs` bookkeeping.
6. Fastify API and search SQL.
7. Web UI: Search, then Discussion view, then Scan page.
8. README: setup (Docker, `.env.local`, migrate, full crawl, dev servers), plus focused sections for running the full crawl, checking status (terminal, API, Scan page, SQL), running the web app, and performing a quick scan.
9. Resume support (added after the initial implementation at the user's request): CLI flag/script, resumable-run lookup, run reopening, `last_scraped_at` cutoff, skipped-thread progress, README docs, and database-backed tests.

## Validation

- Parser unit tests on fixtures (short thread, long/multi-page thread, entities and obfuscated emails, mismatched JSON-LD case). All 10 pass.
- After the full crawl: the DB discussion count equals the number of rendered index links, not the "of N results" label. Completed run: 201 pages, 2,003 discussions, 6,492 posts, 0 flagged deletions, latest forum post ID 11865. The label said 2,004 because one index page renders 9 items.
- Search tests: a term only in a title, only in a body, split between title and body (matches only in "both" scope), a phrase, `-exclude`, and stemming (`sing` finds `singing`). All 6 database-backed tests pass.
- A quick scan right after the full crawl finds 0 changes (verified: 1 page, all counters zero). After a simulated new forum post (delete one local post, then quick scan), the scan finds it: 1 discussion updated, 1 post inserted, and the latest post is restored (max forum post ID 11865).
- Resume: database tests cover finding the latest failed/running full run, the `last_scraped_at` cutoff, and reopening the run. An end-to-end simulated resume (fake interrupted run plus a cutoff) logged "438 already fetched since the resume point" and synced only the remaining 1,565 discussions, with progress starting at 438/2,003.
- Starting two scans at once (UI + CLI) gives a 409 or CLI error (verified).
- A simulated failed full crawl (invalid `FORUM_BASE_URL`) flags nothing as deleted (verified: 0 flagged discussions).
- Sanitizer test: `<script>` and `on*` attributes are removed from `body_html`.
- `npm run lint`, `npm run typecheck`, and `npm run build:web` all pass.

## Risks

- Markup or JSON-LD changes: parsers are isolated and covered by fixture tests, and they fail loudly with the URL.
- Cloudflare challenge or rate limiting: one request at a time with backoff. If challenge pages (HTML without `ul.discussions`) are detected, abort the run with a clear error instead of saving empty threads.
- Index order assumption is wrong: walk every index page during quick scans.
