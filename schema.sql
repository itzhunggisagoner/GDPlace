-- GD Place · schema D1
-- Safe to re-run and does NOT touch old data (users / sessions / tiles / history from the 64x64 version).

CREATE TABLE IF NOT EXISTS users (
  account_id  INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  username    TEXT    NOT NULL,
  last_action INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,             -- sha256(token)
  account_id  INTEGER NOT NULL REFERENCES users(account_id),
  expires_at  INTEGER NOT NULL
);

-- per-account play data
CREATE TABLE IF NOT EXISTS profiles (
  account_id    INTEGER PRIMARY KEY,
  last_placed   INTEGER NOT NULL DEFAULT 0,   -- ms epoch
  last_deleted  INTEGER NOT NULL DEFAULT 0,   -- ms epoch
  banned        INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,   -- admin added via the DB (besides ADMIN_USERS in wrangler.jsonc)
  place_timer   INTEGER,                      -- NULL = use the global timer
  delete_timer  INTEGER,
  display_color TEXT                          -- "rrggbb" or "rrggbb rrggbb ..." (gradient)
);

-- objects currently in the level (one row = one GD object)
CREATE TABLE IF NOT EXISTS objects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk      TEXT    NOT NULL,                -- "i,j"
  data       TEXT    NOT NULL,                -- "id;x;y;rot;flip;scale;z;mainColor;..."
  account_id INTEGER NOT NULL,
  username   TEXT    NOT NULL,
  placed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objects_chunk ON objects(chunk);

-- change log so clients can sync (replaces Firebase realtime)
CREATE TABLE IF NOT EXISTS changes (
  seq   INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk TEXT    NOT NULL,
  key   TEXT    NOT NULL,
  kind  TEXT    NOT NULL,                     -- 'add' | 'del'
  data  TEXT,
  by    TEXT,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_at ON changes(at);

-- full history (place / delete)
CREATE TABLE IF NOT EXISTS obj_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,                -- 'place' | 'delete'
  key        TEXT    NOT NULL,
  chunk      TEXT    NOT NULL,
  data       TEXT,
  account_id INTEGER NOT NULL,
  username   TEXT    NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obj_history_kind ON obj_history(kind);

-- global settings (admins can edit them in-game)
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
