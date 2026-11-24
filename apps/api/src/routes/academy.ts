import { enrollmentActive, enrollmentStatus } from '../lib/enrollment.js';
import analyticsRoutes from './analytics.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail, pageInput, sendList } from '../lib/http.js';
import { requireAuth, requirePlatform, requireStudent } from '../middleware/auth.js';

const router = Router();
const id = z.string().uuid();
const courseInput = z.object({
  title: z.string().trim().min(3).max(180),
  instructor: z.string().trim().max(120).optional().nullable(),
  learningObjectives: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  previewText: z.string().trim().max(2000).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  pricePaise: z.number().int().min(0).max(100000000),
  durationHours: z.number().int().positive().max(10000).optional().nullable(),
  thumbnailUrl: z.string().url().max(2000).refine(v => /^https?:\/\//i.test(v), 'Use an HTTP or HTTPS URL').optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
});
const moduleInput = z.object({ title: z.string().trim().min(2).max(180), position: z.number().int().min(0).max(10000).default(0) });
const lessonInput = z.object({
  title: z.string().trim().min(2).max(180),
  kind: z.enum(['TEXT', 'VIDEO', 'LINK', 'PDF']).default('TEXT'),
  content: z.string().max(25000).optional().nullable(),
  contentUrl: z.string().url().max(2000).refine(v => /^https?:\/\//i.test(v), 'Use an HTTP or HTTPS URL').optional().nullable(),
  isPreview: z.boolean().default(false),
  position: z.number().int().min(0).max(10000).default(0),
});
const grantInput = z.object({
  expiresAt: z.string().datetime().refine(v => new Date(v) > new Date(), 'Expiry must be in the future').nullable().optional(),
  studentCode: z.string().trim().min(4).max(254).transform(s => s.toUpperCase()),
  courseId: id,
  source: z.enum(['MANUAL_PAYMENT', 'COMPLIMENTARY']),
  paymentMethod: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'OTHER']).optional(),
  paymentReference: z.string().trim().max(150).optional(),
  amountPaise: z.number().int().min(0).max(100000000).optional(),
  note: z.string().trim().max(1000).optional(),
}).superRefine((v, ctx) => {
  if (v.source === 'MANUAL_PAYMENT' && (!v.paymentMethod || v.amountPaise === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Payment method and amount required for manual payment.' });
  }
});
const publicCourse = { id: true, title: true, description: true, previewText: true, category: true,
  instructor: true, learningObjectives: true, level: true, pricePaise: true, durationHours: true, thumbnailUrl: true, status: true } as const;
const lessonOutline = { id: true, title: true, kind: true, position: true, isPreview: true } as const;

// Public catalog and course syllabus. Premium lesson content is not included in this response.
router.get('/categories', asyncRoute(async (_req, res) => {
  const courses = await prisma.course.findMany({ where: { tenantId: null, status: 'PUBLISHED', category: { not: null } }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } });
  res.json({ data: courses.map(c => c.category).filter(Boolean) });
}));
router.get('/courses', asyncRoute(async (req, res) => {
  const { page, pageSize, skip, q } = pageInput(req.query);
  const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 80) : '';
  const where = { tenantId: null, status: 'PUBLISHED' as const, ...(category ? { category } : {}), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] } : {}) };
  const [total, courses] = await prisma.$transaction([
    prisma.course.count({ where }),
    prisma.course.findMany({ where, select: publicCourse, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
  ]);
  sendList(res, courses, total, page, pageSize);
}));
router.get('/courses/:id', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: null, status: 'PUBLISHED' },
    select: { ...publicCourse, modules: { where: { archivedAt: null }, orderBy: { position: 'asc' }, select: { id: true, title: true, position: true,
      lessons: { where: { archivedAt: null }, orderBy: { position: 'asc' }, select: lessonOutline } } } } });
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  res.json({ data: course });
}));
router.get('/courses/:id/preview/:lessonId', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const lesson = await prisma.lesson.findFirst({ where: { id: id.parse(req.params.lessonId), isPreview: true, archivedAt: null,
    module: { courseId, archivedAt: null, course: { tenantId: null, status: 'PUBLISHED' } } },
    select: { id: true, title: true, kind: true, content: true, contentUrl: true } });
  if (!lesson) fail(404, 'PREVIEW_NOT_FOUND', 'Preview is unavailable.');
  res.json({ data: lesson });
}));

router.use(requireAuth);

// Student-only queries. Every access to course content is gated by active enrollment.
router.get('/student/dashboard', requireStudent, asyncRoute(async (req, res) => {
  const userId = req.auth!.userId;
  const [student, enrollments, orders] = await Promise.all([
    prisma.studentAccount.findUniqueOrThrow({ where: { userId }, select: { studentCode: true } }),
    prisma.directEnrollment.findMany({ where: { userId }, include: { course: { select: { id: true, title: true, thumbnailUrl: true, status: true, modules: { where: { archivedAt: null }, include: { lessons: { where: { archivedAt: null }, select: { id: true } } } } } }, progress: { select: { lessonId: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.courseOrder.count({ where: { userId, status: 'PENDING' } }),
  ]);
  const courses = enrollments.map(e => {
    const totalLessons = e.course.modules.reduce((sum, m) => sum + m.lessons.length, 0);
    const visibleIds = new Set(e.course.modules.flatMap(m => m.lessons.map(l => l.id)));
    const completedLessons = e.progress.filter(p => visibleIds.has(p.lessonId)).length;
    return { id: e.course.id, title: e.course.title, thumbnailUrl: e.course.thumbnailUrl, accessStatus: enrollmentStatus(e),
      source: e.source, lastActivityAt: e.lastActivityAt, enrolledAt: e.createdAt, totalLessons, completedLessons,
      progressPercent: totalLessons ? Math.min(100, Math.round(completedLessons / totalLessons * 100)) : 0 };
  });
  res.json({ data: { studentCode: student.studentCode, courses, pendingOrders: orders,
    activeCourses: courses.filter(c => c.accessStatus === 'ACTIVE').length,
    completedCourses: courses.filter(c => c.accessStatus === 'ACTIVE' && c.totalLessons > 0 && c.completedLessons === c.totalLessons).length } });
}));
router.get('/student/courses/:id', requireStudent, asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const enrollment = await prisma.directEnrollment.findUnique({ where: { userId_courseId: { userId: req.auth!.userId, courseId } },
    include: { progress: { select: { lessonId: true, completedAt: true } } } });
  if (!enrollment || !enrollmentActive(enrollment)) fail(403, 'ACCESS_REQUIRED', 'You do not have access to this course.');
  const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: null }, include: {
    modules: { where: { archivedAt: null }, orderBy: { position: 'asc' }, include: { lessons: { where: { archivedAt: null }, orderBy: { position: 'asc' } } } },
  } });
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course no longer exists.');
  res.json({ data: { course: { id: course.id, title: course.title, description: course.description, modules: course.modules }, lastLessonId: enrollment.lastLessonId, progress: enrollment.progress.filter(p => course.modules.some(m => m.lessons.some(l => l.id === p.lessonId))) } });
}));
router.post(['/student/lessons/:id/complete', '/student/lessons/:id/visit'], requireStudent, asyncRoute(async (req, res) => {
  const lessonId = id.parse(req.params.id);
  const lesson = await prisma.lesson.findFirst({ where: { id: lessonId, archivedAt: null, module: { archivedAt: null } }, select: { module: { select: { courseId: true, course: { select: { tenantId: true } } } } } });
  if (!lesson || lesson.module.course.tenantId !== null) fail(404, 'LESSON_NOT_FOUND', 'Lesson not found.');
  const enrollment = await prisma.directEnrollment.findUnique({ where: { userId_courseId: { userId: req.auth!.userId, courseId: lesson.module.courseId } } });
  if (!enrollment || !enrollmentActive(enrollment)) fail(403, 'ACCESS_REQUIRED', 'You do not have access to this lesson.');
  await prisma.$transaction(async tx => {
  await tx.directEnrollment.update({ where: { id: enrollment.id }, data: { lastActivityAt: new Date(), lastLessonId: lessonId } });
  if (req.path.endsWith('/complete')) await tx.lessonProgress.upsert({ where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } }, update: {}, create: { enrollmentId: enrollment.id, lessonId } });
  });
  res.json({ data: { completed: req.path.endsWith('/complete') } });
}));
router.post('/student/courses/:id/enroll-free', requireStudent, asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const userId = req.auth!.userId;
  const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: null, status: 'PUBLISHED', pricePaise: 0 } });
  if (!course) fail(404, 'FREE_COURSE_NOT_FOUND', 'Free course unavailable.');
  const enrollment = await prisma.$transaction(async tx => {
    const current = await tx.directEnrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (current && enrollmentActive(current)) return current;
    const record = await tx.directEnrollment.upsert({ where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, source: 'COMPLIMENTARY', status: 'ACTIVE', note: 'Free course enrollment' },
      update: { expiresAt: null, status: 'ACTIVE', source: 'COMPLIMENTARY', revokedAt: null, note: 'Free course enrollment' } });
    await tx.auditLog.create({ data: { actorId: userId, action: 'FREE_COURSE_ENROLL', entityType: 'DirectEnrollment', entityId: record.id } });
    return record;
  });
  res.json({ data: { enrollmentId: enrollment.id, status: enrollment.status } });
}));
router.get('/student/orders', requireStudent, asyncRoute(async (req, res) => {
  const orders = await prisma.courseOrder.findMany({ where: { userId: req.auth!.userId },
    include: { course: { select: { title: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ data: orders });
}));
// Purchase request does NOT grant access: admin must independently verify funds received.
router.post('/student/orders', requireStudent, asyncRoute(async (req, res) => {
  const { courseId, paymentMethod, paymentReference } = z.object({ courseId: id,
    paymentMethod: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'OTHER']),
    paymentReference: z.string().trim().max(150).optional() }).parse(req.body);
  const userId = req.auth!.userId;
  const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: null, status: 'PUBLISHED' } });
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  if (await prisma.directEnrollment.findFirst({ where: { userId, courseId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })) fail(409, 'ALREADY_ENROLLED', 'You already have access to this course.');
  const pending = await prisma.courseOrder.findFirst({ where: { userId, courseId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
  if (pending) fail(409, 'ORDER_PENDING', 'A purchase request is already awaiting review.');
  const order = await prisma.courseOrder.create({ data: { userId, courseId, amountPaise: course.pricePaise, paymentMethod, paymentReference, status: 'PENDING' } });
  res.status(201).json({ data: { id: order.id, status: order.status, message: 'Purchase request submitted. Admin will verify payment before access is enabled.' } });
}));

router.use('/admin', requirePlatform);
router.use('/admin', analyticsRoutes);
router.get('/admin/dashboard', asyncRoute(async (_req, res) => {
  const [students, courses, publishedCourses, activeEnrollments, manualEnrollments, pendingOrders, paidOrders] = await Promise.all([
    prisma.studentAccount.count(), prisma.course.count({ where: { tenantId: null } }),
    prisma.course.count({ where: { tenantId: null, status: 'PUBLISHED' } }),
    prisma.directEnrollment.count({ where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], course: { tenantId: null } } }),
    prisma.directEnrollment.count({ where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], source: 'MANUAL_PAYMENT', course: { tenantId: null } } }),
    prisma.courseOrder.count({ where: { status: 'PENDING', course: { tenantId: null } } }),
    prisma.courseOrder.aggregate({ where: { status: 'PAID', course: { tenantId: null } }, _sum: { amountPaise: true }, _count: true }),
  ]);
  res.json({ data: { students, courses, publishedCourses, activeEnrollments, manualEnrollments, pendingOrders,
    recordedRevenuePaise: paidOrders._sum.amountPaise || 0, recordedPayments: paidOrders._count } });
}));
router.get('/admin/students', asyncRoute(async (req, res) => {
  const { page, pageSize, skip, q } = pageInput(req.query);
  const where = q ? { OR: [{ studentCode: { contains: q, mode: 'insensitive' as const } }, { user: { OR: [
    { email: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } },
  ] } }] } : {};
  const [total, students] = await prisma.$transaction([
    prisma.studentAccount.count({ where }), prisma.studentAccount.findMany({ where, skip, take: pageSize,
      orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, email: true,
        directEnrollments: { where: { course: { tenantId: null } }, include: { course: { select: { title: true, modules: { where: { archivedAt: null }, include: { lessons: { where: { archivedAt: null }, select: { id: true } } } } } }, progress: { select: { lessonId: true } } } } } } } }),
  ]);
  sendList(res, students.map(s => ({ id: s.id, userId: s.userId, studentCode: s.studentCode, status: s.status,
    name: s.user.name, email: s.user.email, phone: s.phone, enrolledCourses: s.user.directEnrollments.map(e => {
      const lessonCount = e.course.modules.reduce((count, m) => count + m.lessons.length, 0);
      const visibleIds = new Set(e.course.modules.flatMap(m => m.lessons.map(l => l.id)));
      const completed = e.progress.filter(p => visibleIds.has(p.lessonId)).length;
      return { id: e.id, title: e.course.title, status: enrollmentStatus(e), expiresAt: e.expiresAt, source: e.source,
        completed, total: lessonCount, progressPercent: lessonCount ? Math.round(completed / lessonCount * 100) : 0 };
    }) })), total, page, pageSize);
}));
router.patch('/admin/students/:id', asyncRoute(async (req, res) => {
  const status = z.enum(['ACTIVE', 'DISABLED']).parse(req.body?.status);
  const record = await prisma.$transaction(async tx => {
    const student = await tx.studentAccount.update({ where: { id: id.parse(req.params.id) }, data: { status } });
    if (status === 'DISABLED') await tx.session.deleteMany({ where: { userId: student.userId } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'STUDENT_STATUS', entityType: 'StudentAccount', entityId: student.id, metadata: { status } } });
    return student;
  });
  res.json({ data: { id: record.id, status: record.status } });
}));
router.get('/admin/courses', asyncRoute(async (req, res) => {
  const { page, pageSize, skip, q } = pageInput(req.query);
  const where = { tenantId: null, ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}) };
  const [total, courses] = await prisma.$transaction([prisma.course.count({ where }),
    prisma.course.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' },
      include: { _count: { select: { directEnrollments: true, modules: true } } } })]);
  sendList(res, courses, total, page, pageSize);
}));
router.get('/admin/courses/:id', asyncRoute(async (req, res) => {
  const course = await prisma.course.findFirst({ where: { id: id.parse(req.params.id), tenantId: null },
    include: { modules: { orderBy: { position: 'asc' }, include: { lessons: { orderBy: { position: 'asc' } } } } } });
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  res.json({ data: course });
}));
router.post('/admin/courses', asyncRoute(async (req, res) => {
  const data = courseInput.parse(req.body);
  const course = await prisma.course.create({ data: { ...data, tenantId: null } });
  await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COURSE_CREATE', entityType: 'Course', entityId: course.id } });
  res.status(201).json({ data: course });
}));
router.delete('/admin/courses/:id', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const updated = await prisma.course.updateMany({ where: { id: courseId, tenantId: null }, data: { status: 'ARCHIVED' } });
  if (!updated.count) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COURSE_ARCHIVE', entityType: 'Course', entityId: courseId } });
  res.json({ data: { id: courseId, status: 'ARCHIVED' } });
}));
router.patch('/admin/courses/:id', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const data = courseInput.partial().parse(req.body);
  const course = await prisma.course.updateMany({ where: { id: courseId, tenantId: null }, data });
  if (!course.count) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  const result = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COURSE_UPDATE', entityType: 'Course', entityId: courseId } });
  res.json({ data: result });
}));
router.post('/admin/courses/:id/modules', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: null } });
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  const record = await prisma.courseModule.create({ data: { ...moduleInput.parse(req.body), courseId } });
  res.status(201).json({ data: record });
}));
router.patch('/admin/courses/:id/module-order', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  const ids = z.array(id).max(500).parse(req.body.ids);
  await prisma.$transaction(async tx => {
    const records = await tx.courseModule.findMany({ where: { courseId, course: { tenantId: null } }, select: { id: true } });
    if (ids.length !== records.length || new Set(ids).size !== ids.length || records.some(r => !ids.includes(r.id))) fail(422, 'INVALID_ORDER', 'Include every module exactly once.');
    for (const [position, moduleId] of ids.entries()) await tx.courseModule.update({ where: { id: moduleId }, data: { position } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'MODULES_REORDERED', entityType: 'Course', entityId: courseId } });
  });
  res.json({ data: { success: true } });
}));
router.patch('/admin/modules/:id/lesson-order', asyncRoute(async (req, res) => {
  const moduleId = id.parse(req.params.id);
  const ids = z.array(id).max(1000).parse(req.body.ids);
  await prisma.$transaction(async tx => {
    const records = await tx.lesson.findMany({ where: { moduleId, module: { course: { tenantId: null } } }, select: { id: true } });
    if (ids.length !== records.length || new Set(ids).size !== ids.length || records.some(r => !ids.includes(r.id))) fail(422, 'INVALID_ORDER', 'Include every lesson exactly once.');
    for (const [position, lessonId] of ids.entries()) await tx.lesson.update({ where: { id: lessonId }, data: { position } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'LESSONS_REORDERED', entityType: 'CourseModule', entityId: moduleId } });
  });
  res.json({ data: { success: true } });
}));
router.patch('/admin/modules/:id/archive', asyncRoute(async (req, res) => {
  const moduleId = id.parse(req.params.id);
  const archived = z.boolean().parse(req.body.archived);
  await prisma.$transaction(async tx => {
    const updated = await tx.courseModule.updateMany({ where: { id: moduleId, course: { tenantId: null } }, data: { archivedAt: archived ? new Date() : null } });
    if (!updated.count) fail(404, 'MODULE_NOT_FOUND', 'Module not found.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: archived ? 'MODULE_ARCHIVED' : 'MODULE_RESTORED', entityType: 'CourseModule', entityId: moduleId } });
  });
  res.json({ data: { success: true } });
}));
router.patch('/admin/lessons/:id/archive', asyncRoute(async (req, res) => {
  const lessonId = id.parse(req.params.id);
  const archived = z.boolean().parse(req.body.archived);
  await prisma.$transaction(async tx => {
    const updated = await tx.lesson.updateMany({ where: { id: lessonId, module: { course: { tenantId: null } } }, data: { archivedAt: archived ? new Date() : null } });
    if (!updated.count) fail(404, 'LESSON_NOT_FOUND', 'Lesson not found.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: archived ? 'LESSON_ARCHIVED' : 'LESSON_RESTORED', entityType: 'Lesson', entityId: lessonId } });
  });
  res.json({ data: { success: true } });
}));
router.patch('/admin/modules/:id', asyncRoute(async (req, res) => {
  const moduleId = id.parse(req.params.id);
  const record = await prisma.courseModule.updateMany({ where: { id: moduleId, course: { tenantId: null } }, data: moduleInput.partial().parse(req.body) });
  if (!record.count) fail(404, 'MODULE_NOT_FOUND', 'Module not found.');
  res.json({ data: await prisma.courseModule.findUniqueOrThrow({ where: { id: moduleId } }) });
}));
router.post('/admin/modules/:id/lessons', asyncRoute(async (req, res) => {
  const moduleId = id.parse(req.params.id);
  const module = await prisma.courseModule.findFirst({ where: { id: moduleId, course: { tenantId: null } } });
  if (!module) fail(404, 'MODULE_NOT_FOUND', 'Module not found.');
  const record = await prisma.lesson.create({ data: { ...lessonInput.parse(req.body), moduleId } });
  res.status(201).json({ data: record });
}));
router.patch('/admin/lessons/:id', asyncRoute(async (req, res) => {
  const lessonId = id.parse(req.params.id);
  const result = await prisma.lesson.updateMany({ where: { id: lessonId, module: { course: { tenantId: null } } }, data: lessonInput.partial().parse(req.body) });
  if (!result.count) fail(404, 'LESSON_NOT_FOUND', 'Lesson not found.');
  res.json({ data: await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } }) });
}));
router.get('/admin/orders', asyncRoute(async (req, res) => {
  const status = req.query.status ? z.enum(['PENDING', 'PAID', 'CANCELLED']).parse(req.query.status) : undefined;
  const orders = await prisma.courseOrder.findMany({ where: { course: { tenantId: null }, ...(status ? { status } : {}) },
    include: { course: { select: { title: true } }, user: { select: { name: true, email: true, directStudent: { select: { studentCode: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ data: orders });
}));
router.post('/admin/orders/:id/approve', asyncRoute(async (req, res) => {
  const orderId = id.parse(req.params.id);
  const note = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body);
  const adminId = req.auth!.userId;
  const order = await prisma.$transaction(async tx => {
    const order = await tx.courseOrder.findFirst({ where: { id: orderId, course: { tenantId: null } } });
    if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order not found.');
    if (order.status !== 'PENDING') fail(409, 'ORDER_NOT_PENDING', 'Order was already processed.');
    const current = await tx.directEnrollment.findUnique({ where: { userId_courseId: { userId: order.userId, courseId: order.courseId } } });
    if (current && enrollmentActive(current)) fail(409, 'ALREADY_ENROLLED', 'Student already has course access. Resolve the payment request separately.');
    const claimed = await tx.courseOrder.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'PAID', verifiedAt: new Date(), verifiedById: adminId, note: note.note } });
    if (claimed.count !== 1) fail(409, 'ORDER_CHANGED', 'Order already processed.');
    await tx.directEnrollment.upsert({ where: { userId_courseId: { userId: order.userId, courseId: order.courseId } },
      create: { userId: order.userId, courseId: order.courseId, source: 'MANUAL_PAYMENT', status: 'ACTIVE', grantedById: adminId, note: `Verified offline order ${orderId}` },
      update: { expiresAt: null, status: 'ACTIVE', source: 'MANUAL_PAYMENT', grantedById: adminId, revokedAt: null, note: `Verified offline order ${orderId}` } });
    await tx.auditLog.create({ data: { actorId: adminId, action: 'ORDER_MANUAL_VERIFY', entityType: 'CourseOrder', entityId: orderId, metadata: { courseId: order.courseId, userId: order.userId } } });
    return { ...order, status: 'PAID' };
  });
  res.json({ data: order });
}));
router.post('/admin/orders/:id/reject', asyncRoute(async (req, res) => {
  const orderId = id.parse(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const order = await tx.courseOrder.findFirst({ where: { id: orderId, course: { tenantId: null } } });
    if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const updated = await tx.courseOrder.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'CANCELLED', note: reason, verifiedById: req.auth!.userId, verifiedAt: new Date() } });
    if (!updated.count) fail(409, 'ORDER_ALREADY_PROCESSED', 'Order already processed.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'OFFLINE_ORDER_REJECT', entityType: 'CourseOrder', entityId: orderId, metadata: { reason } } });
    return { id: orderId, status: 'CANCELLED' };
  });
  res.json({ data: result });
}));
router.post('/admin/enrollments', asyncRoute(async (req, res) => {
  const input = grantInput.parse(req.body);
  const adminId = req.auth!.userId;
  const student = await prisma.studentAccount.findFirst({ where: { OR: [{ studentCode: input.studentCode }, { user: { email: input.studentCode.toLowerCase() } }] } });
  if (!student || student.status !== 'ACTIVE') fail(404, 'STUDENT_NOT_FOUND', 'Active student not found.');
  const course = await prisma.course.findFirst({ where: { id: input.courseId, tenantId: null, status: { not: 'ARCHIVED' } } });
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  const enrollment = await prisma.$transaction(async tx => {
    const current = await tx.directEnrollment.findUnique({ where: { userId_courseId: { userId: student.userId, courseId: course.id } } });
    if (current && enrollmentActive(current)) fail(409, 'ALREADY_ENROLLED', 'This student already has course access.');
    const record = await tx.directEnrollment.upsert({ where: { userId_courseId: { userId: student.userId, courseId: course.id } },
      create: { userId: student.userId, courseId: course.id, source: input.source, status: 'ACTIVE', grantedById: adminId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, note: input.note },
      update: { status: 'ACTIVE', source: input.source, revokedAt: null, grantedById: adminId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, note: input.note } });
    if (input.source === 'MANUAL_PAYMENT') {
      await tx.courseOrder.create({ data: { userId: student.userId, courseId: course.id, amountPaise: input.amountPaise!,
        paymentMethod: input.paymentMethod!, paymentReference: input.paymentReference, note: input.note,
        status: 'PAID', verifiedAt: new Date(), verifiedById: adminId } });
    }
    await tx.auditLog.create({ data: { actorId: adminId, action: 'COURSE_ACCESS_GRANT', entityType: 'DirectEnrollment', entityId: record.id,
      metadata: { studentCode: input.studentCode, courseId: course.id, source: input.source, expiresAt: input.expiresAt || null, note: input.note } } });
    return record;
  }, { isolationLevel: 'Serializable' });
  res.status(201).json({ data: enrollment });
}));
router.get('/admin/enrollments/:id/history', asyncRoute(async (req, res) => {
  const enrollmentId = id.parse(req.params.id);
  const enrollment = await prisma.directEnrollment.findFirst({ where: { id: enrollmentId, course: { tenantId: null } } });
  if (!enrollment) fail(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
  const history = await prisma.auditLog.findMany({ where: { entityType: 'DirectEnrollment', entityId: enrollmentId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const actors = await prisma.user.findMany({ where: { id: { in: history.map(h => h.actorId) } }, select: { id: true, name: true } });
  res.json({ data: history.map(h => ({ id: h.id, action: h.action, createdAt: h.createdAt, metadata: h.metadata, actor: actors.find(a => a.id === h.actorId)?.name || 'Former administrator' })) });
}));
router.post('/admin/enrollments/:id/restore', asyncRoute(async (req, res) => {
  const enrollmentId = id.parse(req.params.id);
  const input = z.object({ reason: z.string().trim().min(3).max(500), expiresAt: z.string().datetime().refine(v => new Date(v) > new Date()).nullable().optional() }).parse(req.body);
  await prisma.$transaction(async tx => {
    const current = await tx.directEnrollment.findFirst({ where: { id: enrollmentId, course: { tenantId: null } } });
    if (!current) fail(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
    if (current && enrollmentActive(current)) fail(409, 'ALREADY_ACTIVE', 'Course access is already active.');
    const student = await tx.studentAccount.findUnique({ where: { userId: current.userId } });
    if (student?.status !== 'ACTIVE') fail(409, 'STUDENT_DISABLED', 'Enable the student account before restoring access.');
    await tx.directEnrollment.update({ where: { id: enrollmentId }, data: { status: 'ACTIVE', revokedAt: null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, note: input.reason, grantedById: req.auth!.userId } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COURSE_ACCESS_RESTORE', entityType: 'DirectEnrollment', entityId: enrollmentId, metadata: { reason: input.reason, expiresAt: input.expiresAt || null } } });
  }, { isolationLevel: 'Serializable' });
  res.json({ data: { success: true } });
}));
router.post('/admin/enrollments/:id/revoke', asyncRoute(async (req, res) => {
  const enrollmentId = id.parse(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const record = await prisma.$transaction(async tx => {
    const current = await tx.directEnrollment.findFirst({ where: { id: enrollmentId, course: { tenantId: null } } });
    if (!current) fail(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
    if (current.status !== 'ACTIVE') fail(409, 'ALREADY_REVOKED', 'Course access has already been revoked.');
    const result = await tx.directEnrollment.updateMany({ where: { id: enrollmentId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date(), note: reason } });
    if (!result.count) fail(409, 'ENROLLMENT_CHANGED', 'Enrollment changed during request.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COURSE_ACCESS_REVOKE', entityType: 'DirectEnrollment', entityId: enrollmentId, metadata: { reason } } });
    return { id: enrollmentId, status: 'REVOKED' };
  });
  res.json({ data: record });
}));

export default router;
