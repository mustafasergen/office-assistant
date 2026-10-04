import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';
export class ConversationContext1791120000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      readFileSync(
        join(__dirname, '../../../supabase/migrations/1791120000000-conversation-context.sql'),
        'utf8',
      ),
    );
  }
  async down(): Promise<void> {
    throw new Error('Context privacy boundaries require an explicit data-preserving rollback.');
  }
}
