import Fastify, { type FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema.js';
import { createDatabase } from './db/client.js';
import { loadConfig } from './config/env.js';
import { parseLineWebhook, normalizeLineEvent } from './integrations/line/events.js';
import { verifyLineSignature } from './integrations/line/signature.js';
import { DrizzleWebhookEventStore, WebhookInbox } from './modules/webhooks/webhook-inbox.js';
import { createWebhookEventProcessor, type WebhookEventProcessor } from './modules/webhooks/webhook-processor.js';
import { registerAdminRoutes } from './modules/admin/admin-routes.js';
import { FileSystemEvidenceStorage } from './modules/evidence/storage.js';
import { CampaignAssetStorage, CAMPAIGN_ASSET_MAX_BYTES } from './modules/campaigns/campaign-asset-storage.js';

type Db = NodePgDatabase<typeof schema>;
const READINESS_TIMEOUT_MS = 2_000;
const SHUTDOWN_CYCLE_WAIT_MS = 5_000;

export function buildServer(config: ReturnType<typeof loadConfig>, db: Db, processor = createWebhookEventProcessor(db, config.LINE_CHANNEL_ACCESS_TOKEN ?? '',config.EVIDENCE_STORAGE_DIR)) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 1024 * 1024 });
  app.setErrorHandler((error, _request, reply) => {
    const failure=error as Error&{statusCode?:number};
    app.log.error({ errorName:failure.name, statusCode:failure.statusCode }, 'Request failed');
    return reply.code(failure.statusCode ?? 500).send({ error:'Internal Server Error' });
  });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.addContentTypeParser(['image/jpeg', 'image/png'], { parseAs: 'buffer', bodyLimit: CAMPAIGN_ASSET_MAX_BYTES },
    (_request, body, done) => done(null, body));

  const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
  let processingTimer: NodeJS.Timeout | undefined;
  let processingCycle: Promise<void> | undefined;
  app.addHook('onReady', async () => {
    if (config.ADMIN_ONLY) return;
    processingTimer = setInterval(() => {
      if (processingCycle) return;
      processingCycle = runProcessorCycle(processor, app).finally(() => { processingCycle = undefined; });
    }, 1000);
    processingTimer.unref();
  });
  app.addHook('onClose', async () => {
    if (processingTimer) clearInterval(processingTimer);
    if (!processingCycle) return;
    const activeCycle = processingCycle;
    let timeout: NodeJS.Timeout | undefined;
    let didTimeout = false;
    await Promise.race([
      activeCycle,
      new Promise<void>((resolve) => { timeout = setTimeout(() => { didTimeout = true; resolve(); }, SHUTDOWN_CYCLE_WAIT_MS); }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (didTimeout) app.log.warn('Webhook processor cycle did not finish before shutdown timeout');
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('readiness check timed out')), READINESS_TIMEOUT_MS); }),
      ]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });
  registerAdminRoutes(app, db, config.NODE_ENV === 'production',new FileSystemEvidenceStorage(config.EVIDENCE_STORAGE_DIR),
    new CampaignAssetStorage(config.CAMPAIGN_ASSET_STORAGE_DIR),config.PUBLIC_BASE_URL,config.ADMIN_ONLY);

  app.post('/webhooks/line', async (request, reply) => {
    if (config.ADMIN_ONLY) return reply.code(503).send({ error: 'LINE webhook processing is disabled in ADMIN_ONLY mode' });
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
    return reply.code(200).send(result);
  });
  return app;
}

async function runProcessorCycle(processor: WebhookEventProcessor, app: FastifyInstance) {
  try {
    await processor.recoverExpiredWork();
    await processor.processPending();
    await processor.quarantineStalePushes();
    await processor.processReadyPushes();
  } catch (error: unknown) {
    app.log.error({ errorName: error instanceof Error ? error.name : 'PROCESSOR_ERROR' }, 'Webhook processor cycle failed');
  }
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
