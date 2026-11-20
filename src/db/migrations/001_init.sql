CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES ('hub_id', 'h_' || lower(hex(randomblob(8))));

-- One Agent session per (kind, session key); agent-identity spec.
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,
  session_key    TEXT NOT NULL,
  label          TEXT,
  cwd            TEXT,
  git            TEXT,  -- JSON
  host           TEXT,
  client_version TEXT,
  detection      TEXT,  -- JSON
  signals        TEXT,  -- JSON, stored raw
  created_at     TEXT NOT NULL,
  last_seen      TEXT NOT NULL,
  UNIQUE (kind, session_key)
);

CREATE TABLE rounds (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions (id),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'dismissed', 'redirected', 'expired', 'cancelled')),
  round        TEXT NOT NULL,  -- submitted document, JSON
  answer       TEXT,           -- Answer document once ended, JSON
  received_at  TEXT NOT NULL,
  decided_at   TEXT,
  delivered_at TEXT
);

CREATE INDEX rounds_by_status ON rounds (status, received_at);
CREATE INDEX rounds_by_session ON rounds (session_id, status);
