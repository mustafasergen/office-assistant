ALTER TABLE users ADD COLUMN memory_revision integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN context_revision integer NOT NULL DEFAULT -1;
-- Existing transcripts predate revision tracking: preserve topics, never trust old personal text.
ALTER TABLE messages ALTER COLUMN context_revision SET DEFAULT 0;
ALTER TABLE threads ADD COLUMN context_summary jsonb;
ALTER TABLE messages ADD COLUMN context_order bigserial;
-- BIGSERIAL backfills in physical row order; legacy context must follow transcript chronology.
WITH chronological AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS position FROM messages
)
UPDATE messages m SET context_order = c.position FROM chronological c WHERE m.id = c.id;
CREATE INDEX messages_context_order ON messages(thread_id, context_order);
