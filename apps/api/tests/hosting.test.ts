import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
let folder: string;
let app: typeof import('../src/app.js').app;
const previous = process.env.WEB_DIST_PATH;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aspireedge-hosting-'));
  await writeFile(join(folder, 'index.html'), '<html><body>Hosting fixture</body></html>');
  await writeFile(join(folder, 'bundle.js'), '/* hosting fixture */');
  process.env.WEB_DIST_PATH = folder;
  app = (await import('../src/app.js')).app;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.WEB_DIST_PATH;
  else process.env.WEB_DIST_PATH = previous;
  await rm(folder, { recursive: true, force: true });
});
describe('single-origin hosting', () => {
  it('serves frontend deep links without requiring a session', async () => {
    const response = await request(app).get('/student/support').set('Accept', 'text/html');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Hosting fixture');
    expect(response.headers['cache-control']).toBe('no-cache');
  });
  it('serves built assets', async () => {
    expect((await request(app).get('/bundle.js')).text).toContain('hosting fixture');
  });
  it('keeps missing APIs and assets as errors instead of returning HTML', async () => {
    for (const path of ['/api/v1/missing', '/missing.js']) {
      const response = await request(app).get(path).set('Accept', 'text/html');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });
  it('preserves the health endpoint', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
  });
});
