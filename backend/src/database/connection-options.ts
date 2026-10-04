import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Supabase uses a private CA. Retain certificate AND hostname verification. */
export function databaseConnectionOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const isSupabase =
    url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co');
  if (!isSupabase) return { url: databaseUrl };
  // pg's URL SSL parameters override the explicit ssl object, so remove them here.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'])
    url.searchParams.delete(key);
  return {
    url: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(join(__dirname, '../../supabase/certs/prod-ca-2021.crt'), 'utf8'),
    },
  };
}
