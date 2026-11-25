import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { requireAuth, requirePlatform, requireStudent } from '../middleware/auth.js';
import { purchaseInput, orderInput, quotePurchase, createPurchase, processPurchase } from '../lib/commerce.js';
const router = Router(), id = z.string().uuid();
router.get('/bundles', asyncRoute(async (_req, res) => {
  const bundles = await prisma.courseBundle.findMany({ where: { published: true, courses: { every: { course: { tenantId: null, status: 'PUBLISHED' } } } }, include: { courses: { select: { course: { select: { id: true, title: true, pricePaise: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ data: bundles.filter(b => b.courses.length && b.pricePaise <= b.courses.reduce((n, c) => n + c.course.pricePaise, 0)) });
}));
router.get('/courses/:id/reviews', asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id);
  if (!await prisma.course.findFirst({ where: { id: courseId, tenantId: null, status: 'PUBLISHED' } })) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  res.json({ data: await prisma.courseReview.findMany({ where: { courseId, status: 'APPROVED' }, select: { id: true, rating: true, body: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) });
}));
router.use(requireAuth);
router.get('/student/wishlist', requireStudent, asyncRoute(async (req, res) => {
  res.json({ data: await prisma.wishlist.findMany({ where: { userId: req.auth!.userId, course: { tenantId: null, status: 'PUBLISHED' } }, include: { course: { select: { id: true, title: true, pricePaise: true, thumbnailUrl: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }) });
}));
router.put('/student/wishlist/:id', requireStudent, asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id), userId = req.auth!.userId;
  const { saved } = z.object({ saved: z.boolean() }).strict().parse(req.body);
  if (saved) {
    if (!await prisma.course.findFirst({ where: { id: courseId, tenantId: null, status: 'PUBLISHED' } })) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
    await prisma.wishlist.upsert({ where: { userId_courseId: { userId, courseId } }, create: { userId, courseId }, update: {} });
  } else await prisma.wishlist.deleteMany({ where: { userId, courseId } });
  res.json({ data: { saved } });
}));
router.post('/student/quote', requireStudent, asyncRoute(async (req, res) => {
  const quote = await quotePurchase(prisma, req.auth!.userId, purchaseInput.parse(req.body));
  res.json({ data: { title: quote.title, courses: quote.courses, subtotalPaise: quote.subtotalPaise, discountPaise: quote.discountPaise, totalPaise: quote.totalPaise, couponCode: quote.couponCode } });
}));
router.post('/student/orders', requireStudent, asyncRoute(async (req, res) => { res.status(201).json({ data: await createPurchase(req.auth!.userId, orderInput.parse(req.body)) }); }));
router.get('/student/orders', requireStudent, asyncRoute(async (req, res) => { res.json({ data: await prisma.orderGroup.findMany({ where: { userId: req.auth!.userId }, include: { orders: { select: { course: { select: { title: true } }, amountPaise: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) }); }));
router.post('/student/orders/:id/cancel', requireStudent, asyncRoute(async (req, res) => {
  await prisma.$transaction(async tx => {
    const groupId = id.parse(req.params.id);
    const updated = await tx.orderGroup.updateMany({ where: { id: groupId, userId: req.auth!.userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (!updated.count) fail(409, 'ORDER_NOT_PENDING', 'Pending purchase request not found.');
    await tx.courseOrder.updateMany({ where: { orderGroupId: groupId }, data: { status: 'CANCELLED', note: 'Cancelled by student' } });
  }, { isolationLevel: 'Serializable' }); res.json({ data: { success: true } });
}));
router.put('/student/reviews/:id', requireStudent, asyncRoute(async (req, res) => {
  const courseId = id.parse(req.params.id), userId = req.auth!.userId;
  const input = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().min(10).max(3000) }).strict().parse(req.body);
  if (!await prisma.courseOrder.findFirst({ where: { courseId, userId, status: 'PAID', amountPaise: { gt: 0 }, course: { tenantId: null, status: 'PUBLISHED' } } })) fail(403, 'PURCHASE_REQUIRED', 'A verified paid purchase is required to review this course.');
  res.json({ data: await prisma.courseReview.upsert({ where: { userId_courseId: { userId, courseId } }, create: { ...input, userId, courseId }, update: { ...input, status: 'PENDING' } }) });
}));
router.use('/admin', requirePlatform);
router.get('/admin', asyncRoute(async (_req, res) => {
  const [coupons, bundles, reviews, orders] = await Promise.all([prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }), prisma.courseBundle.findMany({ include: { courses: true }, orderBy: { createdAt: 'desc' }, take: 100 }), prisma.courseReview.findMany({ include: { course: { select: { title: true } }, user: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 500 }), prisma.orderGroup.findMany({ include: { user: { select: { name: true, directStudent: { select: { studentCode: true } } } }, orders: { select: { course: { select: { title: true } }, amountPaise: true, paymentMethod: true, paymentReference: true } } }, orderBy: { createdAt: 'desc' }, take: 100 })]);
  res.json({ data: { coupons, bundles, reviews, orders } });
}));
router.post('/admin/coupons', asyncRoute(async (req, res) => {
  const input = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/), kind: z.enum(['PERCENT', 'FIXED']), value: z.number().int().min(1).max(100000000), courseId: id.nullable(), expiresAt: z.string().datetime().nullable(), usageLimit: z.number().int().min(1).max(1000000).nullable() }).strict().refine(v => v.kind !== 'PERCENT' || v.value <= 100, 'Percentage cannot exceed 100.').parse(req.body);
  const record = await prisma.$transaction(async tx => {
    if (input.courseId && !await tx.course.findFirst({ where: { id: input.courseId, tenantId: null } })) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
    const created = await tx.coupon.create({ data: { ...input, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COUPON_CREATED', entityType: 'Coupon', entityId: created.id, metadata: input } }); return created;
  }); res.status(201).json({ data: record });
}));
router.patch('/admin/coupons/:id', asyncRoute(async (req, res) => {
  const input = z.object({ active: z.boolean() }).strict().parse(req.body), couponId = id.parse(req.params.id);
  await prisma.$transaction(async tx => { const changed = await tx.coupon.updateMany({ where: { id: couponId }, data: input }); if (!changed.count) fail(404, 'COUPON_NOT_FOUND', 'Coupon not found.'); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'COUPON_STATUS_CHANGED', entityType: 'Coupon', entityId: couponId, metadata: input } }); }); res.json({ data: { success: true } });
}));
router.post('/admin/bundles', asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(3).max(180), description: z.string().trim().max(3000), pricePaise: z.number().int().min(0).max(100000000), courseIds: z.array(id).min(2).max(20).refine(v => new Set(v).size === v.length), published: z.boolean() }).strict().parse(req.body);
  const bundle = await prisma.$transaction(async tx => {
    const courses = await tx.course.findMany({ where: { id: { in: input.courseIds }, tenantId: null, status: 'PUBLISHED' } });
    if (courses.length !== input.courseIds.length || input.pricePaise > courses.reduce((s, c) => s + c.pricePaise, 0)) fail(422, 'INVALID_BUNDLE', 'Choose published courses and a price no higher than their combined prices.');
    const created = await tx.courseBundle.create({ data: { title: input.title, description: input.description, pricePaise: input.pricePaise, published: input.published, courses: { create: input.courseIds.map(courseId => ({ courseId })) } } });
    await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'BUNDLE_CREATED', entityType: 'CourseBundle', entityId: created.id, metadata: input } }); return created;
  }); res.status(201).json({ data: bundle });
}));
router.patch('/admin/bundles/:id', asyncRoute(async (req, res) => {
  const input = z.object({ published: z.boolean() }).strict().parse(req.body), bundleId = id.parse(req.params.id);
  await prisma.$transaction(async tx => { const changed = await tx.courseBundle.updateMany({ where: { id: bundleId }, data: input }); if (!changed.count) fail(404, 'BUNDLE_NOT_FOUND', 'Bundle not found.'); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'BUNDLE_STATUS_CHANGED', entityType: 'CourseBundle', entityId: bundleId, metadata: input } }); }); res.json({ data: { success: true } });
}));
router.post('/admin/orders/:id/:action', asyncRoute(async (req, res) => {
  const action = z.enum(['approve', 'reject']).parse(req.params.action), groupId = id.parse(req.params.id);
  const { note } = z.object({ note: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
  res.json({ data: await prisma.$transaction(tx => processPurchase(tx, groupId, req.auth!.userId, action === 'approve', note), { isolationLevel: 'Serializable' }) });
}));
router.patch('/admin/reviews/:id', asyncRoute(async (req, res) => {
  const input = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().min(3).max(500) }).strict().parse(req.body), reviewId = id.parse(req.params.id);
  await prisma.$transaction(async tx => { const changed = await tx.courseReview.updateMany({ where: { id: reviewId }, data: { status: input.status } }); if (!changed.count) fail(404, 'REVIEW_NOT_FOUND', 'Review not found.'); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: 'REVIEW_MODERATED', entityType: 'CourseReview', entityId: reviewId, metadata: input } }); }); res.json({ data: { success: true } });
}));
export default router;
