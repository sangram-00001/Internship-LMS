export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api/v1' : 'http://localhost:4000/api/v1');
let csrfToken = '';
export function setCsrf(value: string) { csrfToken = value; }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(options.method || 'GET') && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers },
  });
  let payload: any;
  try { payload = await response.json(); } catch { throw new ApiError(response.status, 'INVALID_RESPONSE', 'Could not read server response.'); }
  if (!response.ok) throw new ApiError(response.status, payload.error?.code || 'API_ERROR', payload.error?.message || 'Request failed.');
  return payload as T;
}
export type ApiOne<T> = { data: T };
export type ApiList<T> = { data: T[]; meta: { total: number; page: number; pageSize: number; pages: number } };
export const messageFromError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
