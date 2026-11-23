-- Advisors and auto-ask (delegation spec): one-off runs that suggest an Answer; the Human always sends.

CREATE TABLE advisor_runs (
  id           TEXT PRIMARY KEY,
  round_id     TEXT NOT NULL REFERENCES rounds (id),
  advisor_name TEXT NOT NULL,
  trigger      TEXT NOT NULL CHECK (trigger IN ('manual', 'auto')),
  brief        TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
  raw_output   TEXT,     -- capped at 256 KiB
  suggestion   TEXT      -- JSON (Suggestion), nullable: null while running or when the run produced nothing valid
);

CREATE INDEX advisor_runs_by_round ON advisor_runs (round_id, started_at);

-- The Round's current valid Suggestion (delegation spec): per-Question value and rationale, used both
-- to merge into the Draft and, at Send, to tell whether the Human kept a value unchanged (suggested_by).
-- Overwritten by a newer valid Suggestion; cleared to NULL when the Round ends.
ALTER TABLE rounds ADD COLUMN suggestion TEXT;
