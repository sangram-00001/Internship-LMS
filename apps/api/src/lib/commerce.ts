import { notifyStudent } from './notifications.js';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { fail } from './http.js';
import { enrollmentActive } from './enrollment.js';
const id = z.string().uuid();
export const purchaseInput = z.object({ courseId: id.optional(), bundleId: id.optional(), couponCode: z.string().trim().max(40).transform(s => s.toUpperCase()).optional() }).strict().refine(v => !!v.courseId !== !!v.bundleId, 'Choose one course or bundle.');
export const orderInput = z.object({ courseId: id.optional(), bundleId: id.optional(), couponCode: z.string().trim().max(40).transform(s => s.toUpperCase()).optional(), expectedTotalPaise: z.number().int().min(0).max(100000000).optional(), paymentMethod: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'OTHER']), paymentReference: z.string().trim().max(150).optional() }).strict().refine(v => !!v.courseId !== !!v.bundleId, 'Choose one course or bundle.');
export function discountedPrice(subtotal: number, coupon?: { kind: string; value: number } | null) {
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) throw new Error('Invalid subtotal.');
  if (coupon && (!Number.isSafeInteger(coupon.value) || coupon.value < 1 || !['PERCENT', 'FIXED'].includes(coupon.kind) || coupon.kind === 'PERCENT' && coupon.value > 100)) throw new Error('Invalid discount.');
  const discount = !coupon ? 0 : coupon.kind === 'PERCENT' ? Math.floor(subtotal * coupon.value / 100) : Math.min(subtotal, coupon.value);
  return { subtotalPaise: subtotal, discountPaise: discount, totalPaise: subtotal - discount };
}
export function allocatePrice(total: number, weights: number[]) {
  if (!Number.isSafeInteger(total) || total < 0 || !weights.length || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new Error('Invalid allocation.');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) { if (total) throw new Error('No priced courses.'); return weights.map(() => 0); }
  const amounts = weights.map(w => Number(BigInt(total) * BigInt(w) / BigInt(sum)));
  let remainder = total - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder; i++) { if (weights[i]! > 0) { amounts[i] = amounts[i]! + 1; remainder--; } }
  return amounts;
}
export async function quotePurchase(tx: Prisma.TransactionClient, userId: string, input: z.infer<typeof purchaseInput>) {
  let courses: { id: string; title: string; pricePaise: number }[], title: string, subtotal: number;
  if (input.bundleId) {
    const bundle = await tx.courseBundle.findUnique({ where: { id: input.bundleId }, include: { courses: { include: { course: true }, orderBy: { courseId: 'asc' } } } });
    if (!bundle?.published || !bundle.courses.length || bundle.courses.some(c => c.course.tenantId !== null || c.course.status !== 'PUBLISHED')) fail(404, 'BUNDLE_UNAVAILABLE', 'Bundle is unavailable.');
    courses = bundle.courses.map(c => c.course); title = bundle.title; subtotal = bundle.pricePaise;
    if (subtotal > courses.reduce((sum, c) => sum + c.pricePaise, 0)) fail(409, 'BUNDLE_PRICE_CHANGED', 'The administrator must update this bundle price.');
  } else {
    const course = await tx.course.findFirst({ where: { id: input.courseId!, status: 'PUBLISHED', tenantId: null }, select: { id: true, title: true, pricePaise: true } });
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
    courses = [course]; title = course.title; subtotal = course.pricePaise;
  }
  const current = await tx.directEnrollment.findMany({ where: { userId, courseId: { in: courses.map(c => c.id) } } });
  if (current.some(enrollmentActive)) fail(409, 'ALREADY_ENROLLED', 'You already have active access to a selected course.');
  const coupon = input.couponCode ? await tx.coupon.findUnique({ where: { code: input.couponCode } }) : null;
  if (input.couponCode) {
    if (!coupon?.active || coupon.expiresAt && coupon.expiresAt <= new Date() || coupon.courseId && (courses.length !== 1 || courses[0]!.id !== coupon.courseId)) fail(422, 'COUPON_UNAVAILABLE', 'Coupon is unavailable for this purchase.');
    const [used, mine] = await Promise.all([tx.orderGroup.count({ where: { couponId: coupon.id, status: { in: ['PENDING', 'PAID'] } } }), tx.orderGroup.count({ where: { couponId: coupon.id, userId, status: { in: ['PENDING', 'PAID'] } } })]);
    if (mine || coupon.usageLimit !== null && used >= coupon.usageLimit) fail(409, 'COUPON_LIMIT', 'Coupon usage limit reached. Cancel an unused pending request before trying again.');
  }
  return { title, courses: courses.map(c => ({ id: c.id, title: c.title, pricePaise: c.pricePaise })), couponId: coupon?.id || null, couponCode: coupon?.code || null, ...discountedPrice(subtotal, coupon) };
}
export async function createPurchase(userId: string, input: z.infer<typeof orderInput>) {
  return prisma.$transaction(async tx => {
    const quote = await quotePurchase(tx, userId, input);
    if (input.expectedTotalPaise !== undefined && input.expectedTotalPaise !== quote.totalPaise) fail(409, 'PRICE_CHANGED', 'The price changed. Review a fresh quote before requesting access.');
    const ids = quote.courses.map(c => c.id);
    if (await tx.courseOrder.findFirst({ where: { userId, courseId: { in: ids }, status: 'PENDING' } })) fail(409, 'REQUEST_EXISTS', 'A selected course already has a pending purchase request.');
    const amounts = allocatePrice(quote.totalPaise, quote.courses.map(c => c.pricePaise));
    return tx.orderGroup.create({ data: { userId, bundleId: input.bundleId, title: quote.title, couponId: quote.couponId, subtotalPaise: quote.subtotalPaise, discountPaise: quote.discountPaise, totalPaise: quote.totalPaise,
      orders: { create: quote.courses.map((c, i) => ({ userId, courseId: c.id, amountPaise: amounts[i]!, paymentMethod: input.paymentMethod, paymentReference: input.paymentReference })) },
    }, include: { orders: { select: { id: true, courseId: true, amountPaise: true } } } });
  }, { isolationLevel: 'Serializable' });
}
export async function processPurchase(tx: Prisma.TransactionClient, groupId: string, adminId: string, approve: boolean, note: string) {
  const group = await tx.orderGroup.findUnique({ where: { id: groupId }, include: { orders: true, user: { select: { directStudent: { select: { status: true } } } } } });
  if (!group || !group.orders.length) fail(404, 'ORDER_NOT_FOUND', 'Purchase request not found.');
  if (group.status !== 'PENDING' || group.orders.some(o => o.status !== 'PENDING')) fail(409, 'ORDER_PROCESSED', 'Purchase request was already processed.');
  if (approve && group.user.directStudent?.status !== 'ACTIVE') fail(409, 'STUDENT_DISABLED', 'Enable the student before granting access.');
  if (approve) {
    for (const order of group.orders) {
      const current = await tx.directEnrollment.findUnique({ where: { userId_courseId: { userId: order.userId, courseId: order.courseId } } });
      if (enrollmentActive(current)) fail(409, 'ALREADY_ENROLLED', 'A selected course already has active access. Resolve the request separately.');
      await tx.directEnrollment.upsert({ where: { userId_courseId: { userId: order.userId, courseId: order.courseId } }, create: { userId: order.userId, courseId: order.courseId, source: 'MANUAL_PAYMENT', grantedById: adminId, note }, update: { status: 'ACTIVE', expiresAt: null, revokedAt: null, source: 'MANUAL_PAYMENT', grantedById: adminId, note } });
    }
  }
  const status = approve ? 'PAID' : 'CANCELLED';
  await tx.orderGroup.update({ where: { id: groupId }, data: { status } });
  await tx.courseOrder.updateMany({ where: { orderGroupId: groupId }, data: { status, note, verifiedById: adminId, verifiedAt: new Date() } });
  await notifyStudent(tx, {userId:group.userId,eventKey:`purchase-decision:${groupId}`,title:approve?'Payment verified and courses unlocked':'Purchase request declined',body:approve?`Your manual purchase of ${group.title} is approved. All included courses are now available.`:`Your request for ${group.title} was declined. Contact support if you need help.`,path:approve?'/student':'/student/wishlist'});
  await tx.auditLog.create({ data: { actorId: adminId, action: approve ? 'PURCHASE_MANUAL_VERIFY' : 'PURCHASE_REJECTED', entityType: 'OrderGroup', entityId: groupId, metadata: { note, totalPaise: group.totalPaise, courses: group.orders.map(o => o.courseId) } } });
  return { id: groupId, status };
}
