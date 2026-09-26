import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';

type Db = NodePgDatabase<typeof schema>;

export type TrackingEventInput = {
  userId?: string | null;
  campaignId?: string | null;
  claimId?: string | null;
  eventType: string;
  buttonKey?: string | null;
  sourceEventId?: string | null;
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
      sourceEventId: input.sourceEventId ?? null,
      metadata: input.metadata ?? {},
    }).onConflictDoNothing().returning();
    return event;
  }

  async setClaimRequestOutcome(sourceEventId:string,outcome:'NEW'|'DUPLICATE'|'INELIGIBLE') {
    const [event]=await this.db.update(schema.trackingEvents).set({metadata:{outcome,...(outcome==='NEW'?{created:true}:outcome==='DUPLICATE'?{created:false}:{})}})
      .where(and(eq(schema.trackingEvents.sourceEventId,sourceEventId),eq(schema.trackingEvents.eventType,'CLAIM_REQUEST'),
        sql`${schema.trackingEvents.metadata}->>'outcome' = 'PENDING'`)).returning({id:schema.trackingEvents.id});
    return event??null;
  }
}
