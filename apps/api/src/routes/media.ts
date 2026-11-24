import { enrollmentActive } from '../lib/enrollment.js';
import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { requireAuth, requirePlatform } from '../middleware/auth.js';

const router = Router();
const storage = () => resolve(process.env.LOCAL_STORAGE_PATH || '.local-storage');
const metaSchema = z.object({ courseId: z.string().uuid(), mime: z.enum(['application/pdf', 'video/mp4', 'video/webm', 'image/png', 'image/jpeg']) });
function validSignature(data: Buffer, mime: string) {
  if (mime === 'application/pdf') return data.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'video/mp4') return data.subarray(4, 8).toString() === 'ftyp';
  if (mime === 'video/webm') return data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return data.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  return false;
}
router.post('/courses/:courseId', requireAuth, requirePlatform,
  express.raw({ type: ['application/pdf', 'video/mp4', 'video/webm', 'image/png', 'image/jpeg'], limit: '50mb' }),
  asyncRoute(async (req, res) => {
    if (process.env.NODE_ENV === 'production') fail(503, 'STORAGE_UNCONFIGURED', 'Production file storage is not configured.');
    const courseId = z.string().uuid().parse(req.params.courseId);
    const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: null } });
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
    const mime = req.header('Content-Type')?.split(';')[0] || '';
    if (!Buffer.isBuffer(req.body) || !req.body.length || !validSignature(req.body, mime)) fail(422, 'INVALID_FILE', 'Upload a valid PDF, MP4, WebM, PNG or JPEG file.');
    const assetId = randomUUID(); const directory = storage();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(directory, `${assetId}.bin`), req.body, { mode: 0o600, flag: 'wx' });
    await writeFile(resolve(directory, `${assetId}.json`), JSON.stringify({ courseId, mime }), { mode: 0o600, flag: 'wx' });
    await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COURSE_FILE_UPLOADED', entityType: 'Course', entityId: courseId, metadata: { assetId, mime, bytes: req.body.length } } });
    const origin = process.env.API_ORIGIN || 'http://localhost:4000';
    res.status(201).json({ data: { url: `${origin}/api/v1/media/${assetId}`, mime } });
  }));
router.get('/:id', asyncRoute(async (req, res) => {
  const assetId = z.string().uuid().parse(req.params.id);
  let meta: z.infer<typeof metaSchema>;
  try { meta = metaSchema.parse(JSON.parse(await readFile(resolve(storage(), `${assetId}.json`), 'utf8'))); }
  catch { fail(404, 'FILE_NOT_FOUND', 'File not found.'); }
  const url = `${process.env.API_ORIGIN || 'http://localhost:4000'}/api/v1/media/${assetId}`;
  const course = await prisma.course.findFirst({ where: { id: meta.courseId, tenantId: null },
    select: { status: true, thumbnailUrl: true, modules: { where: { archivedAt: null }, select: { lessons: { where: { contentUrl: url, archivedAt: null }, select: { isPreview: true } } } } } });
  if (!course) fail(404, 'FILE_NOT_FOUND', 'File not found.');
  const isAdmin = req.auth?.platformRole === 'SUPER_ADMIN' && !req.auth.tenantId;
  const attached = course.modules.some(m => m.lessons.length > 0);
  const isPublic = course.status === 'PUBLISHED' && (
    (meta.mime.startsWith('image/') && course.thumbnailUrl === url) || course.modules.some(m => m.lessons.some(l => l.isPreview))
  );
  let enrolled = false;
  if (!isAdmin && !isPublic && attached && req.auth && !req.auth.tenantId) {
    const enrollment = await prisma.directEnrollment.findUnique({ where: { userId_courseId: { userId: req.auth.userId, courseId: meta.courseId } } });
    enrolled = enrollmentActive(enrollment);
  }
  if (!isAdmin && !isPublic && !enrolled) fail(403, 'ACCESS_REQUIRED', 'Active course access is required.');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Disposition', meta.mime === 'application/pdf' ? 'attachment; filename="course-resource.pdf"' : 'inline');
  res.sendFile(resolve(storage(), `${assetId}.bin`));
}));
export default router;
