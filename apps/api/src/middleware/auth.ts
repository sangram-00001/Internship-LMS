import type { RequestHandler } from 'express';
import { MembershipRole, PlatformRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { fail } from '../lib/http.js';
import { cookieName, sha256 } from '../lib/security.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        tenantId: string | null;
        csrfToken: string;
        platformRole: PlatformRole;
        roles: MembershipRole[];
      };
    }
  }
}

export const loadSession: RequestHandler = async (req, _res, next) => {
  try {
    const raw = req.cookies?.[cookieName];
    if (!raw || typeof raw !== 'string') { next(); return; }
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: { select: { id: true, platformRole: true, directStudent: { select: { status: true } } } }, tenant: { select: { status: true } } },
    });
    if (!session || session.expiresAt <= new Date()) { next(); return; }
    if (session.tenantId && session.tenant?.status !== 'ACTIVE') { next(); return; }
    if (!session.tenantId && session.user.platformRole !== 'SUPER_ADMIN' && session.user.directStudent?.status !== 'ACTIVE') { next(); return; }
    let roles: MembershipRole[] = [];
    if (session.tenantId) {
      const memberships = await prisma.tenantMembership.findMany({
        where: { userId: session.userId, tenantId: session.tenantId, status: 'ACTIVE' },
        select: { role: true },
      });
      roles = memberships.map(m => m.role);
      if (roles.length === 0) { next(); return; }
    }
    req.auth = { userId: session.userId, tenantId: session.tenantId,
      csrfToken: session.csrfToken, platformRole: session.user.platformRole, roles };
    next();
  } catch (error) { next(error); }
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(failError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
  next();
};
const failError = (status: number, code: string, message: string) => {
  try { fail(status, code, message); } catch (e) { return e as Error; }
};

export const requirePlatform: RequestHandler = (req, _res, next) => {
  if (!req.auth || req.auth.tenantId || req.auth.platformRole !== PlatformRole.SUPER_ADMIN) {
    return next(failError(403, 'FORBIDDEN', 'Platform administrator access required.'));
  }
  next();
};

export const requireTenant: RequestHandler = (req, _res, next) => {
  if (!req.auth?.tenantId || req.auth.roles.length === 0) {
    return next(failError(403, 'FORBIDDEN', 'Active company membership required.'));
  }
  next();
};

export const requireRoles = (...permitted: MembershipRole[]): RequestHandler => (req, _res, next) => {
  if (!req.auth || !permitted.some(r => req.auth!.roles.includes(r))) {
    return next(failError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
  }
  next();
};

export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  // Session-bearing mutations must include a token that cannot be supplied through ordinary cross-site forms.
  if (req.auth && req.header('x-csrf-token') !== req.auth.csrfToken) {
    return next(failError(403, 'CSRF_INVALID', 'Security token missing or invalid.'));
  }
  next();
};

export const requireStudent: RequestHandler = (req, _res, next) => {
  if (!req.auth || req.auth.tenantId || req.auth.platformRole === 'SUPER_ADMIN') {
    return next(failError(403, 'STUDENT_ONLY', 'Student account required.'));
  }
  next();
};
