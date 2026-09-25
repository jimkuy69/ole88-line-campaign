import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import type { NormalizedLineEvent } from '../../integrations/line/events.js';

type Db = NodePgDatabase<typeof schema>;

export interface WebhookEventStore {
  insertOrIgnore(events: NormalizedLineEvent[]): Promise<number>;
}

export class DrizzleWebhookEventStore implements WebhookEventStore {
  constructor(private readonly db: Db) {}

  async insertOrIgnore(events: NormalizedLineEvent[]) {
    if (events.length === 0) return 0;
    const inserted = await this.db.insert(schema.webhookEvents).values(events.map((event) => ({
      channel: 'LINE', providerEventId: event.providerEventId, eventType: event.type,
      payload: event.payload, isRedelivery: event.isRedelivery, status: 'RECEIVED' as const,
    }))).onConflictDoNothing({
      target: [schema.webhookEvents.channel, schema.webhookEvents.providerEventId],
    }).returning({ id: schema.webhookEvents.id });
    return inserted.length;
  }
}

export class WebhookInbox {
  constructor(private readonly store: WebhookEventStore) {}

  async acceptLineEvents(events: NormalizedLineEvent[]) {
    const accepted = await this.store.insertOrIgnore(events);
    return { accepted, duplicates: events.length - accepted };
  }
}
