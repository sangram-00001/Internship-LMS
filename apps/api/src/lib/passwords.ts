import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { fail } from './http.js';

export const newPasswordSchema = z.string().min(12).max(128);

export async function resetAdminPassword(db: PrismaClient, email: string, password: string) {
  const normalized = z.string().trim().email().parse(email).toLowerCase();
  newPasswordSchema.parse(password);
  const user = await db.user.findUnique({ where: { email: normalized } });
  if (!user || user.platformRole !== 'SUPER_ADMIN') {
    fail(404, 'ADMIN_NOT_FOUND', 'An existing administrator account is required.');
  }
  await replacePassword(db, user.id, user.passwordHash, password, 'ADMIN_PASSWORD_RECOVERED');
}

export async function replacePassword(
  db: PrismaClient, userId: string, previousHash: string | null,
  password: string, action: 'ADMIN_PASSWORD_RECOVERED' | 'PASSWORD_CHANGED',
) {
  const passwordHash = await argon2.hash(newPasswordSchema.parse(password));
  await db.$transaction(async tx => {
    const result = await tx.user.updateMany({
      where: { id: userId, passwordHash: previousHash }, data: { passwordHash },
    });
    if (result.count !== 1) fail(409, 'PASSWORD_CHANGED', 'Credentials changed. Please try again.');
    await tx.session.deleteMany({ where: { userId } });
    await tx.accountToken.updateMany({ where: { userId, purpose: 'RESET_PASSWORD', usedAt: null }, data: { usedAt: new Date() } });
    await tx.auditLog.create({ data: {
      actorId: userId, action, entityType: 'User', entityId: userId,
      metadata: { source: action === 'ADMIN_PASSWORD_RECOVERED' ? 'local-admin-command' : 'account-settings' },
    } });
  });
}
