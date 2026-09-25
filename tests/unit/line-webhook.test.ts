import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeLineEvent, parseLineWebhook } from '../../src/integrations/line/events.js';
import { verifyLineSignature } from '../../src/integrations/line/signature.js';
import { LineMessagingClient } from '../../src/integrations/line/message-client.js';
import { WebhookInbox, type WebhookEventStore } from '../../src/modules/webhooks/webhook-inbox.js';

describe('LINE adapter foundation', () => {
  it('checks the signature against the exact raw request body', () => {
    const body = Buffer.from('{"events":[]}');
    const secret = 'unit-test-secret';
    const signature = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyLineSignature(body, signature, secret)).toBe(true);
    expect(verifyLineSignature(Buffer.from('{ "events":[]}'), signature, secret)).toBe(false);
    expect(verifyLineSignature(body, undefined, secret)).toBe(false);
  });

  it('parses and normalizes provider event identity and redelivery state', () => {
    const envelope = parseLineWebhook({ events: [{ webhookEventId: 'evt-1', type: 'follow', deliveryContext: { isRedelivery: true } }] });
    expect(normalizeLineEvent(envelope.events[0]!)).toMatchObject({ providerEventId: 'evt-1', type: 'follow', isRedelivery: true });
    expect(() => parseLineWebhook({ events: [{ type: 'follow' }] })).toThrow();
  });

  it('acknowledges repeat provider event IDs as duplicates', async () => {
    const ids = new Set<string>();
    const store: WebhookEventStore = { insertOrIgnore: async (events) => {
      let accepted = 0;
      for (const event of events) if (!ids.has(event.providerEventId)) { ids.add(event.providerEventId); accepted += 1; }
      return accepted;
    } };
    const inbox = new WebhookInbox(store);
    const event = normalizeLineEvent(parseLineWebhook({ events: [{ webhookEventId: 'evt-1', type: 'message' }] }).events[0]!);
    expect(await inbox.acceptLineEvents([event])).toEqual({ accepted: 1, duplicates: 0 });
    expect(await inbox.acceptLineEvents([event])).toEqual({ accepted: 0, duplicates: 1 });
  });

  it('keeps the LINE client behind an injectable adapter and does not expose token in errors', async () => {
    let sentUrl = '';
    let sentAuthorization = '';
    const fetchMock: typeof fetch = async (input, init) => {
      sentUrl = String(input);
      sentAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(null, { status: 200 });
    };
    const client = new LineMessagingClient('unit-test-token', fetchMock);
    await client.replyMessage('reply-token', [{ type: 'text', text: 'hello' }]);
    expect(sentUrl).toBe('https://api.line.me/v2/bot/message/reply');
    expect(sentAuthorization).toBe('Bearer unit-test-token');
    const failedClient = new LineMessagingClient('test-secret-must-not-leak', async () => new Response(null, { status: 401 }));
    await expect(failedClient.pushMessage('line-user', [{ type: 'text', text: 'hello' }]))
      .rejects.toMatchObject({ status: 401, message: 'LINE Messaging API request failed with status 401' });
  });
});
