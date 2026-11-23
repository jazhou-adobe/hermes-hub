-- Command Center live settings (hub-operations spec): notifications, quiet hours, sound, appearance,
-- single-key shortcuts. One JSON document per key; the Hub fills in defaults for anything missing.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
