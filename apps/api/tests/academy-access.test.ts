import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  session: { findUnique: vi.fn() },
  directEnrollment: { findUnique: vi.fn() },
  course: { findFirst: vi.fn() },
} }));
import { prisma } from '../src/lib/prisma.js';
import { app } from '../src/app.js';

const db = prisma as unknown as {
  session: { findUnique: ReturnType<typeof vi.fn> };
  directEnrollment: { findUnique: ReturnType<typeof vi.fn> };
  course: { findFirst: ReturnType<typeof vi.fn> };
};
const courseId = 'b7dc1b53-a4c8-4ae0-9a86-af4d5ee5462c';
const cookie = 'aspireedge_session=test-session';

beforeEach(() => {
  vi.resetAllMocks();
  db.session.findUnique.mockResolvedValue({
    userId: 'student-a', tenantId: null, csrfToken: 'known-csrf',
    expiresAt: new Date(Date.now() + 60000),
    user: { platformRole: 'USER', directStudent: { status: 'ACTIVE' } }, tenant: null,
  });
  db.directEnrollment.findUnique.mockResolvedValue(null);
});

describe('direct student enrollment security', () => {
  it('rejects access to paid lessons when not enrolled', async () => {
    const response = await request(app).get(`/api/v1/academy/student/courses/${courseId}`).set('Cookie', cookie);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCESS_REQUIRED');
    expect(db.directEnrollment.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_courseId: { userId: 'student-a', courseId } },
    }));
    expect(db.course.findFirst).not.toHaveBeenCalled();
  });
  it('rejects revoked student enrollment', async () => {
    db.directEnrollment.findUnique.mockResolvedValue({ status: 'REVOKED', progress: [] });
    const response = await request(app).get(`/api/v1/academy/student/courses/${courseId}`).set('Cookie', cookie);
    expect(response.status).toBe(403);
    expect(db.course.findFirst).not.toHaveBeenCalled();
  });
  it('blocks student accounts from platform course creation', async () => {
    const response = await request(app).post('/api/v1/academy/admin/courses')
      .set('Cookie', cookie).set('X-CSRF-Token', 'known-csrf')
      .send({ title: 'Unauthorized course', pricePaise: 1000 });
    expect(response.status).toBe(403);
  });
  it('blocks unauthenticated admin access', async () => {
    db.session.findUnique.mockResolvedValue(null);
    const response = await request(app).get('/api/v1/academy/admin/dashboard');
    expect(response.status).toBe(401);
  });
});
