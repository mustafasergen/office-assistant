import { databaseConnectionOptions } from './connection-options';
import { readConfig } from '../config/config';

describe('database configuration', () => {
  it('keeps blank env on the local mock defaults', () => {
    const config = readConfig({ DATABASE_URL: '' });
    expect(config.LLM_PROVIDER).toBe('mock');
    expect(config.DATABASE_URL).toBe('postgresql://uplico:uplico@localhost:5432/uplico');
  });
  it('uses the trusted Supabase CA without losing encoded credentials', () => {
    const options = databaseConnectionOptions(
      'postgresql://postgres.example:pass%25word@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require',
    );
    expect(new URL(options.url).password).toBe('pass%25word');
    expect(new URL(options.url).searchParams.has('sslmode')).toBe(false);
    expect(options.ssl?.rejectUnauthorized).toBe(true);
    expect(options.ssl?.ca).toContain('BEGIN CERTIFICATE');
  });
  it('does not change non-Supabase database URLs', () => {
    const url = 'postgresql://uplico:uplico@postgres:5432/uplico';
    expect(databaseConnectionOptions(url)).toEqual({ url });
  });
});
