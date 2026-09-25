import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeLineEvent, parseLineWebhook } from '../../src/integrations/line/events.js';
import { verifyLineSignature } from '../../src/integrations/line/signature.js';
import { LineMessageContentClient, LineMessagingClient } from '../../src/integrations/line/message-client.js';
import { validateImage } from '../../src/modules/evidence/evidence-service.js';
import { evidenceRequestPostback, parseEvidenceRequestPostback } from '../../src/modules/evidence/postback.js';
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
    const sentUrls: string[] = [];
    let sentAuthorization = '';
    let sentRetryKey = '';
    const fetchMock: typeof fetch = async (input, init) => {
      sentUrls.push(String(input));
      sentAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      sentRetryKey = new Headers(init?.headers).get('x-line-retry-key') ?? '';
      return new Response(null, { status: 200 });
    };
    const client = new LineMessagingClient('unit-test-token', fetchMock);
    await client.replyMessage('reply-token', [{ type: 'text', text: 'hello' }]);
    await client.pushMessage('line-user', [{ type: 'text', text: 'approved' }], 'retry-key');
    expect(sentUrls).toEqual(['https://api.line.me/v2/bot/message/reply','https://api.line.me/v2/bot/message/push']);
    expect(sentAuthorization).toBe('Bearer unit-test-token');
    expect(sentRetryKey).toBe('retry-key');
    const failedClient = new LineMessagingClient('test-secret-must-not-leak', async () => new Response(null, { status: 401 }));
    await expect(failedClient.pushMessage('line-user', [{ type: 'text', text: 'hello' }]))
      .rejects.toMatchObject({ status: 401, message: 'LINE Messaging API request failed with status 401' });
  });

  it('fetches image content from the official data API using the webhook message ID and bounds payload size', async () => {
    let url='';let authorization='';
    const client=new LineMessageContentClient('content-test-token',async(input,init)=>{
      url=String(input);authorization=new Headers(init?.headers).get('authorization')??'';
      return new Response(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),{status:200,headers:{'content-type':'image/png'}});
    });
    const image=await client.getMessageContent('line_message_123');
    expect(url).toBe('https://api-data.line.me/v2/bot/message/line_message_123/content');
    expect(authorization).toBe('Bearer content-test-token');
    expect(image.contentType).toBe('image/png');
    await expect(client.getMessageContent('../bad')).rejects.toThrow('Invalid LINE message ID');
    const tooLarge=new LineMessageContentClient('token',async()=>new Response(null,{status:200,headers:{'content-length':'20'}}),10);
    await expect(tooLarge.getMessageContent('image-id')).rejects.toThrow('exceeds the evidence size limit');
  });

  it('accepts only matching JPEG/PNG media signatures and parses activity-specific postbacks', () => {
    expect(validateImage({contentType:'image/png',data:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])})).toMatchObject({mimeType:'image/png'});
    expect(validateImage({contentType:'image/jpeg',data:Buffer.from([0xff,0xd8,0xff,0x00,0x00,0x00,0x00,0x00])})).toMatchObject({mimeType:'image/jpeg'});
    expect(validateImage({contentType:'image/png',data:Buffer.from('not an image')})).toBeNull();
    expect(parseEvidenceRequestPostback(evidenceRequestPostback('CAMP_A','ACTIVITY_1'))).toEqual({campaignCode:'CAMP_A',activityKey:'ACTIVITY_1'});
    expect(parseEvidenceRequestPostback('evidence:request:bad/code:ACTIVITY_1')).toBeNull();
  });
});
