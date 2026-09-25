import { desc, asc, eq, and, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import { DomainError } from '../../domain/errors.js';
import { CampaignService } from '../campaigns/campaign-service.js';
import { validateCampaignForPublishDetailed } from '../campaigns/publish-validation.js';
import { campaignButtonPostback } from '../campaigns/postback-data.js';
import { buildActivityCard, buildCampaignCard } from '../../integrations/line/campaign-renderer.js';
import { TEMPLATES, type CampaignDraft } from './templates.js';

type Db = NodePgDatabase<typeof schema>;
const campaignFields = ['code','name','templateType','status','claimPolicy','title','subtitle','rewardType','rewardValue','heroImage','startAt','endAt','maxClaims','settings'] as const;

export class CampaignAdminService {
  private readonly campaigns: CampaignService;
  constructor(private readonly db: Db) { this.campaigns = new CampaignService(db); }

  async list() { return this.db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.updatedAt)); }
  templates() { return TEMPLATES; }

  async detail(id: string) {
    const campaign = await this.campaigns.getCampaignById(id);
    const [buttons, activities, messages] = await Promise.all([
      this.campaigns.getCampaignButtons(id), this.campaigns.getCampaignActivities(id), this.campaigns.getCampaignMessages(id),
    ]);
    return { campaign, buttons, activities, messages };
  }

  async create(actorId: string, templateId: string, code: string) {
    const template = TEMPLATES.find((item) => item.id === templateId);
    if (!template) throw new DomainError('Unknown campaign template.', 'TEMPLATE_NOT_FOUND');
    const draft = structuredClone(template.draft);
    draft.campaign.code = code;
    draft.buttons = draft.buttons.map((button) => button.buttonKey === 'BTN_CLAIM'
      ? { ...button, actionValue: campaignButtonPostback(code, 'BTN_CLAIM') } : button);
    const result = await this.saveGraph(null, draft, actorId, undefined, 'CAMPAIGN_CREATED', { templateId });
    return result;
  }

  async duplicate(actorId: string, id: string, code: string) {
    const source = await this.detail(id);
    const draft: CampaignDraft = {
      campaign: Object.fromEntries(campaignFields.filter((field) => field !== 'status').map((field) => [field, source.campaign[field]])) as CampaignDraft['campaign'],
      buttons: source.buttons.map(({ buttonKey, label, actionType, actionValue, displayOrder, enabled, metadata }) => ({ buttonKey,label,actionType:actionType as 'URI'|'POSTBACK',actionValue,displayOrder,enabled,metadata })),
      activities: source.activities.map(({ activityKey,title,description,actionType,actionValue,displayOrder,required,enabled,metadata }) => ({ activityKey,title,description,actionType:actionType as 'URI'|'POSTBACK',actionValue,displayOrder,required,enabled,metadata })),
      messages: source.messages.map(({ messageKey,messageType,content,metadata }) => ({ messageKey:messageKey as CampaignDraft['messages'][number]['messageKey'],messageType:messageType as 'TEXT',content,metadata })),
    };
    draft.campaign.code = code;
    draft.campaign.name = `${source.campaign.name} (copy)`;
    draft.buttons = draft.buttons.map((button) => button.buttonKey === 'BTN_CLAIM'
      ? { ...button, actionValue: campaignButtonPostback(code, 'BTN_CLAIM') } : button);
    return this.saveGraph(null, draft, actorId, undefined, 'CAMPAIGN_DUPLICATED', { sourceCampaignId: id });
  }

  async save(id: string, input: CampaignDraft, expectedVersion: number, actorId: string) {
    return this.saveGraph(id, input, actorId, expectedVersion, 'CAMPAIGN_UPDATED');
  }

  async preview(input: CampaignDraft) {
    const campaign = { ...input.campaign, startAt: input.campaign.startAt ? new Date(input.campaign.startAt) : null,
      endAt: input.campaign.endAt ? new Date(input.campaign.endAt) : null, claimPolicy: input.campaign.claimPolicy ?? 'SINGLE_CLAIM' };
    const previewButtons = input.buttons.map((button)=>button.buttonKey==='BTN_CLAIM'?{...button,actionType:'POSTBACK',actionValue:campaignButtonPostback(campaign.code,'BTN_CLAIM')}:button);
    const issues = validateCampaignForPublishDetailed(campaign, previewButtons, input.activities, input.messages);
    const messages: Record<string, unknown>[] = [];
    const welcome = input.messages.find((item) => item.messageKey === 'WELCOME_MESSAGE')?.content;
    if (welcome) messages.push({ type: 'text', text: welcome });
    try { messages.push(buildCampaignCard(campaign, previewButtons)); }
    catch (error) { issues.push({ path: 'campaign', message: error instanceof Error ? error.message : 'Could not render campaign card.' }); }
    const created = input.messages.find((item) => item.messageKey === 'CLAIM_CREATED')?.content;
    const enabledActivities = input.activities.filter((item) => item.enabled).sort((a,b) => a.displayOrder-b.displayOrder);
    const claimMessages: Record<string, unknown>[] = [];
    if (created) claimMessages.push({ type: 'text', text: created });
    if (enabledActivities.length)try { claimMessages.push(buildActivityCard(campaign, enabledActivities)); }
    catch(error){issues.push({path:'activities',message:error instanceof Error?error.message:'Activity preview could not be rendered.'});}
    return { issues, welcomeMessages: messages, claimMessages };
  }

  async publish(id: string, actorId: string, expectedVersion?: number) {
    const current = await this.campaigns.getCampaignById(id);
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new DomainError('Campaign changed since it was opened.', 'CAMPAIGN_VERSION_CONFLICT');
    const campaign = await this.campaigns.publishCampaign(id, actorId, expectedVersion);
    return campaign;
  }

  async saveAndPublish(id: string, input: CampaignDraft, expectedVersion: number, actorId: string) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).for('update').limit(1);
      if (!current) throw new DomainError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
      if (current.status === 'ACTIVE') throw new DomainError('Campaign is already active.', 'CAMPAIGN_ALREADY_ACTIVE');
      if (current.version !== expectedVersion) throw new DomainError('Campaign changed since it was opened.', 'CAMPAIGN_VERSION_CONFLICT');

      const normalizedButtons = input.buttons.map((item) => item.buttonKey === 'BTN_CLAIM'
        ? { ...item, actionType: 'POSTBACK', actionValue: campaignButtonPostback(input.campaign.code, 'BTN_CLAIM') } : item);
      await tx.update(schema.campaigns).set({ ...input.campaign,
        startAt: input.campaign.startAt ? new Date(input.campaign.startAt) : null,
        endAt: input.campaign.endAt ? new Date(input.campaign.endAt) : null,
        claimPolicy: input.campaign.claimPolicy ?? 'SINGLE_CLAIM', status: 'DRAFT', version: current.version + 1, updatedAt: new Date(),
      }).where(eq(schema.campaigns.id, id));
      await tx.delete(schema.campaignButtons).where(eq(schema.campaignButtons.campaignId, id));
      await tx.delete(schema.campaignMessages).where(eq(schema.campaignMessages.campaignId, id));
      if (normalizedButtons.length) await tx.insert(schema.campaignButtons).values(normalizedButtons.map((item) => ({ ...item, campaignId: id })));

      const existing = await tx.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId, id)).for('update');
      const wanted = new Set(input.activities.map((item) => item.activityKey));
      for (const old of existing) if (!wanted.has(old.activityKey)) {
        const [usage] = await tx.select({ id: schema.claimActivities.id }).from(schema.claimActivities)
          .where(eq(schema.claimActivities.campaignActivityId, old.id)).limit(1);
        if (usage) throw new DomainError(`Activity ${old.activityKey} is already referenced by a claim and cannot be removed.`, 'ACTIVITY_IN_USE');
        await tx.delete(schema.campaignActivities).where(eq(schema.campaignActivities.id, old.id));
      }
      for (const item of input.activities) {
        const match = existing.find((old) => old.activityKey === item.activityKey);
        if (match) await tx.update(schema.campaignActivities).set({ ...item, updatedAt: new Date() }).where(eq(schema.campaignActivities.id, match.id));
        else await tx.insert(schema.campaignActivities).values({ ...item, campaignId: id });
      }
      if (input.messages.length) await tx.insert(schema.campaignMessages).values(input.messages.map((item) => ({ ...item, campaignId: id })));

      const [savedCampaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
      const buttons = await tx.select().from(schema.campaignButtons).where(eq(schema.campaignButtons.campaignId, id));
      const activities = await tx.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId, id));
      const messages = await tx.select().from(schema.campaignMessages).where(eq(schema.campaignMessages.campaignId, id));
      const issues = validateCampaignForPublishDetailed(savedCampaign!, buttons, activities, messages);
      if (issues.length) throw new DomainError(`Campaign cannot be published: ${issues.map((issue) => issue.message).join(' ')}`, 'CAMPAIGN_NOT_PUBLISHABLE', issues);

      await tx.execute(sql`SELECT pg_advisory_xact_lock(881288, 1)`);
      const [anotherActive] = await tx.select({ id: schema.campaigns.id }).from(schema.campaigns)
        .where(and(eq(schema.campaigns.status, 'ACTIVE'), ne(schema.campaigns.id, id))).limit(1);
      if (anotherActive) throw new DomainError('Pause the active campaign before publishing another.', 'ANOTHER_CAMPAIGN_ACTIVE');

      const [published] = await tx.update(schema.campaigns).set({ status: 'ACTIVE', version: current.version + 2, updatedAt: new Date() })
        .where(eq(schema.campaigns.id, id)).returning();
      await tx.insert(schema.auditLogs).values([
        { actorType: 'ADMIN', actorId, action: 'CAMPAIGN_UPDATED', entityType: 'CAMPAIGN', entityId: id,
          beforeData: { status: current.status, version: current.version },
          afterData: { status: 'DRAFT', version: current.version + 1, buttonCount: input.buttons.length, activityCount: input.activities.length },
          metadata: { buttonKeys: input.buttons.map((item) => item.buttonKey), activityKeys: input.activities.map((item) => item.activityKey), messageKeys: input.messages.map((item) => item.messageKey) } },
        { actorType: 'ADMIN', actorId, action: 'CAMPAIGN_PUBLISHED', entityType: 'CAMPAIGN', entityId: id, metadata: { version: published!.version } },
      ]);
      return published!;
    });
  }
  async pause(id: string, actorId: string, expectedVersion?: number) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id,id)).for('update').limit(1);
      if (!current) throw new DomainError('Campaign not found','CAMPAIGN_NOT_FOUND');
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new DomainError('Campaign changed since it was opened.','CAMPAIGN_VERSION_CONFLICT');
      if (current.status !== 'ACTIVE') throw new DomainError('Only an active campaign can be paused.','CAMPAIGN_NOT_ACTIVE');
      const [updated] = await tx.update(schema.campaigns).set({ status:'PAUSED', version: current.version+1, updatedAt:new Date() }).where(eq(schema.campaigns.id,id)).returning();
      await tx.insert(schema.auditLogs).values({ actorType:'ADMIN',actorId,action:'CAMPAIGN_PAUSED',entityType:'CAMPAIGN',entityId:id,metadata:{ version:updated!.version } });
      return updated!;
    });
  }

  private async saveGraph(id: string | null, input: CampaignDraft, actorId: string, expectedVersion?: number, action?:string, auditMetadata:Record<string,unknown>={}) {
    return this.db.transaction(async (tx) => {
      let campaignId = id;
      let before: Record<string, unknown> | null = null;
      let changedFields:string[]=[];
      let nextVersion = 1;
      if (campaignId) {
        const [current] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaignId)).for('update').limit(1);
        if (!current) throw new DomainError('Campaign not found','CAMPAIGN_NOT_FOUND');
        if (current.status === 'ACTIVE') throw new DomainError('Pause the campaign before editing.','ACTIVE_CAMPAIGN_IMMUTABLE');
        if (expectedVersion !== undefined && current.version !== expectedVersion) throw new DomainError('Campaign changed since it was opened.','CAMPAIGN_VERSION_CONFLICT');
        before = { status: current.status, version: current.version };
        changedFields = Object.keys(input.campaign).filter((key)=>JSON.stringify((current as Record<string,unknown>)[key])!==JSON.stringify((input.campaign as Record<string,unknown>)[key]));
        nextVersion = current.version + 1;
        await tx.update(schema.campaigns).set({ ...input.campaign, startAt: input.campaign.startAt ? new Date(input.campaign.startAt) : null,
          endAt: input.campaign.endAt ? new Date(input.campaign.endAt) : null, claimPolicy: input.campaign.claimPolicy ?? 'SINGLE_CLAIM',
          version:nextVersion, updatedAt:new Date() }).where(eq(schema.campaigns.id,campaignId));
        await tx.delete(schema.campaignButtons).where(eq(schema.campaignButtons.campaignId,campaignId));
        await tx.delete(schema.campaignMessages).where(eq(schema.campaignMessages.campaignId,campaignId));
      } else {
        const [created] = await tx.insert(schema.campaigns).values({ ...input.campaign, status:'DRAFT', claimPolicy: input.campaign.claimPolicy ?? 'SINGLE_CLAIM',
          startAt: input.campaign.startAt ? new Date(input.campaign.startAt) : null, endAt: input.campaign.endAt ? new Date(input.campaign.endAt) : null }).returning();
        campaignId = created!.id;
      }
      const normalizedButtons = input.buttons.map((item) => item.buttonKey === 'BTN_CLAIM'
        ? { ...item, actionType:'POSTBACK', actionValue:campaignButtonPostback(input.campaign.code, 'BTN_CLAIM') } : item);
      if (normalizedButtons.length) await tx.insert(schema.campaignButtons).values(normalizedButtons.map((item) => ({ ...item, campaignId:campaignId! })));
      if (id) {
        const existing = await tx.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId,campaignId!)).for('update');
        const wanted = new Set(input.activities.map((item)=>item.activityKey));
        for (const old of existing) if (!wanted.has(old.activityKey)) {
          const [usage] = await tx.select({id:schema.claimActivities.id}).from(schema.claimActivities).where(eq(schema.claimActivities.campaignActivityId,old.id)).limit(1);
          if (usage) throw new DomainError(`Activity ${old.activityKey} is already referenced by a claim and cannot be removed.`, 'ACTIVITY_IN_USE');
          await tx.delete(schema.campaignActivities).where(eq(schema.campaignActivities.id,old.id));
        }
        for (const item of input.activities) {
          const match=existing.find((old)=>old.activityKey===item.activityKey);
          if(match) await tx.update(schema.campaignActivities).set({...item,updatedAt:new Date()}).where(eq(schema.campaignActivities.id,match.id));
          else await tx.insert(schema.campaignActivities).values({...item,campaignId:campaignId!});
        }
      } else if (input.activities.length) await tx.insert(schema.campaignActivities).values(input.activities.map((item) => ({ ...item, campaignId:campaignId! })));
      if (input.messages.length) await tx.insert(schema.campaignMessages).values(input.messages.map((item) => ({ ...item, campaignId:campaignId! })));
      await tx.insert(schema.auditLogs).values({ actorType:'ADMIN',actorId,action:action??(id?'CAMPAIGN_UPDATED':'CAMPAIGN_CREATED'),entityType:'CAMPAIGN',entityId:campaignId,
        beforeData:before,afterData:{ status:id ? undefined:'DRAFT',version:nextVersion,buttonCount:input.buttons.length,activityCount:input.activities.length,changedFields },
        metadata:{...auditMetadata,buttonKeys:input.buttons.map((item)=>item.buttonKey),activityKeys:input.activities.map((item)=>item.activityKey),messageKeys:input.messages.map((item)=>item.messageKey)} });
      const [campaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaignId!));
      const buttons = await tx.select().from(schema.campaignButtons).where(eq(schema.campaignButtons.campaignId,campaignId!)).orderBy(asc(schema.campaignButtons.displayOrder));
      const activities = await tx.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId,campaignId!)).orderBy(asc(schema.campaignActivities.displayOrder));
      const messages = await tx.select().from(schema.campaignMessages).where(eq(schema.campaignMessages.campaignId,campaignId!));
      return { campaign:campaign!,buttons,activities,messages };
    });
  }
}
