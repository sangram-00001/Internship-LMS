import { prisma } from './prisma.js';
import { randomToken, sha256 } from './security.js';
import { fail } from './http.js';
import argon2 from 'argon2';
import { newPasswordSchema } from './passwords.js';
import type { Prisma } from '@prisma/client';

export async function queueAccountLink(userId: string, email: string, purpose: 'RESET_PASSWORD' | 'VERIFY_EMAIL', transaction?: Prisma.TransactionClient) {
  const raw = randomToken();
  const origin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  const path = purpose === 'RESET_PASSWORD' ? 'reset-password' : 'verify-email';
  const link = `${origin}/${path}#token=${raw}`;
  const enqueue = async (tx: Prisma.TransactionClient) => {
    await tx.accountToken.create({ data: {
      userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    } });
    await tx.emailJob.create({ data: { recipient: email,
      subject: purpose === 'RESET_PASSWORD' ? 'Reset your AspireEdge password' : 'Verify your AspireEdge email',
      body: `Open this link within 30 minutes: ${link}\nIf you did not request this, ignore this email.`,
    } });
  };
  if (transaction) await enqueue(transaction);
  else await prisma.$transaction(enqueue);
}

export async function consumeAccountToken(raw: string, purpose: 'RESET_PASSWORD' | 'VERIFY_EMAIL', password?: string) {
  const passwordHash = purpose === 'RESET_PASSWORD' ? await argon2.hash(newPasswordSchema.parse(password)) : undefined;
  await prisma.$transaction(async tx => {
    const token = await tx.accountToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt <= new Date()) {
      fail(400, 'INVALID_TOKEN', 'This link is invalid or expired. Request a new link.');
    }
    // Atomic claim prevents two concurrent requests from using the same link.
    const claimed = await tx.accountToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) fail(400, 'INVALID_TOKEN', 'This link has already been used.');
    await tx.user.update({ where: { id: token.userId }, data: passwordHash ? { passwordHash } : { emailVerifiedAt: new Date() } });
    await tx.accountToken.updateMany({ where: { userId: token.userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    if (passwordHash) await tx.session.deleteMany({ where: { userId: token.userId } });
    await tx.auditLog.create({ data: { actorId: token.userId, action: purpose, entityType: 'User', entityId: token.userId } });
  });
}
