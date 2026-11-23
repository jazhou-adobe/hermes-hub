-- Answered log full-text search (answered-log spec): Round title/context, Question
-- prompt/detail, option label/detail, free-text answers, the Human's note and the
-- redirect message. Attachments are never indexed. Populated explicitly by
-- Engine.end() when a Round ends, not by a trigger on `rounds` (FTS5 content
-- tables make trigger-based sync awkward; building the text once in the Engine
-- keeps the indexing logic in one place and easy to test).
CREATE VIRTUAL TABLE log_fts USING fts5(round_id UNINDEXED, text);
