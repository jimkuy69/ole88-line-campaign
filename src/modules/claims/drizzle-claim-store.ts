import { and, count, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import type { CampaignForClaim, ClaimRecord, ClaimStore, ClaimUnitOfWork } from './claim-service.js';

type Db = NodePgDatabase<typeof schema>;

export class DrizzleClaimStore implements ClaimStore {
  constructor(private readonly db: Db) {}

  transaction<T>(work: (tx: ClaimUnitOfWork) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work({
      getCampaignForUpdate: async (code): Promise<CampaignForClaim | null> => {
        const [row] = await tx.select({ id: schema.campaigns.id, status: schema.campaigns.status,
          startAt: schema.campaigns.startAt, endAt: schema.campaigns.endAt, maxClaims: schema.campaigns.maxClaims,
          claimPolicy: schema.campaigns.claimPolicy })
          .from(schema.campaigns).where(eq(schema.campaigns.code, code)).for('update').limit(1);
        return row ?? null;
      },
      getExistingClaim: async (userId, campaignId) => {
        const [row] = await tx.select({ id: schema.claims.id, userId: schema.claims.userId,
          campaignId: schema.claims.campaignId, status: schema.claims.status, claimCode: schema.claims.claimCode })
          .from(schema.claims).where(and(eq(schema.claims.userId, userId), eq(schema.claims.campaignId, campaignId))).limit(1);
        return row as ClaimRecord | undefined ?? null;
      },
      countClaims: async (campaignId) => {
        const [row] = await tx.select({ value: count() }).from(schema.claims).where(eq(schema.claims.campaignId, campaignId));
        return Number(row?.value ?? 0);
      },
      insertClaimOnConflictDoNothing: async (input) => {
        const [row] = await tx.insert(schema.claims).values(input).onConflictDoNothing({
          target: [schema.claims.userId, schema.claims.campaignId],
        }).returning({ id: schema.claims.id, userId: schema.claims.userId, campaignId: schema.claims.campaignId,
          status: schema.claims.status, claimCode: schema.claims.claimCode });
        return row as ClaimRecord | undefined ?? null;
      },
    }));
  }

  async getClaim(id: string): Promise<ClaimRecord | null> {
    const [row] = await this.db.select({ id: schema.claims.id, userId: schema.claims.userId,
      campaignId: schema.claims.campaignId, status: schema.claims.status, claimCode: schema.claims.claimCode })
      .from(schema.claims).where(eq(schema.claims.id, id)).limit(1);
    return row as ClaimRecord | undefined ?? null;
  }

  async updateClaimState(id: string, expected: ClaimRecord['status'], next: ClaimRecord['status'], at: Date) {
    const changes: Partial<typeof schema.claims.$inferInsert> = { status: next, updatedAt: at };
    if (next === 'APPROVED') changes.approvedAt = at;
    if (next === 'REJECTED') changes.rejectedAt = at;
    if (next === 'REWARD_SENT') changes.completedAt = at;
    const [row] = await this.db.update(schema.claims).set(changes)
      .where(and(eq(schema.claims.id, id), eq(schema.claims.status, expected))).returning({
        id: schema.claims.id, userId: schema.claims.userId, campaignId: schema.claims.campaignId,
        status: schema.claims.status, claimCode: schema.claims.claimCode,
      });
    return row as ClaimRecord | undefined ?? null;
  }
}
