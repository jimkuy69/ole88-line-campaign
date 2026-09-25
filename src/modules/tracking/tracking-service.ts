import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';

type Db = NodePgDatabase<typeof schema>;

export type TrackingEventInput = {
  userId?: string | null;
  campaignId?: string | null;
  claimId?: string | null;
  eventType: string;
  buttonKey?: string | null;
  metadata?: Record<string, unknown>;
};

export class TrackingService {
  constructor(private readonly db: Db) {}

  async trackEvent(input: TrackingEventInput) {
    const [event] = await this.db.insert(schema.trackingEvents).values({
      userId: input.userId ?? null,
      campaignId: input.campaignId ?? null,
      claimId: input.claimId ?? null,
      eventType: input.eventType,
      buttonKey: input.buttonKey ?? null,
      metadata: input.metadata ?? {},
    }).returning();
    return event;
  }
}
