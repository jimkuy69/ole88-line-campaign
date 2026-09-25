import Fastify from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema.js';
import { createDatabase } from './db/client.js';
import { loadConfig } from './config/env.js';
import { parseLineWebhook, normalizeLineEvent } from './integrations/line/events.js';
import { verifyLineSignature } from './integrations/line/signature.js';
import { DrizzleWebhookEventStore, WebhookInbox } from './modules/webhooks/webhook-inbox.js';
import { createWebhookEventProcessor } from './modules/webhooks/webhook-processor.js';
import { registerAdminRoutes } from './modules/admin/admin-routes.js';

type Db = NodePgDatabase<typeof schema>;

export function buildServer(config: ReturnType<typeof loadConfig>, db: Db, processor = createWebhookEventProcessor(db, config.LINE_CHANNEL_ACCESS_TOKEN ?? '')) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 1024 * 1024 });
  app.setErrorHandler((error, _request, reply) => {
    const failure=error as Error&{statusCode?:number};
    app.log.error({ errorName:failure.name, statusCode:failure.statusCode }, 'Request failed');
    return reply.code(failure.statusCode ?? 500).send({ error:'Internal Server Error' });
  });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
  let processingTimer: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    processingTimer = setInterval(() => {
      void processor.recoverExpiredWork().then(() => processor.processPending()).catch((error: unknown) => {
        app.log.error({ errorName: error instanceof Error ? error.name : 'PROCESSOR_ERROR' }, 'Webhook processor cycle failed');
      });
    }, 1000);
    processingTimer.unref();
  });
  app.addHook('onClose', async () => { if (processingTimer) clearInterval(processingTimer); });
  app.get('/health', async () => ({ status: 'ok' }));
  registerAdminRoutes(app, db, config.NODE_ENV === 'production');

  app.post('/webhooks/line', async (request, reply) => {
    if (!config.LINE_CHANNEL_SECRET) return reply.code(503).send({ error: 'LINE webhook is not configured' });
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ error: 'Expected raw JSON body' });
    const signatureHeader = request.headers['x-line-signature'];
    const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;
    if (!verifyLineSignature(rawBody, signature, config.LINE_CHANNEL_SECRET)) {
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }
    let envelope;
    try {
      envelope = parseLineWebhook(JSON.parse(rawBody.toString('utf8')) as unknown);
    } catch {
      return reply.code(400).send({ error: 'Invalid webhook payload' });
    }
    const result = await inbox.acceptLineEvents(envelope.events.map(normalizeLineEvent));
    return reply.code(202).send(result);
  });
  return app;
}

async function main() {
  const config = loadConfig();
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const app = buildServer(config, db);
  const close = async () => { await app.close(); await pool.end(); };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await app.listen({ host: config.HOST, port: config.PORT });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Server startup failed'}\n`);
    process.exitCode = 1;
  });
}
