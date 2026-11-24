import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, fail } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { queueAccountLink, consumeAccountToken } from '../lib/account-tokens.js';
import { newPasswordSchema, replacePassword } from '../lib/passwords.js';
import { cookieName, cookieConfig } from '../lib/security.js';

const router = Router();
const emailInput = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()) });
const tokenInput = z.string().min(32).max(128);
router.post('/forgot-password', asyncRoute(async (req, res) => {
  const { email } = emailInput.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await queueAccountLink(user.id, email, 'RESET_PASSWORD');
  res.json({ data: { message: 'If an account exists, a password-reset email will be sent.' } });
}));
router.post('/reset-password', asyncRoute(async (req, res) => {
  const { token, password } = z.object({ token: tokenInput, password: newPasswordSchema }).parse(req.body);
  await consumeAccountToken(token, 'RESET_PASSWORD', password);
  res.clearCookie(cookieName, { path: '/', sameSite: 'lax', secure: cookieConfig().secure });
  res.json({ data: { success: true } });
}));
router.post('/verify-email', asyncRoute(async (req, res) => {
  const { token } = z.object({ token: tokenInput }).parse(req.body);
  await consumeAccountToken(token, 'VERIFY_EMAIL');
  res.json({ data: { success: true } });
}));
router.post('/verification-email', requireAuth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (!user.emailVerifiedAt) await queueAccountLink(user.id, user.email, 'VERIFY_EMAIL');
  res.json({ data: { message: 'Verification email requested.' } });
}));
router.get('/profile', requireAuth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId },
    select: { name: true, email: true, emailVerifiedAt: true, directStudent: { select: { phone: true, studentCode: true } } } });
  res.json({ data: user });
}));
router.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(25).optional() }).strict().parse(req.body);
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: req.auth!.userId }, data: { name: data.name } });
    if (data.phone !== undefined) await tx.studentAccount.updateMany({ where: { userId: req.auth!.userId }, data: { phone: data.phone } });
  });
  res.json({ data: { success: true } });
}));
router.post('/change-password', requireAuth, asyncRoute(async (req, res) => {
  const data = z.object({ currentPassword: z.string().min(1).max(128), password: newPasswordSchema }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (!user.passwordHash || !await argon2.verify(user.passwordHash, data.currentPassword)) fail(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  await replacePassword(prisma, user.id, user.passwordHash, data.password, 'PASSWORD_CHANGED');
  res.clearCookie(cookieName, { path: '/', sameSite: 'lax', secure: cookieConfig().secure });
  res.json({ data: { success: true } });
}));
export default router;
