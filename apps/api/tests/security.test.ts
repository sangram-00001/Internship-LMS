import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { randomToken, sha256 } from '../src/lib/security.js';

describe('security primitives', () => {
  it('generates unpredictable tokens with adequate length', () => {
    const a = randomToken(), b = randomToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
    expect(sha256(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(a)).not.toBe(sha256(b));
  });
});

describe('public API surface', () => {
  it('responds to a health check', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
  it('blocks platform access without authentication', async () => {
    const response = await request(app).get('/api/v1/platform/dashboard');
    expect(response.status).toBe(404);
  });
  it('blocks tenant access without authentication', async () => {
    const response = await request(app).get('/api/v1/tenant/students');
    expect(response.status).toBe(404);
  });
  it('rejects mutating requests from untrusted browser origins', async () => {
    const response = await request(app).post('/api/v1/auth/login').set('Origin', 'https://attacker.invalid').send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_INVALID');
  });
});
