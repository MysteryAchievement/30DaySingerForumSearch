CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE discussions (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  last_post_at TIMESTAMPTZ,
  post_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  title_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  forum_post_id INTEGER NOT NULL UNIQUE,
  discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  author TEXT,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  body_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(body_text, ''))) STORED
);

CREATE TABLE scan_runs (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('full', 'quick')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  discussions_new INTEGER NOT NULL DEFAULT 0,
  discussions_updated INTEGER NOT NULL DEFAULT 0,
  posts_new INTEGER NOT NULL DEFAULT 0,
  posts_edited INTEGER NOT NULL DEFAULT 0,
  posts_deleted INTEGER NOT NULL DEFAULT 0,
  max_forum_post_id INTEGER,
  error TEXT
);

CREATE INDEX discussions_title_tsv_idx ON discussions USING GIN (title_tsv);
CREATE INDEX discussions_deleted_at_idx ON discussions (deleted_at);
CREATE INDEX discussions_last_post_at_idx ON discussions (last_post_at DESC);
CREATE INDEX posts_body_tsv_idx ON posts USING GIN (body_tsv);
CREATE INDEX posts_discussion_id_idx ON posts (discussion_id);
CREATE INDEX posts_created_at_idx ON posts (created_at);
CREATE INDEX posts_deleted_at_idx ON posts (deleted_at);
CREATE INDEX posts_first_seen_at_idx ON posts (first_seen_at DESC);
CREATE INDEX scan_runs_started_at_idx ON scan_runs (started_at DESC);
