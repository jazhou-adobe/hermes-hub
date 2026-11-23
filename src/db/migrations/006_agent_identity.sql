-- Agent identity (agent-identity spec): Forget hides a session until it next contacts the Hub.
ALTER TABLE sessions ADD COLUMN forgotten_at TEXT;
