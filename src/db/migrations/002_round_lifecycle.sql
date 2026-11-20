-- Round lifecycle (round-lifecycle spec): queue position, idempotency, Locks, Drafts, deadlines.

-- Queue position: arrival order; a Superseding Round takes its predecessor's value.
ALTER TABLE rounds ADD COLUMN position REAL;
UPDATE rounds SET position = rowid;

-- Idempotency: key scoped to the session, compared by the hash of the canonical JSON body.
ALTER TABLE rounds ADD COLUMN idempotency_key TEXT;
ALTER TABLE rounds ADD COLUMN body_hash TEXT;
CREATE UNIQUE INDEX rounds_idempotency ON rounds (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Locks: {question id: {value, locked_at}} for Questions whose policy fired.
ALTER TABLE rounds ADD COLUMN locks TEXT NOT NULL DEFAULT '{}';

-- The Human's Draft: {questions: {id: {value?, note?}}, note?, message?}. Kept as "Not sent" when overtaken.
ALTER TABLE rounds ADD COLUMN draft TEXT;

-- Ended-in-place Rounds (expired, cancelled, superseded) stay in the Feed until the Human removes them.
ALTER TABLE rounds ADD COLUMN feed_removed_at TEXT;

-- Absolute deadlines of open Questions with an apply_recommended or cancel policy.
CREATE TABLE question_deadlines (
  round_id    TEXT NOT NULL REFERENCES rounds (id),
  question_id TEXT NOT NULL,
  deadline    TEXT NOT NULL,
  PRIMARY KEY (round_id, question_id)
);
CREATE INDEX question_deadlines_by_deadline ON question_deadlines (deadline);

-- Backfill deadlines for Rounds still pending from before this migration.
INSERT INTO question_deadlines (round_id, question_id, deadline)
SELECT r.id,
       json_extract(q.value, '$.id'),
       strftime('%Y-%m-%dT%H:%M:%fZ', r.received_at,
                '+' || coalesce(json_extract(q.value, '$.policy.after_seconds'), json_extract(r.round, '$.policy.after_seconds')) || ' seconds')
FROM rounds r, json_each(r.round, '$.questions') q
WHERE r.status = 'pending'
  AND coalesce(json_extract(q.value, '$.policy.on_timeout'), json_extract(r.round, '$.policy.on_timeout'), 'wait') <> 'wait';
