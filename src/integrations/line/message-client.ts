export type LineMessageObject = Record<string, unknown>;
export interface LineMessageContent { contentType: string; data: Buffer }
export interface LineMessageContentPort { getMessageContent(messageId: string): Promise<LineMessageContent> }

export class LineApiError extends Error {
  constructor(public readonly status: number) {
    super(`LINE Messaging API request failed with status ${status}`);
    this.name = 'LineApiError';
  }
}

export interface LineMessagingClientPort {
  replyMessage(replyToken: string, messages: LineMessageObject[]): Promise<void>;
  pushMessage(to: string, messages: LineMessageObject[], retryKey?: string): Promise<void>;
}

export class LineMessagingClient implements LineMessagingClientPort {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  replyMessage(replyToken: string, messages: LineMessageObject[]) {
    return this.post('/v2/bot/message/reply', { replyToken, messages });
  }

  pushMessage(to: string, messages: LineMessageObject[], retryKey?: string) {
    return this.post('/v2/bot/message/push', { to, messages }, retryKey);
  }

  private async post(path: string, body: Record<string, unknown>, retryKey?: string) {
    if (!this.channelAccessToken) throw new Error('LINE channel access token is not configured');
    const response = await this.fetchImpl(`https://api.line.me${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.channelAccessToken}`,
        'content-type': 'application/json',
        ...(retryKey ? { 'X-Line-Retry-Key': retryKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new LineApiError(response.status);
  }
}

export class LineMessageContentClient implements LineMessageContentPort {
  constructor(private readonly channelAccessToken: string, private readonly fetchImpl: typeof fetch = fetch, private readonly maxBytes = 10 * 1024 * 1024) {}

  async getMessageContent(messageId: string): Promise<LineMessageContent> {
    if (!this.channelAccessToken) throw new Error('LINE channel access token is not configured');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new Error('Invalid LINE message ID');
    const response = await this.fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: { authorization: `Bearer ${this.channelAccessToken}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new LineApiError(response.status);
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > this.maxBytes) throw new Error('LINE image exceeds the evidence size limit');
    if (!response.body) throw new Error('LINE image response is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.maxBytes) { await reader.cancel(); throw new Error('LINE image exceeds the evidence size limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return { contentType, data: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) };
  }
}

export class LineMessageAdapter {
  constructor(private readonly client: LineMessagingClientPort) {}

  sendReply(replyToken: string, messages: LineMessageObject[]) {
    return this.client.replyMessage(replyToken, messages);
  }

  sendToUser(lineUserId: string, messages: LineMessageObject[], retryKey?: string) {
    return this.client.pushMessage(lineUserId, messages, retryKey);
  }
}
