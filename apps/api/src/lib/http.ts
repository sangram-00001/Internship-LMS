import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(
  status: number,
  code: string,
  message: string
): never {
  throw new HttpError(status, code, message);
}
export const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

export function pageInput(query: Request['query']) {
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 10));
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  return { page, pageSize, skip: (page - 1) * pageSize, q };
}

export const sendList = (res: Response, data: unknown[], total: number, page: number, pageSize: number) => {
  res.json({ data, meta: { total, page, pageSize, pages: Math.ceil(total / pageSize) } });
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'The request exceeds the allowed size.' } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: error.flatten() } });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') {
      res.status(409).json({ error: { code: 'CONCURRENT_CHANGE', message: 'This record changed during the request. Refresh and try again.' } });
      return;
    }
    if (error.code === 'P2002') {
      res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists.' } });
      return;
    }
    if (error.code === 'P2003') {
      res.status(409).json({ error: { code: 'RELATED_RECORD', message: 'Related record does not exist or cannot be removed.' } });
      return;
    }
  }
  // Never leak SQL, stack traces or credentials to the client.
  // ORM messages can include submitted credentials or recovery tokens.
  console.error('[ERROR]', error instanceof Error ? error.name : 'Unknown server error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } });
};
