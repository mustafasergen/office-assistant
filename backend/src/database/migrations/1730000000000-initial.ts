import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1730000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      readFileSync(
        join(__dirname, '../../../supabase/migrations/1730000000000-initial.sql'),
        'utf8',
      ),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE document_chunks, documents, memories, messages, threads, users');
  }
}
