import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('legacy company endpoints disabled', () => {
  it('does not expose former platform company management', async () => {
    const response = await request(app).get('/api/v1/platform/companies');
    expect(response.status).toBe(404);
  });
  it('does not expose former tenant management', async () => {
    const response = await request(app).get('/api/v1/tenant/students');
    expect(response.status).toBe(404);
  });
});
