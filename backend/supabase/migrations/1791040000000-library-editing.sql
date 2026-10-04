ALTER TABLE documents ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN deleted_at timestamptz;
-- Deleting chat history does not implicitly delete the user's separately managed memory.
ALTER TABLE memories DROP CONSTRAINT memories_source_message_id_fkey;
ALTER TABLE memories ALTER COLUMN source_message_id DROP NOT NULL;
ALTER TABLE memories ADD CONSTRAINT memories_source_message_id_fkey
  FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL;
