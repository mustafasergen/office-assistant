import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readConfig } from '../config/config';
import { createDataSource } from './database.module';

loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });
const tables = [
  'users',
  'threads',
  'messages',
  'memories',
  'documents',
  'document_chunks',
  'migrations',
];

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'snapshot'].includes(command)) throw new Error('Expected migrate or snapshot');
  const db = createDataSource(readConfig());
  await db.initialize();
  try {
    if (command === 'migrate') {
      const applied = await db.runMigrations();
      console.log(JSON.stringify({ applied: applied.map((migration) => migration.name) }));
    }
    // Only structure, never user data, connection strings, or credentials.
    const snapshot = {
      extensions: await db.query(
        "SELECT e.extname, e.extversion, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'",
      ),
      columns: await db.query(
        `SELECT c.relname AS table_name, a.attname AS column_name,
        pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
        pg_get_expr(d.adbin,d.adrelid) AS default_value
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY c.relname,a.attnum`,
        [tables],
      ),
      constraints: await db.query(
        `SELECT c.relname AS table_name, con.conname AS name,
        pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
        JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1) ORDER BY c.relname,con.conname`,
        [tables],
      ),
      indexes: await db.query(
        "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1) ORDER BY tablename,indexname",
        [tables],
      ),
      rowSecurity: await db.query(
        "SELECT relname AS table_name, relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1) ORDER BY relname",
        [tables],
      ),
      clientGrants: await db.query(
        "SELECT table_name, grantee, privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND table_name=ANY($1) AND grantee IN ('anon','authenticated','PUBLIC') ORDER BY table_name,grantee,privilege_type",
        [tables],
      ),
      migrations: await db.query(
        'SELECT timestamp, name FROM public.migrations ORDER BY timestamp',
      ),
    };
    await writeFile(
      resolve(__dirname, '../../supabase/schema.snapshot.json'),
      JSON.stringify(snapshot, null, 2) + '\n',
    );
    console.log('App schema snapshot updated (no user data).');
  } finally {
    await db.destroy();
  }
}
main().catch((error: unknown) => {
  console.error('Database command failed:', error instanceof Error ? error.name : 'UnknownError');
  process.exitCode = 1;
});
