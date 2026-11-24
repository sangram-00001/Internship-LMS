import { beforeEach, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import { resetAdminPassword } from '../src/lib/passwords.js';

const tx = { user: { updateMany: vi.fn() }, session: { deleteMany: vi.fn() }, accountToken: { updateMany: vi.fn() }, auditLog: { create: vi.fn() } };
const db = { user: { findUnique: vi.fn() }, $transaction: vi.fn(async (fn) => fn(tx)) };
beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ id: 'admin', platformRole: 'SUPER_ADMIN', passwordHash: 'old-hash' });
  tx.user.updateMany.mockResolvedValue({ count: 1 });
});
describe('local admin recovery', () => {
  it('hashes the replacement, revokes sessions and audits within one transaction', async () => {
    const password = 'test-only-long-password';
    await resetAdminPassword(db as unknown as PrismaClient, ' ADMIN@example.com ', password);
    const update = tx.user.updateMany.mock.calls[0]![0];
    expect(await argon2.verify(update.data.passwordHash, password)).toBe(true);
    expect(update.where).toEqual({ id: 'admin', passwordHash: 'old-hash' });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'admin' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ADMIN_PASSWORD_RECOVERED' }) }));
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(password);
  });
  it.each([null, { id: 'student', platformRole: 'USER' }])('never creates or promotes a non-admin account', async user => {
    db.user.findUnique.mockResolvedValue(user);
    await expect(resetAdminPassword(db as unknown as PrismaClient, 'student@example.com', 'test-only-long-password')).rejects.toMatchObject({ code: 'ADMIN_NOT_FOUND' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects weak passwords before touching records', async () => {
    await expect(resetAdminPassword(db as unknown as PrismaClient, 'admin@example.com', 'short')).rejects.toThrow();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it('refuses a stale password replacement', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(resetAdminPassword(db as unknown as PrismaClient, 'admin@example.com', 'test-only-long-password')).rejects.toMatchObject({ code: 'PASSWORD_CHANGED' });
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });
});
