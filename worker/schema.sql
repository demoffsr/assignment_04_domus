CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,      -- private, lowercase, never shown on the site
  display_name TEXT NOT NULL,         -- public
  slug TEXT NOT NULL UNIQUE,          -- public, used in personal-library URLs
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,        -- SHA-256 of the bearer token
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '',
  pdf_key TEXT,
  credit TEXT,                        -- optional credit line, e.g. co-authors; NULL = the owner's name
  manifest TEXT NOT NULL DEFAULT '{"pages":[]}',  -- JSON: the pages array the site renders
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT,                  -- NULL while it is only a draft
  deleted_at TEXT                     -- soft delete, files stay in R2
);
CREATE INDEX IF NOT EXISTS books_owner ON books(owner_id);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  book_id TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Study library (also in migrations/002-library-materials.sql)
CREATE TABLE IF NOT EXISTS lib_subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS lib_sections (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES lib_subjects(id),
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS lib_sections_subject ON lib_sections(subject_id);

CREATE TABLE IF NOT EXISTS lib_items (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES lib_sections(id),
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',        -- year, publisher, who it is…
  url TEXT,                             -- optional link (http/https)
  planned INTEGER NOT NULL DEFAULT 0,   -- 1 = on the reading plan
  owner_id TEXT NOT NULL REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS lib_items_section ON lib_items(section_id);
