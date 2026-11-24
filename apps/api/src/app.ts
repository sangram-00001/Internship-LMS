import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import certificateRoutes from './routes/certificates.js';
import assessmentRoutes from './routes/assessments.js';
import accountRoutes from './routes/account.js';
import academyRoutes from './routes/academy.js';
import { loadSession, requireCsrf } from './middleware/auth.js';
import { errorHandler, HttpError } from './lib/http.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/v1/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/v1/account', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/v1/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use((req, _res, next) => {
  // Origin validation protects public authentication mutations and supplements CSRF tokens.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== webOrigin) {
    return next(new HttpError(403, 'ORIGIN_INVALID', 'Request origin not allowed.'));
  }
  next();
});
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'aspireedge-api' }));
app.use(loadSession);
app.use((req, res, next) => {
  if (req.path === '/api/v1/auth/login' || req.path === '/api/v1/auth/invitations/accept') return next();
  return requireCsrf(req, res, next);
});
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/certificates', certificateRoutes);
app.use('/api/v1/assessments', assessmentRoutes);
app.use('/api/v1/academy', academyRoutes);
app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found.')));
app.use(errorHandler);
