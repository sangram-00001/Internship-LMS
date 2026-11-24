import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { requireAuth, requirePlatform, requireStudent } from '../middleware/auth.js';
import { certificateEligibility, certificateSnapshot, renderCertificate, templateInput } from '../lib/certificates.js';
const router = Router();
const id = z.string().uuid();
router.get('/verify/:id', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }), asyncRoute(async (req, res) => {
  const certificate = await prisma.certificate.findUnique({ where: { id: id.parse(req.params.id) } });
  if (!certificate) fail(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');
  const snapshot = certificateSnapshot.parse(certificate.snapshot);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { id: certificate.id, status: certificate.revokedAt ? 'REVOKED' : 'VALID', studentName: snapshot.studentName, courseTitle: snapshot.courseTitle, brandName: snapshot.brandName, issuedAt: certificate.issuedAt, revokedAt: certificate.revokedAt } });
}));
router.use(requireAuth);
router.get('/admin', requirePlatform, asyncRoute(async (_req, res) => {
  const [templates, certificates] = await Promise.all([prisma.certificateTemplate.findMany({ orderBy: { createdAt: 'desc' } }), prisma.certificate.findMany({ orderBy: { issuedAt: 'desc' }, take: 500 })]);
  res.json({ data: { templates, certificates } });
}));
router.post('/admin/templates', requirePlatform, asyncRoute(async (req, res) => {
  const input = templateInput.parse(req.body);
  const record = await prisma.$transaction(async tx => {
    const created = await tx.certificateTemplate.create({ data: input });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'CERTIFICATE_TEMPLATE_CREATED', entityType: 'CertificateTemplate', entityId: created.id, metadata: input } });
    return created;
  }); res.status(201).json({ data: record });
}));
router.put('/admin/courses/:id/template', requirePlatform, asyncRoute(async (req, res) => {
  const input = z.object({ templateId: id }).strict().parse(req.body), courseId = id.parse(req.params.id);
  await prisma.$transaction(async tx => {
    if (!await tx.certificateTemplate.findUnique({ where: { id: input.templateId } })) fail(404, 'TEMPLATE_NOT_FOUND', 'Template not found.');
    const updated = await tx.course.updateMany({ where: { id: courseId, tenantId: null }, data: { certificateTemplateId: input.templateId } });
    if (!updated.count) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'CERTIFICATE_TEMPLATE_ASSIGNED', entityType: 'Course', entityId: courseId, metadata: input } });
  }); res.json({ data: { success: true } });
}));
const enrollmentInput = z.object({ courseId: id, studentCode: z.string().trim().min(1).max(40) }).strict();
router.post('/admin/eligibility', requirePlatform, asyncRoute(async (req, res) => {
  const input = enrollmentInput.parse(req.body);
  const student = await prisma.studentAccount.findUnique({ where: { studentCode: input.studentCode } });
  if (!student) fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
  const check = await certificateEligibility(prisma, student.userId, input.courseId);
  res.json({ data: { studentName: check.enrollment.user.name, courseTitle: check.enrollment.course.title, eligible: check.eligible, reasons: check.reasons, completedLessons: check.completedLessons, totalLessons: check.totalLessons } });
}));
router.post('/admin/issue', requirePlatform, asyncRoute(async (req, res) => {
  const input = enrollmentInput.extend({ exceptionReason: z.string().trim().min(10).max(1000).optional() }).strict().parse(req.body);
  const student = await prisma.studentAccount.findUnique({ where: { studentCode: input.studentCode } });
  if (!student) fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
  const certificate = await prisma.$transaction(async tx => {
    const check = await certificateEligibility(tx, student.userId, input.courseId);
    const existing = await tx.certificate.findUnique({ where: { userId_courseId: { userId: student.userId, courseId: input.courseId } } });
    if (existing) return existing;
    if (!check.eligible && !input.exceptionReason) fail(409, 'NOT_ELIGIBLE', check.reasons.join(' '));
    const { template } = check;
    const created = await tx.certificate.create({ data: { userId: student.userId, courseId: input.courseId, issuedById: req.auth!.userId, exceptionReason: input.exceptionReason,
      snapshot: { studentName: check.enrollment.user.name, courseTitle: check.enrollment.course.title, templateId: template.id, brandName: template.brandName, signatory: template.signatory, accentColor: template.accentColor, verificationOrigin: new URL(process.env.WEB_ORIGIN || 'http://localhost:5173').origin,
        requirements: { requireAllLessons: template.requireAllLessons, requireQuizzes: template.requireQuizzes, requireAssignments: template.requireAssignments, assignmentPassPercent: template.assignmentPassPercent } },
    } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: input.exceptionReason ? 'CERTIFICATE_ISSUED_EXCEPTION' : 'CERTIFICATE_ISSUED', entityType: 'Certificate', entityId: created.id, metadata: { reasons: check.reasons, exceptionReason: input.exceptionReason || null, templateId: template.id } } });
    return created;
  }, { isolationLevel: 'Serializable' });
  res.status(201).json({ data: certificate });
}));
router.post('/admin/:id/revoke', requirePlatform, asyncRoute(async (req, res) => {
  const input = z.object({ reason: z.string().trim().min(10).max(1000) }).strict().parse(req.body), certificateId = id.parse(req.params.id);
  await prisma.$transaction(async tx => {
    const record = await tx.certificate.findUnique({ where: { id: certificateId } });
    if (!record) fail(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');
    const updated = await tx.certificate.updateMany({ where: { id: certificateId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: req.auth!.userId, revokeReason: input.reason } });
    if (updated.count) await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'CERTIFICATE_REVOKED', entityType: 'Certificate', entityId: certificateId, metadata: input } });
  }); res.json({ data: { success: true } });
}));
router.get('/student', requireStudent, asyncRoute(async (req, res) => {
  res.json({ data: await prisma.certificate.findMany({ where: { userId: req.auth!.userId }, orderBy: { issuedAt: 'desc' }, select: { id: true, snapshot: true, issuedAt: true, revokedAt: true } }) });
}));
router.get('/:id/pdf', asyncRoute(async (req, res) => {
  const record = await prisma.certificate.findUnique({ where: { id: id.parse(req.params.id) } });
  if (!record) fail(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');
  if (req.auth!.userId !== record.userId && (req.auth!.platformRole !== 'SUPER_ADMIN' || req.auth!.tenantId)) fail(403, 'FORBIDDEN', 'Certificate download is restricted to the student and administrator.');
  if (record.revokedAt) fail(409, 'CERTIFICATE_REVOKED', 'This certificate has been revoked.');
  const pdf = await renderCertificate(record);
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="aspireedge-certificate-${record.id}.pdf"`); res.send(pdf);
}));
export default router;
