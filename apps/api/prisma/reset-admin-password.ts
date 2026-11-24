import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resetAdminPassword } from '../src/lib/passwords.js';

const db = new PrismaClient();
try {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Run with --confirm to replace the existing admin password and revoke its sessions.');
  }
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Configure SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD locally first.');
  await resetAdminPassword(db, email, password);
  console.log('Existing admin password updated. Sessions revoked and recovery audited.');
} catch {
  // Do not log database errors, validation inputs, or environment values.
  console.error('Admin recovery failed. Check the local configuration, existing admin account, database connection, and --confirm flag.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
