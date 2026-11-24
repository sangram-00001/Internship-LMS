import { createHash, randomBytes } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const cookieName = 'aspireedge_session';
export const cookieConfig = () => ({
  httpOnly: true as const,
  secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_DURATION_MS,
});
