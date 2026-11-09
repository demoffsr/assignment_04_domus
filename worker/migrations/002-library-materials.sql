-- The shared study library: subjects → sections → entries (books, designers, links…).
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
