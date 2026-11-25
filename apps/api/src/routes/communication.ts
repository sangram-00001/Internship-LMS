import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { requireAuth, requirePlatform, requireStudent } from '../middleware/auth.js';
import { notifyStudent } from '../lib/notifications.js';
const router = Router(), id = z.string().uuid();
router.use(requireAuth);
router.get('/notifications', requireStudent, asyncRoute(async (req, res) => {
  const [notifications, unread] = await Promise.all([prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, body: true, path: true, readAt: true, createdAt: true } }), prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null } })]);
  res.setHeader('Cache-Control', 'no-store'); res.json({ data: { notifications, unread } });
}));
router.post('/notifications/:id/read', requireStudent, asyncRoute(async (req, res) => {
  const updated = await prisma.notification.updateMany({ where: { id: id.parse(req.params.id), userId: req.auth!.userId }, data: { readAt: new Date() } });
  if (!updated.count) fail(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.'); res.json({ data: { success: true } });
}));
router.get('/tickets', asyncRoute(async (req, res) => {
  const admin = req.auth!.platformRole === 'SUPER_ADMIN' && !req.auth!.tenantId;
  if (req.auth!.tenantId) fail(403, 'FORBIDDEN', 'Academy support only.');
  const status = req.query.status ? z.enum(['OPEN', 'WAITING', 'RESOLVED']).parse(req.query.status) : undefined;
  res.json({ data: await prisma.supportTicket.findMany({ where: { ...(!admin ? { userId: req.auth!.userId } : {}), ...(status ? { status } : {}) }, include: { user: { select: { name: true, directStudent: { select: { studentCode: true } } } } }, orderBy: { updatedAt: 'desc' }, take: 100 }) });
}));
const ticketLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/tickets', requireStudent, ticketLimit, asyncRoute(async (req, res) => {
  const input = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(5000) }).strict().parse(req.body);
  const ticket = await prisma.$transaction(async tx => {
    if (await tx.supportTicket.count({ where: { userId: req.auth!.userId, createdAt: { gte: new Date(Date.now() - 86400000) } } }) >= 5) fail(429, 'TICKET_LIMIT', 'You can create up to five tickets per day. Reply to an existing ticket for follow-up.');
    return tx.supportTicket.create({ data: { userId: req.auth!.userId, subject: input.subject, messages: { create: { authorId: req.auth!.userId, body: input.body } } } });
  }, { isolationLevel: 'Serializable' }); res.status(201).json({ data: ticket });
}));
router.get('/tickets/:id', asyncRoute(async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: id.parse(req.params.id) }, include: { messages: { include: { author: { select: { name: true, platformRole: true } } }, orderBy: { createdAt: 'asc' } } } });
  if (!ticket || req.auth!.tenantId || ticket.userId !== req.auth!.userId && req.auth!.platformRole !== 'SUPER_ADMIN') fail(404, 'TICKET_NOT_FOUND', 'Ticket not found.');
  res.setHeader('Cache-Control', 'no-store'); res.json({ data: ticket });
}));
router.post('/tickets/:id/replies', ticketLimit, asyncRoute(async (req, res) => {
  const input = z.object({ body: z.string().trim().min(1).max(5000), resolve: z.boolean().optional() }).strict().parse(req.body), ticketId = id.parse(req.params.id);
  const admin = req.auth!.platformRole === 'SUPER_ADMIN' && !req.auth!.tenantId;
  const result = await prisma.$transaction(async tx => {
    const ticket = await tx.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || req.auth!.tenantId || !admin && ticket.userId !== req.auth!.userId) fail(404, 'TICKET_NOT_FOUND', 'Ticket not found.');
    if (!admin && input.resolve !== undefined) fail(403, 'FORBIDDEN', 'Only the administrator can resolve a ticket.');
    if (await tx.supportMessage.count({ where: { ticketId } }) >= 100) fail(409, 'THREAD_LIMIT', 'This ticket has reached its message limit. Create a follow-up ticket.');
    const message = await tx.supportMessage.create({ data: { ticketId, authorId: req.auth!.userId, body: input.body } });
    await tx.supportTicket.update({ where: { id: ticketId }, data: { status: admin ? input.resolve ? 'RESOLVED' : 'WAITING' : 'OPEN' } });
    if (admin) {
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'SUPPORT_REPLIED', entityType: 'SupportTicket', entityId: ticketId, metadata: { resolved: !!input.resolve } } });
      await notifyStudent(tx, { userId: ticket.userId, eventKey: `support:${message.id}`, title: input.resolve ? 'Support ticket resolved' : 'New support reply', body: 'The administrator replied to your support ticket. Sign in to read the response.', path: `/student/support?ticket=${ticketId}` });
    }
    return message;
  }, { isolationLevel: 'Serializable' }); res.status(201).json({ data: result });
}));
router.use('/admin', requirePlatform);
router.get('/admin/jobs', asyncRoute(async (_req, res) => {
  const [pending, failed, announcements] = await Promise.all([prisma.emailJob.count({ where: { deliveredAt: null, attempts: { lt: 5 } } }), prisma.emailJob.findMany({ where: { deliveredAt: null, attempts: { gte: 5 } }, select: { id: true, subject: true, attempts: true, createdAt: true }, take: 100 }), prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })]);
  res.json({ data: { pending, failed, announcements, deliveryMode: 'LOCAL_ONLY' } });
}));
router.post('/admin/announcements', asyncRoute(async (req, res) => {
  const input = z.object({ courseId: id.nullable(), title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(5000) }).strict().parse(req.body);
  const announcement = await prisma.$transaction(async tx => {
    if (input.courseId && !await tx.course.findFirst({ where: { id: input.courseId, tenantId: null } })) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
    const created = await tx.announcement.create({ data: { ...input, createdById: req.auth!.userId } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ANNOUNCEMENT_QUEUED', entityType: 'Announcement', entityId: created.id, metadata: { courseId: input.courseId } } }); return created;
  }); res.status(201).json({ data: announcement });
}));
router.post('/admin/jobs/:id/retry', asyncRoute(async (req, res) => {
  const jobId = id.parse(req.params.id);
  await prisma.$transaction(async tx => { const updated = await tx.emailJob.updateMany({ where: { id: jobId, deliveredAt: null, attempts: { gte: 5 }, OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - 5 * 60000) } }] }, data: { attempts: 0, nextAttemptAt: new Date(), lockedAt: null, lockId: null } }); if (!updated.count) fail(409, 'JOB_NOT_RETRYABLE', 'This job is not ready for manual retry.'); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'EMAIL_JOB_RETRY', entityType: 'EmailJob', entityId: jobId } }); }); res.json({ data: { success: true } });
}));
export default router;
