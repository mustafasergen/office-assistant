import 'reflect-metadata';
import { type PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { DataSource } from 'typeorm';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDataSource } from '../../src/database/database.module';
import { readConfig } from '../../src/config/config';
import { privateDir, sha, outputDir } from './support';
export async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:55432/uplico_test';
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('Dedicated *_test database required');
  const db = createDataSource({ DATABASE_URL: url });
  await db.initialize();
  await db.runMigrations();
  await db.query('TRUNCATE users, documents CASCADE');
  return db;
}
export async function snapshot(db: DataSource, label: string) {
  const tables = ['users', 'threads', 'messages', 'memories', 'documents', 'document_chunks'];
  const data: Record<string, unknown> = {};
  for (const table of tables)
    data[table] = await db.query(`SELECT * FROM public.${table} ORDER BY id`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(privateDir, label + '.json'), JSON.stringify(data), { mode: 0o600 });
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, sha(JSON.stringify(value))]),
  );
}
export async function remoteTestDatabase() {
  const config = readConfig();
  const admin = createDataSource(config);
  await admin.initialize();
  const before = await snapshot(admin, 'supabase-before');
  const schema = 'uplico_eval_20261003';
  if ((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).length)
    throw new Error('Evaluation schema already exists; inspect before reuse');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new DataSource({
    ...(createDataSource(config).options as PostgresConnectionOptions),
    schema,
    extra: {
      max: 2,
      connectionTimeoutMillis: 15000,
      options: `-c search_path=${schema},extensions,public`,
    },
  });
  await db.initialize();
  try {
    for (const file of [
      '1730000000000-initial.sql',
      '1791040000000-library-editing.sql',
      '1791120000000-conversation-context.sql',
    ]) {
      const sql = (
        await readFile(resolve(__dirname, '../../supabase/migrations', file), 'utf8')
      ).replace('CREATE EXTENSION IF NOT EXISTS vector;', '');
      await db.query(sql);
    }
    for (const table of [
      'users',
      'threads',
      'messages',
      'memories',
      'documents',
      'document_chunks',
    ]) {
      await db.query(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY`);
      await db.query(`REVOKE ALL ON ${schema}.${table} FROM PUBLIC, anon, authenticated`);
    }
  } catch (e) {
    await db.destroy();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.destroy();
    throw e;
  }
  return {
    db,
    async cleanup() {
      await db.destroy();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      const after = await snapshot(admin, 'supabase-after');
      await admin.destroy();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error('Supabase public data changed');
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        resolve(outputDir, 'supabase-preservation.json'),
        JSON.stringify(
          {
            publicTablesUnchanged: true,
            temporarySchemaRemoved: true,
            before,
            after,
          },
          null,
          2,
        ),
      );
      console.log('Supabase public tables unchanged; isolated schema removed');
    },
  };
}
