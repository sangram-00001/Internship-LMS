import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { cookieConfig, cookieName, randomToken, SESSION_DURATION_MS, sha256 } from '../lib/security.js';
import { requireAuth } from '../middleware/auth.js';
import { queueAccountLink } from '../lib/account-tokens.js';

const router = Router();
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(1).max(128),
  tenantSlug: z.string().regex(/^[a-z0-9-]{2,50}$/).optional(),
});
const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  phone: z.string().trim().max(25).optional(),
  password: z.string().min(12).max(128),
  confirmPassword: z.string(),
}).strict().refine(v => v.password === v.confirmPassword, { message: 'Passwords must match', path: ['confirmPassword'] });

async function issueSession(userId: string, tenantId: string | null, res: import('express').Response) {
  const raw = randomToken();
  const csrfToken = randomToken();
  await prisma.session.create({ data: {
    tokenHash: sha256(raw), csrfToken, userId, tenantId,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  } });
  res.cookie(cookieName, raw, cookieConfig());
  return csrfToken;
}

router.post('/register', asyncRoute(async (req, res) => {
  const { name, email, phone, password } = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    fail(409, 'EMAIL_TAKEN', 'This email already has an account. Please sign in.');
  }
  const passwordHash = await argon2.hash(password);
  // Random student codes avoid exposing database sequence information. DB uniqueness enforces collision safety.
  const studentCode = 'STU' + randomBytes(6).toString('hex').toUpperCase();
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({ data: { email, name, passwordHash,
    directStudent: { create: { studentCode, phone: phone || null } },
    } });
    await queueAccountLink(created.id, email, 'VERIFY_EMAIL', tx);
    return created;
  });
  const csrfToken = await issueSession(user.id, null, res);
  res.status(201).json({ data: { user: { id: user.id, email, name }, studentCode, scope: 'STUDENT', csrfToken } });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const { email, password, tenantSlug } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
    fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (tenantSlug) fail(403, 'COMPANY_LOGIN_DISABLED', 'Company login is no longer supported in the student academy.');
  const tenantId: null = null;
  if (user.platformRole !== 'SUPER_ADMIN') {
    const student = await prisma.studentAccount.findUnique({ where: { userId: user.id } });
    if (!student || student.status !== 'ACTIVE') fail(403, 'ACCOUNT_UNAVAILABLE', 'Student account is unavailable.');
  }
  // Invalidate the old session if a user signs in again in the same browser.
  const oldCookie = req.cookies?.[cookieName];
  if (typeof oldCookie === 'string') await prisma.session.deleteMany({ where: { tokenHash: sha256(oldCookie) } });
  const csrfToken = await issueSession(user.id, tenantId, res);
  res.json({ data: { user: { id: user.id, name: user.name, email: user.email },
    scope: tenantId ? 'TENANT' : user.platformRole === 'SUPER_ADMIN' ? 'PLATFORM' : 'STUDENT', csrfToken } });
}));

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const auth = req.auth!;
  const [user, tenant] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true, email: true, directStudent: { select: { studentCode: true } } } }),
    auth.tenantId ? prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { id: true, name: true, slug: true } }) : Promise.resolve(null),
  ]);
  res.json({ data: { user, tenant, roles: auth.roles, scope: auth.tenantId ? 'TENANT' : auth.platformRole === 'SUPER_ADMIN' ? 'PLATFORM' : 'STUDENT', csrfToken: auth.csrfToken } });
}));

router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  const raw = req.cookies?.[cookieName];
  if (raw && typeof raw === 'string') {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(raw) } });
  }
  res.clearCookie(cookieName, { path: '/', sameSite: 'lax', secure: cookieConfig().secure });
  res.json({ data: { success: true } });
}));

export default router;
