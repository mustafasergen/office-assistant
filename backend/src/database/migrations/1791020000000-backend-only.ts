import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackendOnly1791020000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      readFileSync(
        join(__dirname, '../../../supabase/migrations/1791020000000-backend-only.sql'),
        'utf8',
      ),
    );
  }
  async down(): Promise<void> {
    throw new Error(
      'Backend-only access cannot be reverted automatically; review grants explicitly.',
    );
  }
}
