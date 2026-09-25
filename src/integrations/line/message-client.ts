export type LineMessageObject = Record<string, unknown>;

export class LineApiError extends Error {
  constructor(public readonly status: number) {
    super(`LINE Messaging API request failed with status ${status}`);
    this.name = 'LineApiError';
  }
}

export interface LineMessagingClientPort {
  replyMessage(replyToken: string, messages: LineMessageObject[]): Promise<void>;
  pushMessage(to: string, messages: LineMessageObject[]): Promise<void>;
}

export class LineMessagingClient implements LineMessagingClientPort {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  replyMessage(replyToken: string, messages: LineMessageObject[]) {
    return this.post('/v2/bot/message/reply', { replyToken, messages });
  }

  pushMessage(to: string, messages: LineMessageObject[]) {
    return this.post('/v2/bot/message/push', { to, messages });
  }

  private async post(path: string, body: Record<string, unknown>) {
    if (!this.channelAccessToken) throw new Error('LINE channel access token is not configured');
    const response = await this.fetchImpl(`https://api.line.me${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.channelAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new LineApiError(response.status);
  }
}

export class LineMessageAdapter {
  constructor(private readonly client: LineMessagingClientPort) {}

  sendReply(replyToken: string, messages: LineMessageObject[]) {
    return this.client.replyMessage(replyToken, messages);
  }

  sendToUser(lineUserId: string, messages: LineMessageObject[]) {
    return this.client.pushMessage(lineUserId, messages);
  }
}
