import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { loadConfig } from '../../src/config/env.js';
import { buildServer } from '../../src/server.js';
import { CampaignAssetStorage } from '../../src/modules/campaigns/campaign-asset-storage.js';

describe('HTTP boundary', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('parses ADMIN_ONLY as an explicit boolean opt-in', () => {
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', ADMIN_ONLY: 'true' }).ADMIN_ONLY).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', ADMIN_ONLY: 'false' }).ADMIN_ONLY).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }).ADMIN_ONLY).toBe(false);
    expect(() => loadConfig({
      NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/test', PUBLIC_BASE_URL: 'https://campaign.example',
    })).toThrow('CAMPAIGN_ASSET_STORAGE_DIR');
    expect(loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', PUBLIC_BASE_URL: 'https://campaign.example',
      ADMIN_ORIGIN: 'http://127.0.0.1:3000',
    })).toMatchObject({ PUBLIC_BASE_URL: 'https://campaign.example', ADMIN_ORIGIN: 'http://127.0.0.1:3000' });
    expect(() => loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', ADMIN_ORIGIN: 'http://127.0.0.1:3000/admin',
    })).toThrow();
    expect(() => loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', ADMIN_ORIGIN: 'ftp://127.0.0.1:3000',
    })).toThrow();
  });

  it('serves health without requiring database I/O', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never);
    servers.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('serves the admin localization script with a JavaScript content type', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never);
    servers.push(app);
    const response = await app.inject({ method: 'GET', url: '/admin-i18n.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/javascript');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toContain('languageToggle');
  });

  it('serves the authenticated-admin hotspot planner source', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never);
    servers.push(app);
    const response = await app.inject({ method: 'GET', url: '/admin-image-hotspot-planner.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/javascript');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toContain('Validate and export handoff');
  });

  it('serves only the allowlisted campaign image assets', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never);
    servers.push(app);
    const image = await app.inject({ method: 'GET', url: '/campaign-images/ole88-promo.png' });
    const unknown = await app.inject({ method: 'GET', url: '/campaign-images/unlisted.png' });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.headers['cache-control']).toContain('public');
    expect(image.rawPayload.length).toBeGreaterThan(1_000);
    expect(unknown.statusCode).toBe(404);
  });

  it('serves uploaded campaign images only by opaque asset id and keeps upload behind Admin auth', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ole88-upload-route-'));
    directories.push(directory);
    const storage = new CampaignAssetStorage(directory);
    const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'white' } }).png().toBuffer();
    const asset = await storage.put('poster.png', 'image/png', image);
    const db = {
      select: () => ({
        from() { return this; },
        innerJoin() { return this; },
        where() { return this; },
        limit: async () => [],
      }),
    };
    const app = buildServer(loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', CAMPAIGN_ASSET_STORAGE_DIR: directory,
      PUBLIC_BASE_URL: 'https://campaign.example', ADMIN_ORIGIN: 'http://127.0.0.1:3000',
    }), db as never);
    servers.push(app);

    const publicImage = await app.inject({ method: 'GET', url: `/campaign-assets/${asset.assetId}` });
    const traversal = await app.inject({ method: 'GET', url: '/campaign-assets/..%2Fsecret' });
    const unauthenticatedUpload = await app.inject({
      method: 'POST',
      url: '/api/admin/campaign-assets',
      headers: { 'content-type': 'image/png', 'x-file-name': 'poster.png' },
      payload: image,
    });
    expect(publicImage.statusCode).toBe(200);
    expect(publicImage.headers['content-type']).toContain('image/png');
    expect(publicImage.headers['cache-control']).toContain('immutable');
    expect(publicImage.rawPayload).toEqual(image);
    expect(traversal.statusCode).toBe(404);
    expect(unauthenticatedUpload.statusCode).toBe(401);
  });

  it('accepts a verified image upload only with an Admin session and the session CSRF token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ole88-authenticated-upload-'));
    directories.push(directory);
    const db = {
      select: () => {
        const query = {
          from() { return this; },
          innerJoin() { return this; },
          where() { return this; },
          limit: async () => [{ session: { csrfToken: 'valid-csrf' }, user: { id: 'admin-id', username: 'admin' } }],
        };
        return query;
      },
    };
    const app = buildServer(loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', CAMPAIGN_ASSET_STORAGE_DIR: directory,
    }), db as never);
    servers.push(app);
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const headers = {
      cookie: 'ole88_admin_session=session-token',
      'content-type': 'image/png',
      'x-file-name': 'campaign%20poster.png',
    };
    const denied = await app.inject({
      method: 'POST', url: '/api/admin/campaign-assets',
      headers, payload: image,
    });
    const accepted = await app.inject({
      method: 'POST', url: '/api/admin/campaign-assets',
      headers: { ...headers, host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'x-csrf-token': 'valid-csrf' }, payload: image,
    });
    expect(denied.statusCode).toBe(403);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().asset).toMatchObject({
      originalFilename: 'campaign poster.png', contentType: 'image/png', width: 2, height: 2,
    });
    expect(accepted.json().imageUrl).toContain(`/campaign-assets/${accepted.json().asset.assetId}`);
    for (let index = 1; index < 20; index += 1) {
      const upload = await app.inject({
        method: 'POST', url: '/api/admin/campaign-assets',
        headers: { ...headers, 'x-csrf-token': 'valid-csrf' }, payload: image,
      });
      expect(upload.statusCode).toBe(200);
    }
    const throttled = await app.inject({
      method: 'POST', url: '/api/admin/campaign-assets',
      headers: { ...headers, 'x-csrf-token': 'valid-csrf' }, payload: image,
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['retry-after']).toBeDefined();
  });

  it('reports readiness only when PostgreSQL responds, without leaking connection details', async () => {
    const ready = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }),
      { execute: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as never);
    const unavailable = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }),
      { execute: vi.fn().mockRejectedValue(new Error('connection password must not appear')) } as never);
    servers.push(ready, unavailable);

    const success = await ready.inject({ method: 'GET', url: '/ready' });
    const failure = await unavailable.inject({ method: 'GET', url: '/ready' });
    expect(success.statusCode).toBe(200);
    expect(success.json()).toEqual({ status: 'ready' });
    expect(failure.statusCode).toBe(503);
    expect(failure.body).not.toContain('password');
    expect(failure.json()).toEqual({ status: 'not_ready' });
  });

  it('does not accept LINE webhooks or run the processor in ADMIN_ONLY mode', async () => {
    const secret = 'test-channel-secret';
    const processor = {
      recoverExpiredWork: vi.fn(),
      processPending: vi.fn(),
      quarantineStalePushes: vi.fn(),
      processReadyPushes: vi.fn(),
    };
    const app = buildServer(loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', LINE_CHANNEL_SECRET: secret,
      ADMIN_ONLY: 'true',
    }), {} as never, processor as never);
    servers.push(app);
    const raw = Buffer.from('{"events":[]}');
    const signature = createHmac('sha256', secret).update(raw).digest('base64');
    const response = await app.inject({ method: 'POST', url: '/webhooks/line', headers: {
      'content-type': 'application/json', 'x-line-signature': signature,
    }, payload: raw });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: expect.stringContaining('ADMIN_ONLY') });
    expect(processor.recoverExpiredWork).not.toHaveBeenCalled();
    expect(processor.processPending).not.toHaveBeenCalled();
    expect(processor.processReadyPushes).not.toHaveBeenCalled();
  });

  it('serializes processor cycles and waits for the running cycle on shutdown', async () => {
    let releaseCycle!: () => void;
    const processor = {
      recoverExpiredWork: vi.fn(() => new Promise<void>((resolve) => { releaseCycle = resolve; })),
      processPending: vi.fn().mockResolvedValue(0),
      quarantineStalePushes: vi.fn().mockResolvedValue(0),
      processReadyPushes: vi.fn().mockResolvedValue(0),
    };
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never, processor as never);
    servers.push(app);
    await app.ready();
    const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    await delay(1_200);
    expect(processor.recoverExpiredWork).toHaveBeenCalledTimes(1);
    await delay(1_100);
    expect(processor.recoverExpiredWork).toHaveBeenCalledTimes(1);

    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await delay(20);
    expect(closed).toBe(false);
    releaseCycle();
    await closing;
    expect(processor.processPending).toHaveBeenCalledTimes(1);
    const index = servers.indexOf(app);
    if (index >= 0) servers.splice(index, 1);
  });

  it('verifies the LINE signature before accepting webhook events', async () => {
    const secret = 'test-channel-secret';
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', LINE_CHANNEL_SECRET: secret }), {} as never);
    servers.push(app);
    const raw = Buffer.from('{"events":[]}');
    const signature = createHmac('sha256', secret).update(raw).digest('base64');
    const accepted = await app.inject({ method: 'POST', url: '/webhooks/line', headers: {
      'content-type': 'application/json', 'x-line-signature': signature,
    }, payload: raw });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: 0, duplicates: 0 });

    const denied = await app.inject({ method: 'POST', url: '/webhooks/line', headers: {
      'content-type': 'application/json', 'x-line-signature': 'invalid',
    }, payload: raw });
    expect(denied.statusCode).toBe(401);
  });
});
