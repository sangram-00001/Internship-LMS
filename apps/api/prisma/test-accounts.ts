import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const url = new URL(process.env.DATABASE_URL!);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/aspireedge_lms') throw new Error('Expected local development database.');
const root = resolve('../..');
const database = 'aspireedge_accounts_validation';
let created = false;
const docker = (args: string[], input?: Buffer) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', ...args], { cwd: root, input, maxBuffer: 100 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
try {
  // If a validation database already exists, stop rather than overwrite it.
  docker(['sh', '-c', 'createdb -U "$POSTGRES_USER" "$1"', 'sh', database]); created = true;
  const dump = docker(['sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc']);
  docker(['sh', '-c', 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error', 'sh', database], dump);
  url.pathname = `/${database}`;
  const env = { ...process.env, DATABASE_URL: url.toString() };
  execFileSync(resolve('../../node_modules/.bin/prisma'), ['migrate', 'deploy'], { env, stdio: 'pipe' });
  execFileSync(resolve('../../node_modules/.bin/tsx'), ['tests/accounts.integration.ts'], { env, stdio: 'inherit' });
} catch {
  console.error('Integration checks failed. No existing database was reset; inspect the test assertion or validation database availability.');
  process.exitCode = 1;
} finally {
  if (created) docker(['sh', '-c', 'dropdb -U "$POSTGRES_USER" "$1"', 'sh', database]);
}
