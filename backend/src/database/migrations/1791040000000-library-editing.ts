import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class LibraryEditing1791040000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      readFileSync(
        join(__dirname, '../../../supabase/migrations/1791040000000-library-editing.sql'),
        'utf8',
      ),
    );
  }
  async down(): Promise<void> {
    throw new Error(
      'Library edits and detached memories require an explicit data-preserving rollback.',
    );
  }
}
