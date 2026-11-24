import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail, pageInput, sendList } from '../lib/http.js';
import { requireAuth, requirePlatform } from '../middleware/auth.js';
import { audit, createInvitation } from '../services/invitations.js';

const router = Router();
router.use(requireAuth, requirePlatform);

const createCompany = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(50),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().email().max(254).transform(v => v.toLowerCase()),
  planId: z.string().uuid().optional(),
});
const companyUpdate = z.object({ name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional() }).refine(o => Object.keys(o).length > 0);

router.get('/dashboard', asyncRoute(async (_req, res) => {
  const [companies, activeCompanies, suspendedCompanies, students, trainers, internships, courses, subscriptions] = await Promise.all([
    prisma.tenant.count({ where: { status: { not: 'ARCHIVED' } } }),
    prisma.tenant.count({ where: { status: 'ACTIVE' } }),
    prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    prisma.student.count({ where: { status: 'ACTIVE' } }),
    prisma.trainer.count({ where: { status: 'ACTIVE' } }),
    prisma.internship.count({ where: { status: { not: 'ARCHIVED' } } }),
    prisma.course.count({ where: { status: { not: 'ARCHIVED' } } }),
    prisma.subscription.count({ where: { status: { in: ['TRIAL', 'ACTIVE'] } } }),
  ]);
  res.json({ data: { companies, activeCompanies, suspendedCompanies, students, trainers, internships, courses, subscriptions } });
}));

router.get('/plans', asyncRoute(async (_req, res) => {
  res.json({ data: await prisma.subscriptionPlan.findMany({ orderBy: { monthlyPricePaise: 'asc' } }) });
}));

router.get('/companies', asyncRoute(async (req, res) => {
  const { page, pageSize, skip, q } = pageInput(req.query);
  const where = { status: { not: 'ARCHIVED' as const }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { slug: { contains: q, mode: 'insensitive' as const } }] } : {}) };
  const [data, total] = await Promise.all([
    prisma.tenant.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' },
      include: { subscriptions: { include: { plan: true }, orderBy: { startsAt: 'desc' }, take: 1 },
        _count: { select: { students: true, trainers: true, courses: true } } } }),
    prisma.tenant.count({ where }),
  ]);
  sendList(res, data, total, page, pageSize);
}));

router.post('/companies', asyncRoute(async (req, res) => {
  const parsed = createCompany.parse(req.body);
  const plan = parsed.planId ? await prisma.subscriptionPlan.findUnique({ where: { id: parsed.planId } })
    : await prisma.subscriptionPlan.findUnique({ where: { name: 'Starter' } });
  if (!plan) fail(422, 'PLAN_NOT_FOUND', 'Choose a valid subscription plan. Run the database seed first.');
  const result = await prisma.$transaction(async tx => {
    const company = await tx.tenant.create({ data: { name: parsed.name, slug: parsed.slug } });
    const user = await tx.user.upsert({ where: { email: parsed.adminEmail }, update: {},
      create: { email: parsed.adminEmail, name: parsed.adminName } });
    await tx.tenantMembership.create({ data: { userId: user.id, tenantId: company.id, role: 'COMPANY_ADMIN', status: 'DISABLED' } });
    await tx.subscription.create({ data: { tenantId: company.id, planId: plan.id, status: 'TRIAL',
      endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } });
    const invitationUrl = await createInvitation(tx, {
      tenantId: company.id, email: user.email, name: parsed.adminName, role: 'COMPANY_ADMIN',
    });
    return { company, invitationUrl };
  });
  await audit({ actorId: req.auth!.userId, tenantId: result.company.id, action: 'COMPANY_CREATED',
    entityType: 'Tenant', entityId: result.company.id });
  res.status(201).json({ data: result });
}));

router.get('/companies/:id', asyncRoute(async (req, res) => {
  const company = await prisma.tenant.findUnique({ where: { id: req.params.id },
    include: { subscriptions: { include: { plan: true }, orderBy: { startsAt: 'desc' }, take: 1 },
      memberships: { where: { role: 'COMPANY_ADMIN' }, select: { status: true, user: { select: { name: true, email: true } } } },
      _count: { select: { students: true, trainers: true, courses: true, internships: true, batches: true } } } });
  if (!company) fail(404, 'NOT_FOUND', 'Company not found.');
  res.json({ data: company });
}));

router.patch('/companies/:id', asyncRoute(async (req, res) => {
  const body = companyUpdate.parse(req.body);
  const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!existing) fail(404, 'NOT_FOUND', 'Company not found.');
  const updated = await prisma.tenant.update({ where: { id: existing.id }, data: body });
  await audit({ actorId: req.auth!.userId, tenantId: existing.id, action: 'COMPANY_UPDATED',
    entityType: 'Tenant', entityId: existing.id, metadata: { status: updated.status } });
  res.json({ data: updated });
}));

export default router;
