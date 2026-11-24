import { Router } from 'express';
import { Prisma, MembershipRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail, pageInput, sendList } from '../lib/http.js';
import { requireAuth, requireRoles, requireTenant } from '../middleware/auth.js';
import { audit, createInvitation } from '../services/invitations.js';

const router = Router();
router.use(requireAuth, requireTenant);
const adminRoles: MembershipRole[] = ['COMPANY_ADMIN', 'HR'];
const courseRoles: MembershipRole[] = ['COMPANY_ADMIN', 'HR', 'TRAINER'];
const email = z.string().email().max(254).transform(v => v.toLowerCase());
const nonempty = z.string().trim().min(2).max(150);
const optionalText = z.string().trim().max(2000).optional().nullable();

router.get('/dashboard', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const [students, trainers, activeInternships, courses, batches, activeMemberships] = await Promise.all([
    prisma.student.count({ where: { tenantId, status: 'ACTIVE' } }),
    prisma.trainer.count({ where: { tenantId, status: 'ACTIVE' } }),
    prisma.internship.count({ where: { tenantId, status: { in: ['PUBLISHED', 'ONGOING'] } } }),
    prisma.course.count({ where: { tenantId, status: { not: 'ARCHIVED' } } }),
    prisma.batch.count({ where: { tenantId, status: { not: 'ARCHIVED' } } }),
    prisma.tenantMembership.count({ where: { tenantId, status: 'ACTIVE' } }),
  ]);
  res.json({ data: { students, trainers, activeInternships, courses, batches, activeMemberships } });
}));

const studentCreate = z.object({
  fullName: nonempty,
  email,
  studentCode: z.string().trim().min(2).max(40),
  phone: z.string().trim().max(30).optional(),
  college: z.string().trim().max(160).optional(),
  department: z.string().trim().max(160).optional(),
  graduationYear: z.coerce.number().int().min(1990).max(2100).optional().nullable(),
});
const studentUpdate = studentCreate.omit({ email: true }).partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() });
const trainerCreate = z.object({
  fullName: nonempty, email,
  phone: z.string().trim().max(30).optional(),
  specialization: z.string().trim().max(160).optional(),
});
const trainerUpdate = trainerCreate.omit({ email: true }).partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() });

async function checkSeatLimit(tenantId: string, resource: 'student' | 'trainer') {
  const subscription = await prisma.subscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] },
    OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { startsAt: 'desc' }, include: { plan: true } });
  if (!subscription) fail(403, 'NO_SUBSCRIPTION', 'No active subscription. Contact the platform owner.');
  const count = resource === 'student'
    ? await prisma.student.count({ where: { tenantId, status: 'ACTIVE' } })
    : await prisma.trainer.count({ where: { tenantId, status: 'ACTIVE' } });
  const limit = resource === 'student' ? subscription.plan.studentLimit : subscription.plan.trainerLimit;
  if (count >= limit) fail(403, 'PLAN_LIMIT', `Your plan allows a maximum of ${limit} active ${resource}s.`);
}

async function ensureUserForInvite(tx: Prisma.TransactionClient, userEmail: string, name: string) {
  return tx.user.upsert({ where: { email: userEmail }, update: {}, create: { email: userEmail, name } });
}

router.get('/students', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const { q, page, pageSize, skip } = pageInput(req.query);
  const where: Prisma.StudentWhereInput = { tenantId, status: 'ACTIVE',
    ...(q ? { OR: [
      { fullName: { contains: q, mode: 'insensitive' } },
      { studentCode: { contains: q, mode: 'insensitive' } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
    ] } : {}) };
  const [data, total] = await Promise.all([
    prisma.student.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } } }), prisma.student.count({ where }),
  ]);
  sendList(res, data.map(({ user, ...student }) => ({ ...student, email: user.email })), total, page, pageSize);
}));

router.post('/students', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = studentCreate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  await checkSeatLimit(tenantId, 'student');
  const result = await prisma.$transaction(async tx => {
    const user = await ensureUserForInvite(tx, body.email, body.fullName);
    const student = await tx.student.create({ data: { tenantId, userId: user.id,
      fullName: body.fullName, studentCode: body.studentCode, phone: body.phone,
      college: body.college, department: body.department, graduationYear: body.graduationYear } });
    await tx.tenantMembership.upsert({ where: { userId_tenantId_role: { userId: user.id, tenantId, role: 'STUDENT' } },
      update: { status: 'DISABLED' }, create: { userId: user.id, tenantId, role: 'STUDENT', status: 'DISABLED' } });
    const invitationUrl = await createInvitation(tx, { tenantId, email: user.email, name: body.fullName, role: 'STUDENT' });
    return { student, invitationUrl };
  });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'STUDENT_CREATED', entityType: 'Student', entityId: result.student.id });
  res.status(201).json({ data: result });
}));

router.get('/students/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const item = await prisma.student.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId! },
    include: { user: { select: { email: true } } } });
  if (!item) fail(404, 'NOT_FOUND', 'Student not found.');
  const { user, ...profile } = item;
  res.json({ data: { ...profile, email: user.email } });
}));

router.patch('/students/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = studentUpdate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.student.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Student not found.');
  if (body.status === 'ACTIVE' && item.status !== 'ACTIVE') await checkSeatLimit(tenantId, 'student');
  const updated = await prisma.$transaction(async tx => {
    const s = await tx.student.update({ where: { id: item.id }, data: body });
    if (body.status) await tx.tenantMembership.updateMany({ where: { tenantId, userId: item.userId, role: 'STUDENT' },
      data: { status: body.status === 'ARCHIVED' ? 'DISABLED' : 'ACTIVE' } });
    return s;
  });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'STUDENT_UPDATED', entityType: 'Student', entityId: item.id });
  res.json({ data: updated });
}));

router.delete('/students/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.student.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Student not found.');
  await prisma.$transaction([
    prisma.student.update({ where: { id: item.id }, data: { status: 'ARCHIVED' } }),
    prisma.tenantMembership.updateMany({ where: { tenantId, userId: item.userId, role: 'STUDENT' }, data: { status: 'DISABLED' } }),
  ]);
  await audit({ actorId: req.auth!.userId, tenantId, action: 'STUDENT_ARCHIVED', entityType: 'Student', entityId: item.id });
  res.json({ data: { archived: true } });
}));

router.get('/trainers', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const { q, page, pageSize, skip } = pageInput(req.query);
  const where: Prisma.TrainerWhereInput = { tenantId, status: 'ACTIVE', ...(q ? { OR: [
    { fullName: { contains: q, mode: 'insensitive' } },
    { specialization: { contains: q, mode: 'insensitive' } },
  ] } : {}) };
  const [data, total] = await Promise.all([
    prisma.trainer.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true } } } }),
    prisma.trainer.count({ where }),
  ]);
  sendList(res, data.map(({ user, ...trainer }) => ({ ...trainer, email: user.email })), total, page, pageSize);
}));

router.post('/trainers', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = trainerCreate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  await checkSeatLimit(tenantId, 'trainer');
  const result = await prisma.$transaction(async tx => {
    const user = await ensureUserForInvite(tx, body.email, body.fullName);
    const trainer = await tx.trainer.create({ data: { tenantId, userId: user.id,
      fullName: body.fullName, phone: body.phone, specialization: body.specialization } });
    await tx.tenantMembership.upsert({ where: { userId_tenantId_role: { userId: user.id, tenantId, role: 'TRAINER' } },
      update: { status: 'DISABLED' }, create: { userId: user.id, tenantId, role: 'TRAINER', status: 'DISABLED' } });
    const invitationUrl = await createInvitation(tx, { tenantId, email: user.email, name: body.fullName, role: 'TRAINER' });
    return { trainer, invitationUrl };
  });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'TRAINER_CREATED', entityType: 'Trainer', entityId: result.trainer.id });
  res.status(201).json({ data: result });
}));

router.get('/trainers/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const item = await prisma.trainer.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId! }, include: { user: { select: { email: true } } } });
  if (!item) fail(404, 'NOT_FOUND', 'Trainer not found.');
  const { user, ...profile } = item;
  res.json({ data: { ...profile, email: user.email } });
}));

router.patch('/trainers/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = trainerUpdate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.trainer.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Trainer not found.');
  if (body.status === 'ACTIVE' && item.status !== 'ACTIVE') await checkSeatLimit(tenantId, 'trainer');
  const updated = await prisma.$transaction(async tx => {
    const t = await tx.trainer.update({ where: { id: item.id }, data: body });
    if (body.status) await tx.tenantMembership.updateMany({ where: { tenantId, userId: item.userId, role: 'TRAINER' },
      data: { status: body.status === 'ARCHIVED' ? 'DISABLED' : 'ACTIVE' } });
    return t;
  });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'TRAINER_UPDATED', entityType: 'Trainer', entityId: item.id });
  res.json({ data: updated });
}));

router.delete('/trainers/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.trainer.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Trainer not found.');
  await prisma.$transaction([
    prisma.trainer.update({ where: { id: item.id }, data: { status: 'ARCHIVED' } }),
    prisma.tenantMembership.updateMany({ where: { tenantId, userId: item.userId, role: 'TRAINER' }, data: { status: 'DISABLED' } }),
  ]);
  await audit({ actorId: req.auth!.userId, tenantId, action: 'TRAINER_ARCHIVED', entityType: 'Trainer', entityId: item.id });
  res.json({ data: { archived: true } });
}));

const dateValue = z.string().datetime({ offset: true }).optional().nullable().transform(v => v ? new Date(v) : v);
const internshipCreate = z.object({
  title: nonempty, description: optionalText,
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).default('ONLINE'),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ONGOING', 'COMPLETED']).default('DRAFT'),
  durationDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(1000000).optional().nullable(),
  startsAt: dateValue, endsAt: dateValue,
}).refine(d => !d.startsAt || !d.endsAt || d.endsAt > d.startsAt, { message: 'End date must be after start date', path: ['endsAt'] });
// Keep the create schema and update schema independent so partial updates do not apply defaults.
const internshipPatch = z.object({
  title: nonempty.optional(), description: optionalText,
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ONGOING', 'COMPLETED', 'ARCHIVED']).optional(),
  durationDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(1000000).optional().nullable(),
  startsAt: dateValue, endsAt: dateValue,
});
const courseCreate = z.object({ title: nonempty, description: optionalText,
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT') });
const coursePatch = z.object({ title: nonempty.optional(), description: optionalText,
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional() });
const batchCreate = z.object({ name: nonempty, code: z.string().trim().min(2).max(40),
  internshipId: z.string().uuid().optional().nullable(), courseId: z.string().uuid().optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(1000000).optional().nullable(),
  startsAt: dateValue, endsAt: dateValue,
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED']).default('DRAFT') });
const batchPatch = z.object({ name: nonempty.optional(), code: z.string().trim().min(2).max(40).optional(),
  internshipId: z.string().uuid().optional().nullable(), courseId: z.string().uuid().optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(1000000).optional().nullable(),
  startsAt: dateValue, endsAt: dateValue,
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']).optional() });

async function validateBatchRelations(tenantId: string, input: { internshipId?: string | null; courseId?: string | null }) {
  if (input.internshipId && !(await prisma.internship.findFirst({ where: { id: input.internshipId, tenantId, status: { not: 'ARCHIVED' } } }))) {
    fail(422, 'INVALID_INTERNSHIP', 'Internship does not belong to this company.');
  }
  if (input.courseId && !(await prisma.course.findFirst({ where: { id: input.courseId, tenantId, status: { not: 'ARCHIVED' } } }))) {
    fail(422, 'INVALID_COURSE', 'Course does not belong to this company.');
  }
}

router.get('/internships', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const { q, page, pageSize, skip } = pageInput(req.query);
  const where: Prisma.InternshipWhereInput = { tenantId, status: { not: 'ARCHIVED' },
    ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}) };
  const [data, total] = await Promise.all([
    prisma.internship.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }), prisma.internship.count({ where }),
  ]);
  sendList(res, data, total, page, pageSize);
}));
router.post('/internships', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = internshipCreate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.internship.create({ data: { ...body, tenantId } });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'INTERNSHIP_CREATED', entityType: 'Internship', entityId: item.id });
  res.status(201).json({ data: item });
}));
router.get('/internships/:id', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const item = await prisma.internship.findFirst({ where: { tenantId: req.auth!.tenantId!, id: req.params.id } });
  if (!item) fail(404, 'NOT_FOUND', 'Internship not found.');
  res.json({ data: item });
}));
router.patch('/internships/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = internshipPatch.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const existing = await prisma.internship.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) fail(404, 'NOT_FOUND', 'Internship not found.');
  const start = body.startsAt === undefined ? existing.startsAt : body.startsAt;
  const end = body.endsAt === undefined ? existing.endsAt : body.endsAt;
  if (start && end && end <= start) fail(422, 'INVALID_DATES', 'End date must be after start date.');
  const item = await prisma.internship.update({ where: { id: existing.id }, data: body });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'INTERNSHIP_UPDATED', entityType: 'Internship', entityId: item.id });
  res.json({ data: item });
}));
router.delete('/internships/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.internship.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Internship not found.');
  await prisma.internship.update({ where: { id: item.id }, data: { status: 'ARCHIVED' } });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'INTERNSHIP_ARCHIVED', entityType: 'Internship', entityId: item.id });
  res.json({ data: { archived: true } });
}));

router.get('/courses', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const { q, page, pageSize, skip } = pageInput(req.query);
  const where: Prisma.CourseWhereInput = { tenantId, status: { not: 'ARCHIVED' },
    ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}) };
  const [data, total] = await Promise.all([
    prisma.course.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }), prisma.course.count({ where }),
  ]);
  sendList(res, data, total, page, pageSize);
}));
router.post('/courses', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const body = courseCreate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const subscription = await prisma.subscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { startsAt: 'desc' }, include: { plan: true } });
  if (!subscription) fail(403, 'NO_SUBSCRIPTION', 'No active company subscription.');
  const count = await prisma.course.count({ where: { tenantId, status: { not: 'ARCHIVED' } } });
  if (count >= subscription.plan.courseLimit) fail(403, 'PLAN_LIMIT', 'Course limit reached for the current plan.');
  const item = await prisma.course.create({ data: { ...body, tenantId } });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'COURSE_CREATED', entityType: 'Course', entityId: item.id });
  res.status(201).json({ data: item });
}));
router.get('/courses/:id', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const item = await prisma.course.findFirst({ where: { tenantId: req.auth!.tenantId!, id: req.params.id } });
  if (!item) fail(404, 'NOT_FOUND', 'Course not found.');
  res.json({ data: item });
}));
router.patch('/courses/:id', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const body = coursePatch.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const existing = await prisma.course.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) fail(404, 'NOT_FOUND', 'Course not found.');
  const item = await prisma.course.update({ where: { id: existing.id }, data: body });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'COURSE_UPDATED', entityType: 'Course', entityId: item.id });
  res.json({ data: item });
}));
router.delete('/courses/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.course.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Course not found.');
  await prisma.course.update({ where: { id: item.id }, data: { status: 'ARCHIVED' } });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'COURSE_ARCHIVED', entityType: 'Course', entityId: item.id });
  res.json({ data: { archived: true } });
}));

router.get('/batches', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const { q, page, pageSize, skip } = pageInput(req.query);
  const where: Prisma.BatchWhereInput = { tenantId, status: { not: 'ARCHIVED' },
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) };
  const [data, total] = await Promise.all([
    prisma.batch.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }), prisma.batch.count({ where }),
  ]);
  sendList(res, data, total, page, pageSize);
}));
router.post('/batches', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = batchCreate.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  await validateBatchRelations(tenantId, body);
  const item = await prisma.batch.create({ data: { ...body, tenantId } });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'BATCH_CREATED', entityType: 'Batch', entityId: item.id });
  res.status(201).json({ data: item });
}));
router.get('/batches/:id', requireRoles(...courseRoles), asyncRoute(async (req, res) => {
  const item = await prisma.batch.findFirst({ where: { tenantId: req.auth!.tenantId!, id: req.params.id } });
  if (!item) fail(404, 'NOT_FOUND', 'Batch not found.');
  res.json({ data: item });
}));
router.patch('/batches/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const body = batchPatch.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const existing = await prisma.batch.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) fail(404, 'NOT_FOUND', 'Batch not found.');
  await validateBatchRelations(tenantId, body);
  const item = await prisma.batch.update({ where: { id: existing.id }, data: body });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'BATCH_UPDATED', entityType: 'Batch', entityId: item.id });
  res.json({ data: item });
}));
router.delete('/batches/:id', requireRoles(...adminRoles), asyncRoute(async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const item = await prisma.batch.findFirst({ where: { id: req.params.id, tenantId } });
  if (!item) fail(404, 'NOT_FOUND', 'Batch not found.');
  await prisma.batch.update({ where: { id: item.id }, data: { status: 'ARCHIVED' } });
  await audit({ actorId: req.auth!.userId, tenantId, action: 'BATCH_ARCHIVED', entityType: 'Batch', entityId: item.id });
  res.json({ data: { archived: true } });
}));

export default router;
