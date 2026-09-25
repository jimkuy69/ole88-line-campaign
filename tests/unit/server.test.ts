import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { buildServer } from '../../src/server.js';

describe('HTTP boundary', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

  it('serves health without requiring database I/O', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test' }), {} as never);
    servers.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
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
