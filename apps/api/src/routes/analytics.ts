import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { enrollmentStatus, enrollmentActive } from '../lib/enrollment.js';
import { csvRows } from '../lib/csv.js';
const router = Router();
router.get('/students/:id', asyncRoute(async (req, res) => {
  const student = await prisma.studentAccount.findUnique({ where: { id: z.string().uuid().parse(req.params.id) }, include: { user: { select: {
    name: true, email: true, createdAt: true, emailVerifiedAt: true,
    certificates: { select: { id: true, issuedAt: true, revokedAt: true, course: { select: { title: true } } }, orderBy: { issuedAt: 'desc' } },
    quizAttempts: { where: { quiz: { course: { tenantId: null } } }, select: { id: true, number: true, status: true, score: true, passed: true, submittedAt: true, quiz: { select: { title: true } } }, orderBy: { startedAt: 'desc' } },
    assignmentSubmissions: { where: { assignment: { course: { tenantId: null } } }, select: { id: true, submittedAt: true, assignment: { select: { title: true, maxScore: true } }, reviews: { select: { id: true, score: true, feedback: true, createdAt: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { submittedAt: 'desc' } },
    directEnrollments: { where: { course: { tenantId: null } }, include: { course: { select: { title: true, modules: { where: { archivedAt: null }, select: { lessons: { where: { archivedAt: null }, select: { id: true } } } } } }, progress: { include: { lesson: { select: { title: true, archivedAt: true } } } } } },
    directOrders: { where: { course: { tenantId: null } }, select: { id: true, amountPaise: true, status: true, paymentMethod: true, createdAt: true, course: { select: { title: true } } }, orderBy: { createdAt: 'desc' } },
  } } } });
  if (!student) fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
  const courses = student.user.directEnrollments.map(e => {
    const visibleIds = new Set(e.course.modules.flatMap(m => m.lessons.map(l => l.id)));
    const completed = e.progress.filter(p => visibleIds.has(p.lessonId)).length;
    return { id: e.id, courseId: e.courseId, title: e.course.title, status: enrollmentStatus(e), source: e.source, enrolledAt: e.createdAt, expiresAt: e.expiresAt, lastActivityAt: e.lastActivityAt,
      totalLessons: visibleIds.size, completedLessons: completed, progressPercent: visibleIds.size ? Math.round(completed / visibleIds.size * 100) : 0,
      completed: e.progress.map(p => ({ lessonId: p.lessonId, title: p.lesson.title, completedAt: p.completedAt, archived: !visibleIds.has(p.lessonId) })),
    };
  });
  res.json({ data: { id: student.id, studentCode: student.studentCode, name: student.user.name, email: student.user.email, phone: student.phone, status: student.status,
    registeredAt: student.user.createdAt, emailVerifiedAt: student.user.emailVerifiedAt, courses, payments: student.user.directOrders, certificates: student.user.certificates, quizzes: student.user.quizAttempts, assignments: student.user.assignmentSubmissions } });
}));
router.get('/reports/enrollments', asyncRoute(async (req, res) => {
  const input = z.object({ q: z.string().max(100).optional(), status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), sort: z.enum(['recent', 'student']).default('recent'), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
  if (input.from && input.to && input.from > input.to) fail(422, 'INVALID_RANGE', 'Start date must precede end date.');
  const now = new Date();
  const where = {
    course: { tenantId: null },
    ...(input.q ? { user: { OR: [{ name: { contains: input.q, mode: 'insensitive' as const } }, { email: { contains: input.q, mode: 'insensitive' as const } }, { directStudent: { studentCode: { contains: input.q, mode: 'insensitive' as const } } }] } } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) } } : {}),
    ...(input.status === 'REVOKED' ? { status: 'REVOKED' as const } : input.status === 'EXPIRED' ? { status: 'ACTIVE' as const, expiresAt: { lte: now } } : input.status === 'ACTIVE' ? { status: 'ACTIVE' as const, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : {}),
  };
  const records = await prisma.directEnrollment.findMany({ where, take: 5001, orderBy: input.sort === 'student' ? { user: { name: 'asc' } } : { createdAt: 'desc' }, include: {
    user: { select: { name: true, email: true, directStudent: { select: { studentCode: true } } } }, course: { select: { title: true, modules: { where: { archivedAt: null }, select: { lessons: { where: { archivedAt: null }, select: { id: true } } } } } }, progress: { select: { lessonId: true } },
  } });
  if (records.length > 5000) fail(422, 'REPORT_TOO_LARGE', 'Narrow the date range to export at most 5,000 enrollments.');
  const rows = records.map(e => { const ids = new Set(e.course.modules.flatMap(m => m.lessons.map(l => l.id))); const completed = e.progress.filter(p => ids.has(p.lessonId)).length;
    return { id: e.id, studentId: e.user.directStudent?.studentCode || '', name: e.user.name, email: e.user.email, course: e.course.title, status: enrollmentStatus(e), source: e.source, enrolledAt: e.createdAt, expiresAt: e.expiresAt, lastActivityAt: e.lastActivityAt, completed, total: ids.size, progressPercent: ids.size ? Math.round(completed / ids.size * 100) : 0 };
  });
  if (input.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="aspireedge-enrollments.csv"'); res.setHeader('Cache-Control', 'no-store');
    res.send(csvRows([['Student ID', 'Name', 'Email', 'Course', 'Status', 'Source', 'Enrolled at', 'Expiry', 'Last activity', 'Completed lessons', 'Total lessons', 'Progress %'], ...rows.map(r => [r.studentId, r.name, r.email, r.course, r.status, r.source, r.enrolledAt.toISOString(), r.expiresAt?.toISOString(), r.lastActivityAt?.toISOString(), r.completed, r.total, r.progressPercent])])); return;
  }
  res.json({ data: rows, summary: { enrollments: rows.length, active: records.filter(enrollmentActive).length, completed: rows.filter(r => r.status === 'ACTIVE' && r.total > 0 && r.completed === r.total).length } });
}));
export default router;
