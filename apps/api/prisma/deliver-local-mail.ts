import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  if (process.env.NODE_ENV === 'production') throw new Error('Local email delivery is disabled in production.');
  const folder = resolve('.local-mail');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const jobs = await db.emailJob.findMany({ where: { deliveredAt: null, attempts: { lt: 5 } }, take: 50, orderBy: { createdAt: 'asc' } });
  let delivered = 0;
  for (const job of jobs) {
    try {
      // Stable filename makes a retried delivery idempotent, including after a crash.
      await writeFile(resolve(folder, `${job.id}.txt`), `To: ${job.recipient}\nSubject: ${job.subject}\n\n${job.body}`, { mode: 0o600 });
      await db.emailJob.update({ where: { id: job.id }, data: { deliveredAt: new Date(), body: '[delivered to local mailbox]' } });
      delivered++;
    } catch {
      await db.emailJob.update({ where: { id: job.id }, data: { attempts: { increment: 1 } } });
    }
  }
  console.log(`Delivered ${delivered} message(s) to the private local mailbox. No external email sent.`);
} catch {
  console.error('Local email delivery failed. Check database connectivity and mailbox permissions.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
