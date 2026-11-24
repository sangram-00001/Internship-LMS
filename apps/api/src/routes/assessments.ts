import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { requireAuth, requirePlatform, requireStudent } from '../middleware/auth.js';
import { enrollmentActive } from '../lib/enrollment.js';
import { questionSchema, questionListSchema, answersSchema, gradeQuiz } from '../lib/assessment.js';
const router = Router();
router.use(requireAuth);
const id = z.string().uuid();
async function courseAccess(userId: string, courseId: string) {
  const enrollment = await prisma.directEnrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, include: { course: { select: { tenantId: true } } } });
  if (!enrollmentActive(enrollment) || enrollment?.course.tenantId !== null) fail(403, 'ACCESS_REQUIRED', 'Active course access is required.');
}
const quizInput = z.object({ courseId: id, title: z.string().trim().min(3).max(180), durationMinutes: z.number().int().min(1).max(180), maxAttempts: z.number().int().min(1).max(20), passPercent: z.number().int().min(1).max(100), published: z.boolean(), questions: questionListSchema }).strict();
const assignmentInput = z.object({ courseId: id, title: z.string().trim().min(3).max(180), instructions: z.string().trim().min(3).max(20000), dueAt: z.string().datetime().nullable(), published: z.boolean(), maxScore: z.number().int().min(1).max(1000) }).strict();
router.get('/admin', requirePlatform, asyncRoute(async (_req, res) => {
  const [quizzes, assignments, bank] = await Promise.all([
    prisma.quiz.findMany({ where: { course: { tenantId: null } }, include: { course: { select: { title: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.assignment.findMany({ where: { course: { tenantId: null } }, include: { course: { select: { title: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.questionBankItem.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
  ]); res.json({ data: { quizzes, assignments, bank } });
}));
router.post('/admin/questions', requirePlatform, asyncRoute(async (req, res) => {
  const question = questionSchema.parse(req.body);
  const record = await prisma.$transaction(async tx => {
    const created = await tx.questionBankItem.create({ data: { question } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'QUESTION_CREATED', entityType: 'QuestionBankItem', entityId: created.id } });
    return created;
  }); res.status(201).json({ data: record });
}));
router.post('/admin/quizzes', requirePlatform, asyncRoute(async (req, res) => {
  const data = quizInput.parse(req.body);
  if (!await prisma.course.findFirst({ where: { id: data.courseId, tenantId: null } })) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  const record = await prisma.$transaction(async tx => {
    const created = await tx.quiz.create({ data });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'QUIZ_CREATED', entityType: 'Quiz', entityId: created.id, metadata: { published: data.published } } });
    return created;
  }); res.status(201).json({ data: record });
}));
router.patch('/admin/quizzes/:id', requirePlatform, asyncRoute(async (req, res) => {
  const data = quizInput.omit({ courseId: true }).parse(req.body);
  await prisma.$transaction(async tx => {
    const quizId = id.parse(req.params.id);
    const result = await tx.quiz.updateMany({ where: { id: quizId, course: { tenantId: null } }, data });
    if (!result.count) fail(404, 'QUIZ_NOT_FOUND', 'Quiz not found.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'QUIZ_UPDATED', entityType: 'Quiz', entityId: quizId, metadata: { published: data.published } } });
  });
  res.json({ data: { success: true } });
}));
router.post('/admin/assignments', requirePlatform, asyncRoute(async (req, res) => {
  const input = assignmentInput.parse(req.body);
  if (!await prisma.course.findFirst({ where: { id: input.courseId, tenantId: null } })) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  const record = await prisma.$transaction(async tx => {
    const created = await tx.assignment.create({ data: { ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ASSIGNMENT_CREATED', entityType: 'Assignment', entityId: created.id, metadata: { published: input.published } } });
    return created;
  }); res.status(201).json({ data: record });
}));
router.get('/admin/assignments/:id/submissions', requirePlatform, asyncRoute(async (req, res) => {
  const submissions = await prisma.assignmentSubmission.findMany({ where: { assignmentId: id.parse(req.params.id), assignment: { course: { tenantId: null } } }, include: { user: { select: { name: true, email: true } }, reviews: { orderBy: { createdAt: 'desc' } } }, orderBy: { submittedAt: 'desc' } });
  res.json({ data: submissions });
}));
router.patch('/admin/assignments/:id', requirePlatform, asyncRoute(async (req, res) => {
  const input = assignmentInput.omit({ courseId: true }).parse(req.body);
  await prisma.$transaction(async tx => {
    const assignmentId = id.parse(req.params.id);
    const result = await tx.assignment.updateMany({ where: { id: assignmentId, course: { tenantId: null } }, data: { ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null } });
    if (!result.count) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ASSIGNMENT_UPDATED', entityType: 'Assignment', entityId: assignmentId, metadata: { published: input.published } } });
  });
  res.json({ data: { success: true } });
}));
router.post('/admin/submissions/:id/reviews', requirePlatform, asyncRoute(async (req, res) => {
  const data = z.object({ score: z.number().int().min(0), feedback: z.string().trim().min(1).max(10000) }).strict().parse(req.body);
  const submission = await prisma.assignmentSubmission.findFirst({ where: { id: id.parse(req.params.id), assignment: { course: { tenantId: null } } }, include: { assignment: true } });
  if (!submission) fail(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
  if (data.score > submission.assignment.maxScore) fail(422, 'INVALID_SCORE', 'Score exceeds assignment maximum.');
  const review = await prisma.$transaction(async tx => {
    const record = await tx.assignmentReview.create({ data: { ...data, submissionId: submission.id, reviewerId: req.auth!.userId } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'ASSIGNMENT_GRADED', entityType: 'AssignmentSubmission', entityId: submission.id, metadata: { score: data.score } } });
    return record;
  }); res.status(201).json({ data: review });
}));
router.get('/student', requireStudent, asyncRoute(async (req, res) => {
  const enrollments = await prisma.directEnrollment.findMany({ where: { userId: req.auth!.userId, course: { tenantId: null } } });
  const courseIds = enrollments.filter(enrollmentActive).map(e => e.courseId);
  const [quizzes, assignments] = await Promise.all([
    prisma.quiz.findMany({ where: { courseId: { in: courseIds }, published: true }, select: { id: true, title: true, durationMinutes: true, maxAttempts: true, passPercent: true, course: { select: { title: true } }, attempts: { where: { userId: req.auth!.userId }, select: { id: true, number: true, status: true, score: true, passed: true, expiresAt: true }, orderBy: { number: 'desc' } } } }),
    prisma.assignment.findMany({ where: { courseId: { in: courseIds }, published: true }, include: { course: { select: { title: true } }, submissions: { where: { userId: req.auth!.userId }, include: { reviews: { orderBy: { createdAt: 'desc' } } }, orderBy: { submittedAt: 'desc' } } } }),
  ]); res.json({ data: { quizzes, assignments } });
}));
router.post('/student/quizzes/:id/start', requireStudent, asyncRoute(async (req, res) => {
  const quizId = id.parse(req.params.id), userId = req.auth!.userId;
  const quiz = await prisma.quiz.findFirst({ where: { id: quizId, published: true, course: { tenantId: null } } });
  if (!quiz) fail(404, 'QUIZ_NOT_FOUND', 'Quiz not found.');
  await courseAccess(userId, quiz.courseId);
  const attempt = await prisma.$transaction(async tx => {
    const existing = await tx.quizAttempt.findMany({ where: { quizId, userId }, orderBy: { number: 'desc' } });
    const active = existing.find(a => a.status === 'IN_PROGRESS' && a.expiresAt > new Date()); if (active) return active;
    await tx.quizAttempt.updateMany({ where: { quizId, userId, status: 'IN_PROGRESS', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', score: 0, submittedAt: new Date() } });
    if (existing.length >= quiz.maxAttempts) fail(409, 'ATTEMPT_LIMIT', 'You have used all quiz attempts.');
    return tx.quizAttempt.create({ data: { quizId, userId, number: existing.length + 1, expiresAt: new Date(Date.now() + quiz.durationMinutes * 60000), snapshot: { questions: questionListSchema.parse(quiz.questions), passPercent: quiz.passPercent } } });
  }, { isolationLevel: 'Serializable' });
  const snapshot = z.object({ questions: questionListSchema }).parse(attempt.snapshot);
  res.json({ data: { id: attempt.id, expiresAt: attempt.expiresAt, answers: attempt.answers || [], questions: snapshot.questions.map(q => ({ id: q.id, prompt: q.prompt, kind: q.kind, choices: q.choices })) } });
}));
router.put('/student/attempts/:id/answers', requireStudent, asyncRoute(async (req, res) => {
  const input = z.object({ answers: answersSchema }).strict().parse(req.body);
  const attempt = await prisma.quizAttempt.findFirst({ where: { id: id.parse(req.params.id), userId: req.auth!.userId }, include: { quiz: { select: { courseId: true } } } });
  if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.');
  await courseAccess(req.auth!.userId, attempt.quiz.courseId);
  const snapshot = z.object({ questions: questionListSchema }).parse(attempt.snapshot);
  try { gradeQuiz(snapshot.questions, input.answers); } catch { fail(422, 'INVALID_ANSWERS', 'Answers do not match this quiz.'); }
  const updated = await prisma.quizAttempt.updateMany({ where: { id: attempt.id, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } }, data: { answers: input.answers } });
  if (!updated.count) fail(409, 'ATTEMPT_CLOSED', 'This quiz attempt is closed.');
  res.json({ data: { success: true } });
}));
router.post('/student/attempts/:id/submit', requireStudent, asyncRoute(async (req, res) => {
  const input = z.object({ answers: answersSchema }).strict().parse(req.body);
  const attemptId = id.parse(req.params.id), userId = req.auth!.userId;
  const current = await prisma.quizAttempt.findFirst({ where: { id: attemptId, userId }, include: { quiz: { select: { courseId: true } } } });
  if (!current) fail(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.');
  await courseAccess(userId, current.quiz.courseId);
  const snapshot = z.object({ questions: questionListSchema, passPercent: z.number() }).parse(current.snapshot);
  let score: number;
  try { score = gradeQuiz(snapshot.questions, input.answers); } catch { fail(422, 'INVALID_ANSWERS', 'Answers do not match this quiz attempt.'); }
  const result = await prisma.$transaction(async tx => {
    const expired = current.expiresAt <= new Date();
    await tx.quizAttempt.updateMany({ where: { id: attemptId, userId, status: 'IN_PROGRESS' }, data: { status: expired ? 'EXPIRED' : 'SUBMITTED', answers: input.answers, score: expired ? 0 : score, passed: !expired && score >= snapshot.passPercent, submittedAt: new Date() } });
    return tx.quizAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { id: true, status: true, score: true, passed: true } });
  }); res.json({ data: result });
}));
const submissionFolder = () => resolve(process.env.LOCAL_STORAGE_PATH || '.local-storage', 'submissions');
router.post('/student/assignments/:id/files', requireStudent, express.raw({ type: 'application/pdf', limit: '10mb' }), asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production') fail(503, 'STORAGE_UNCONFIGURED', 'Production file storage is not configured.');
  const assignment = await prisma.assignment.findFirst({ where: { id: id.parse(req.params.id), published: true } });
  if (!assignment) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  await courseAccess(req.auth!.userId, assignment.courseId);
  if (assignment.dueAt && assignment.dueAt <= new Date()) fail(409, 'DEADLINE_PASSED', 'The assignment deadline has passed.');
  if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== '%PDF-') fail(422, 'INVALID_FILE', 'Upload a PDF file.');
  const fileId = randomUUID(); await mkdir(submissionFolder(), { recursive: true, mode: 0o700 });
  await writeFile(resolve(submissionFolder(), `${fileId}.pdf`), req.body, { mode: 0o600, flag: 'wx' });
  await writeFile(resolve(submissionFolder(), `${fileId}.json`), JSON.stringify({ assignmentId: assignment.id, userId: req.auth!.userId }), { mode: 0o600, flag: 'wx' });
  res.status(201).json({ data: { fileId } });
}));
router.post('/student/assignments/:id/submissions', requireStudent, asyncRoute(async (req, res) => {
  const input = z.object({ text: z.string().trim().max(20000).optional(), fileId: id.optional() }).strict().refine(v => !!v.text || !!v.fileId, 'Add text or a PDF file.').parse(req.body);
  const assignment = await prisma.assignment.findFirst({ where: { id: id.parse(req.params.id), published: true } });
  if (!assignment) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  await courseAccess(req.auth!.userId, assignment.courseId);
  if (assignment.dueAt && assignment.dueAt <= new Date()) fail(409, 'DEADLINE_PASSED', 'The assignment deadline has passed.');
  if (input.fileId) {
    let meta; try { meta = JSON.parse(await readFile(resolve(submissionFolder(), `${input.fileId}.json`), 'utf8')); } catch { fail(422, 'INVALID_FILE', 'File is unavailable.'); }
    if (meta.userId !== req.auth!.userId || meta.assignmentId !== assignment.id) fail(403, 'FORBIDDEN', 'This file does not belong to your assignment.');
  }
  const submission = await prisma.$transaction(async tx => {
    if (await tx.assignmentSubmission.count({ where: { assignmentId: assignment.id, userId: req.auth!.userId } }) >= 10) fail(409, 'SUBMISSION_LIMIT', 'Maximum ten submissions per assignment.');
    return tx.assignmentSubmission.create({ data: { ...input, assignmentId: assignment.id, userId: req.auth!.userId } });
  }, { isolationLevel: 'Serializable' }); res.status(201).json({ data: submission });
}));
router.get('/submissions/:id/file', asyncRoute(async (req, res) => {
  const submission = await prisma.assignmentSubmission.findFirst({ where: { id: id.parse(req.params.id), assignment: { course: { tenantId: null } } } });
  if (!submission?.fileId) fail(404, 'FILE_NOT_FOUND', 'File not found.');
  if (req.auth!.userId !== submission.userId && (req.auth!.platformRole !== 'SUPER_ADMIN' || req.auth!.tenantId)) fail(403, 'FORBIDDEN', 'You cannot access this submission.');
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="assignment-submission.pdf"');
  res.sendFile(resolve(submissionFolder(), `${id.parse(submission.fileId)}.pdf`));
}));
export default router;
