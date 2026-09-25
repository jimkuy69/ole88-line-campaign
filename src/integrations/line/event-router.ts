import type { NormalizedLineEvent } from './events.js';

export type LineEventHandler = (event: NormalizedLineEvent) => Promise<void>;

export class LineEventRouter {
  private readonly handlers = new Map<string, LineEventHandler>();

  register(eventType: string, handler: LineEventHandler) {
    this.handlers.set(eventType, handler);
  }

  async dispatch(event: NormalizedLineEvent) {
    const handler = this.handlers.get(event.type);
    if (handler) await handler(event);
  }
}
