import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  user: { findUnique: vi.fn() },
  session: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  studentAccount: { findUnique: vi.fn() },
} }));
import { prisma } from '../src/lib/prisma.js';
import { app } from '../src/app.js';
beforeEach(() => vi.resetAllMocks());
describe('admin authentication', () => {
  it('accepts a valid Argon2 password and issues a protected admin session', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'admin', email: 'admin@example.com', name: 'Admin', platformRole: 'SUPER_ADMIN', passwordHash: await argon2.hash('test-only-long-password') } as never);
    const response = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'test-only-long-password' });
    expect(response.status).toBe(200);
    expect(response.body.data.scope).toBe('PLATFORM');
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(response.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    expect(response.body.data.user.passwordHash).toBeUndefined();
    expect(prisma.session.create).toHaveBeenCalledOnce();
  });
  it('returns the same error for a missing account or wrong password', async () => {
    const credentials = { email: 'admin@example.com', password: 'wrong-password' };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const absent = await request(app).post('/api/v1/auth/login').send(credentials);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash: await argon2.hash('test-only-long-password') } as never);
    const wrong = await request(app).post('/api/v1/auth/login').send(credentials);
    expect(absent.status).toBe(401);
    expect(wrong.body).toEqual(absent.body);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
  it('does not grant administrator access to ordinary users', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'student', platformRole: 'USER', passwordHash: await argon2.hash('test-only-long-password') } as never);
    vi.mocked(prisma.studentAccount.findUnique).mockResolvedValue(null);
    const response = await request(app).post('/api/v1/auth/login').send({ email: 'student@example.com', password: 'test-only-long-password', platformRole: 'SUPER_ADMIN' });
    expect(response.status).toBe(403);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
