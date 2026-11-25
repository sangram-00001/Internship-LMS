import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { enrollmentActive } from './enrollment.js';
import { fail } from './http.js';

export const templateInput = z.object({
  name: z.string().trim().min(3).max(80), brandName: z.string().trim().min(2).max(80),
  signatory: z.string().trim().min(2).max(80), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  requireAllLessons: z.boolean(), requireQuizzes: z.boolean(), requireAssignments: z.boolean(),
  assignmentPassPercent: z.number().int().min(1).max(100),
}).strict();
export const certificateSnapshot = z.object({ logoAsset: z.literal('aspireedge-20261125.jpg').optional(), studentName: z.string(), courseTitle: z.string(), brandName: z.string(), signatory: z.string(), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), templateId: z.string().uuid(), verificationOrigin: z.string().url(), requirements: z.object({ requireAllLessons: z.boolean(), requireQuizzes: z.boolean(), requireAssignments: z.boolean(), assignmentPassPercent: z.number() }) });

export async function certificateEligibility(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const enrollment = await tx.directEnrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, include: {
    user: { select: { name: true, directStudent: { select: { status: true } } } }, progress: { select: { lessonId: true } },
    course: { include: { certificateTemplate: true, modules: { where: { archivedAt: null }, select: { lessons: { where: { archivedAt: null }, select: { id: true } } } }, quizzes: { where: { published: true }, include: { attempts: { where: { userId, status: 'SUBMITTED', passed: true }, select: { id: true }, take: 1 } } }, assignments: { where: { published: true }, include: { submissions: { where: { userId }, orderBy: { submittedAt: 'desc' }, take: 1, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 1 } } } } } } },
  } });
  if (!enrollment || enrollment.course.tenantId !== null) fail(404, 'ENROLLMENT_NOT_FOUND', 'Student course enrollment not found.');
  if (!enrollmentActive(enrollment) || enrollment.user.directStudent?.status !== 'ACTIVE') fail(403, 'ACCESS_REQUIRED', 'An active student and active course enrollment are required.');
  const template = enrollment.course.certificateTemplate;
  if (!template) fail(409, 'TEMPLATE_REQUIRED', 'Assign a certificate template to this course first.');
  const lessons = enrollment.course.modules.flatMap(m => m.lessons);
  const completedIds = new Set(enrollment.progress.map(p => p.lessonId));
  const completed = lessons.filter(l => completedIds.has(l.id)).length;
  const unpassedQuizzes = enrollment.course.quizzes.filter(q => !q.attempts.length).map(q => q.title);
  const unpassedAssignments = enrollment.course.assignments.filter(a => {
    const review = a.submissions[0]?.reviews[0];
    return !review || review.score * 100 < a.maxScore * template.assignmentPassPercent;
  }).map(a => a.title);
  const reasons = [
    ...(template.requireAllLessons && (!lessons.length || completed !== lessons.length) ? [`Complete all lessons (${completed}/${lessons.length}).`] : []),
    ...(template.requireQuizzes && unpassedQuizzes.length ? [`Pass quizzes: ${unpassedQuizzes.join(', ')}.`] : []),
    ...(template.requireAssignments && unpassedAssignments.length ? [`Pass assignments: ${unpassedAssignments.join(', ')}.`] : []),
  ];
  return { enrollment, template, eligible: !reasons.length, reasons, completedLessons: completed, totalLessons: lessons.length };
}

export async function renderCertificate(record: { id: string; snapshot: unknown; issuedAt: Date; revokedAt: Date | null }) {
  const data = certificateSnapshot.parse(record.snapshot);
  if (!process.env.CERTIFICATE_FONT_PATH && /[^\x20-\x7E]/.test([data.studentName, data.courseTitle, data.brandName, data.signatory].join(''))) fail(503, 'CERTIFICATE_FONT_REQUIRED', 'Configure a certificate font supporting these characters before downloading.');
  const verifyUrl = `${data.verificationOrigin}/verify-certificate/${record.id}`;
  const qr = await QRCode.toBuffer(verifyUrl, { type: 'png', errorCorrectionLevel: 'M', width: 256, margin: 2 });
  const logo = data.logoAsset ? await readFile(new URL(`../../assets/${data.logoAsset}`, import.meta.url)) : null;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, info: { Title: 'AspireEdge course certificate', Author: data.brandName } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  if (process.env.CERTIFICATE_FONT_PATH) doc.font(process.env.CERTIFICATE_FONT_PATH);
  const width = doc.page.width, height = doc.page.height;
  doc.rect(22, 22, width - 44, height - 44).lineWidth(2).stroke(data.accentColor);
  doc.rect(30, 30, width - 60, height - 60).lineWidth(0.5).stroke('#ccd4e8');
  function centered(text: string, y: number, size: number, color = '#182744', maxHeight = 64) {
    doc.fontSize(size);
    while (doc.heightOfString(text, { width: width - 130 }) > maxHeight && size > 10) doc.fontSize(--size);
    doc.fillColor(color).text(text, 65, y, { width: width - 130, align: 'center', height: maxHeight, ellipsis: true });
  }
  if (logo) {
    const logoWidth = 260, logoHeight = 65, logoX = (width - logoWidth) / 2, logoY = 45;
    doc.save().rect(logoX, logoY, logoWidth, logoHeight).clip().image(logo, logoX, logoY - (logoWidth - logoHeight) / 2, {width: logoWidth}).restore();
    centered(data.brandName, 112, 10, data.accentColor, 16);
  } else centered(data.brandName, 63, 18, data.accentColor, 40);
  centered(record.revokedAt ? 'REVOKED CERTIFICATE' : 'CERTIFICATE OF COMPLETION', logo ? 140 : 120, 27, record.revokedAt ? '#b42318' : '#182744', 40);
  centered('This certifies that', 184, 12);
  centered(data.studentName, 214, 30);
  centered('has completed the course', 286, 12);
  centered(data.courseTitle, 317, 24);
  doc.fontSize(11).fillColor('#182744').text(`Issued ${record.issuedAt.toISOString().slice(0, 10)}`, 65, 414, { width: 380 });
  doc.text(data.signatory, 65, 441, { width: 380, height: 40, ellipsis: true });
  doc.fontSize(9).fillColor('#52627b').text('Authorized signatory', 65, 484);
  doc.image(qr, width - 180, 397, { width: 105, height: 105 });
  doc.fontSize(8).text('Scan to verify current status', width - 197, 509, { width: 140, align: 'center' });
  doc.fontSize(8).fillColor('#52627b').text(`Certificate ID: ${record.id}`, 65, 535, { width: width - 130 });
  doc.end();
  return result;
}
