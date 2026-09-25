import { and, eq, lte, or, isNull, gte, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import { DomainError } from '../../domain/errors.js';
import { assertSupportedClaimPolicy } from '../../domain/campaign-policy.js';
import { validateCampaignForPublishDetailed } from './publish-validation.js';

type Db = NodePgDatabase<typeof schema>;

export function orderEnabledActivities<T extends { enabled: boolean; displayOrder: number }>(activities: T[]) {
  return activities.filter((activity) => activity.enabled).sort((left, right) => left.displayOrder - right.displayOrder);
}

export class CampaignService {
  constructor(private readonly db: Db) {}

  async getCampaignByCode(code: string) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.code, code)).limit(1);
    return campaign ?? null;
  }

  async getActiveCampaign(now = new Date()) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(and(
      eq(schema.campaigns.status, 'ACTIVE'),
      or(isNull(schema.campaigns.startAt), lte(schema.campaigns.startAt, now)),
      or(isNull(schema.campaigns.endAt), gte(schema.campaigns.endAt, now)),
    )).limit(1);
    return campaign ?? null;
  }

  async createCampaign(input: typeof schema.campaigns.$inferInsert) {
    if (input.claimPolicy !== undefined) assertSupportedClaimPolicy(input.claimPolicy);
    if (input.status === 'ACTIVE') throw new DomainError('Use publishCampaign after completing publish validation.', 'PUBLISH_VALIDATION_REQUIRED');
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.insert(schema.campaigns).values(input).returning();
      return campaign!;
    });
  }

  async updateCampaign(id: string, input: Partial<typeof schema.campaigns.$inferInsert>) {
    if (input.claimPolicy !== undefined) assertSupportedClaimPolicy(input.claimPolicy);
    if (input.status === 'ACTIVE') throw new DomainError('Use publishCampaign after completing publish validation.', 'PUBLISH_VALIDATION_REQUIRED');
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).for('update').limit(1);
      if (!current) throw new DomainError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
      if (current.status === 'ACTIVE' && Object.keys(input).some((key) => key !== 'status')) {
        throw new DomainError('Pause the campaign before editing it.', 'ACTIVE_CAMPAIGN_IMMUTABLE');
      }
      const [campaign] = await tx.update(schema.campaigns).set({ ...input, version: current.version + 1, updatedAt: new Date() })
        .where(eq(schema.campaigns.id, id)).returning();
      return campaign!;
    });
  }

  async publishCampaign(id: string, actorId?: string, expectedVersion?: number) {
    return this.db.transaction(async (tx) => {
      const [campaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).for('update').limit(1);
      if (!campaign) throw new DomainError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
      if (expectedVersion !== undefined && campaign.version !== expectedVersion) throw new DomainError('Campaign changed since it was opened.', 'CAMPAIGN_VERSION_CONFLICT');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(881288, 1)`);
      const [anotherActive] = await tx.select({id:schema.campaigns.id}).from(schema.campaigns)
        .where(and(eq(schema.campaigns.status,'ACTIVE'),ne(schema.campaigns.id,id))).limit(1);
      if (anotherActive) throw new DomainError('Pause the active campaign before publishing another; the LINE welcome flow selects one active campaign.', 'ANOTHER_CAMPAIGN_ACTIVE');
      const buttons = await tx.select().from(schema.campaignButtons).where(eq(schema.campaignButtons.campaignId, id));
      const activities = await tx.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId, id));
      const messages = await tx.select().from(schema.campaignMessages).where(eq(schema.campaignMessages.campaignId, id));
      const issues = validateCampaignForPublishDetailed(campaign, buttons, activities, messages);
      if (issues.length) {
        throw new DomainError(`Campaign cannot be published: ${issues.map((issue)=>issue.message).join(' ')}`, 'CAMPAIGN_NOT_PUBLISHABLE', issues);
      }
      const [published] = await tx.update(schema.campaigns).set({ status: 'ACTIVE', version: campaign.version + 1, updatedAt: new Date() })
        .where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.status, campaign.status))).returning();
      if (!published) throw new DomainError('Campaign changed while publishing.', 'CAMPAIGN_PUBLISH_CONFLICT');
      if (actorId) await tx.insert(schema.auditLogs).values({ actorType:'ADMIN',actorId,action:'CAMPAIGN_PUBLISHED',entityType:'CAMPAIGN',entityId:id,metadata:{version:published.version} });
      return published;
    });
  }

  async pauseCampaign(id: string) {
    return this.updateCampaign(id, { status: 'PAUSED' });
  }

  async getCampaignById(id: string) {
    const [campaign] = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
    if (!campaign) throw new DomainError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    return campaign;
  }

  async getCampaignButtons(campaignId: string) {
    return this.db.select().from(schema.campaignButtons).where(eq(schema.campaignButtons.campaignId, campaignId))
      .orderBy(schema.campaignButtons.displayOrder);
  }

  async getCampaignActivities(campaignId: string) {
    return this.db.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId, campaignId))
      .orderBy(schema.campaignActivities.displayOrder);
  }

  async getCampaignMessages(campaignId: string) {
    return this.db.select().from(schema.campaignMessages).where(eq(schema.campaignMessages.campaignId, campaignId));
  }
}
