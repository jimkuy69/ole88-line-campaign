import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { buildServer } from '../../src/server.js';

describe('HTTP boundary', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

  it('parses ADMIN_ONLY as an explicit boolean opt-in', () => {
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', ADMIN_ONLY: 'true' }).ADMIN_ONLY).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', ADMIN_ONLY: 'false' }).ADMIN_ONLY).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }).ADMIN_ONLY).toBe(false);
  });

  it('serves health without requiring database I/O', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never);
    servers.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
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
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ accepted: 0, duplicates: 0 });

    const denied = await app.inject({ method: 'POST', url: '/webhooks/line', headers: {
      'content-type': 'application/json', 'x-line-signature': 'invalid',
    }, payload: raw });
    expect(denied.statusCode).toBe(401);
  });
});
