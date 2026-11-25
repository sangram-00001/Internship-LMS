import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function notifyStudent(tx: Prisma.TransactionClient, input: { userId: string; eventKey: string; title: string; body: string; path: string }) {
  const user = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true } });
  if (!user) return;
  const inserted = await tx.notification.createMany({ data: [input], skipDuplicates: true });
  if (!inserted.count) return;
  const notification = await tx.notification.findUniqueOrThrow({ where: { eventKey: input.eventKey }, select: { id: true } });
  const origin = new URL(process.env.WEB_ORIGIN || 'http://localhost:5173').origin;
  await tx.emailJob.create({ data: { notificationId: notification.id, recipient: user.email, subject: input.title, body: `${input.body}\n\nOpen AspireEdge: ${origin}${input.path}` } });
}

export async function dispatchAnnouncements(db: PrismaClient) {
  let processed = 0;
  for (let page = 0; page < 10; page++) {
    const count = await db.$transaction(async tx => {
      const announcement = await tx.announcement.findFirst({ where: { completedAt: null }, orderBy: { createdAt: 'asc' } });
      if (!announcement) return -1;
      const now = new Date();
      const users = await tx.user.findMany({ where: { platformRole: 'USER', directStudent: { status: 'ACTIVE' }, ...(announcement.afterUserId ? { id: { gt: announcement.afterUserId } } : {}), ...(announcement.courseId ? { directEnrollments: { some: { courseId: announcement.courseId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: 25 });
      for (const user of users) await notifyStudent(tx, { userId: user.id, eventKey: `announcement:${announcement.id}:${user.id}`, title: announcement.title, body: announcement.body, path: '/student/notifications' });
      await tx.announcement.update({ where: { id: announcement.id }, data: { afterUserId: users.at(-1)?.id || announcement.afterUserId, ...(users.length < 25 ? { completedAt: now } : {}) } });
      return users.length;
    }, { isolationLevel: 'Serializable', timeout: 15000 });
    if (count < 0) break; processed += count;
  }
  return processed;
}

export async function queueAssignmentReminders(db: PrismaClient, now = new Date()) {
  const assignments = await db.assignment.findMany({ where: { published: true, dueAt: { gt: now, lte: new Date(now.getTime() + 86400000) }, course: { tenantId: null } }, orderBy: { dueAt: 'asc' }, take: 100 });
  let queued = 0;
  for (const assignment of assignments) {
    const prefix = `assignment-due:${assignment.id}:${assignment.dueAt!.toISOString()}:`;
    const students = await db.user.findMany({ where: { directStudent: { status: 'ACTIVE' }, platformRole: 'USER', directEnrollments: { some: { courseId: assignment.courseId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, assignmentSubmissions: { none: { assignmentId: assignment.id } }, notifications: { none: { eventKey: { startsWith: prefix } } } }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
    for (const student of students) {
      await db.$transaction(tx => notifyStudent(tx, { userId: student.id, eventKey: `${prefix}${student.id}`, title: 'Assignment due soon', body: `${assignment.title} is due at ${assignment.dueAt!.toISOString()} (UTC). Open your assignments to see the deadline in your local time.`, path: '/student/assessments' })); queued++;
    }
  }
  return queued;
}

export async function deliverLocalMail(db: PrismaClient) {
  if (process.env.NODE_ENV === 'production') throw new Error('Local mail is disabled in production.');
  const folder = resolve(process.env.LOCAL_MAIL_PATH || '.local-mail');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const now = new Date(), stale = new Date(now.getTime() - 5 * 60000);
  const available = { deliveredAt: null, attempts: { lt: 5 }, nextAttemptAt: { lte: now }, OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }] };
  const jobs = await db.emailJob.findMany({ where: available, take: 50, orderBy: { createdAt: 'asc' } });
  let delivered = 0;
  for (const job of jobs) {
    const lockId = randomUUID();
    const claim = await db.emailJob.updateMany({ where: { id: job.id, ...available }, data: { lockedAt: now, lockId, attempts: { increment: 1 } } });
    if (!claim.count) continue;
    const temporary = resolve(folder, `${job.id}.${lockId}.tmp`);
    try {
      await writeFile(temporary, `To: ${job.recipient}\nSubject: ${job.subject}\n\n${job.body}`, { mode: 0o600, flag: 'wx' });
      // Atomic rename and stable destination make local delivery safe to retry after a crash.
      await rename(temporary, resolve(folder, `${job.id}.txt`));
      const updated = await db.emailJob.updateMany({ where: { id: job.id, lockId }, data: { deliveredAt: new Date(), body: '[delivered to local mailbox]', lockedAt: null, lockId: null } });
      delivered += updated.count;
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
      await db.emailJob.updateMany({ where: { id: job.id, lockId }, data: { lockedAt: null, lockId: null, nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60000) } });
    }
  }
  return delivered;
}
