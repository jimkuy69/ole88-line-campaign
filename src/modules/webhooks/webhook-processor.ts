import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import type { NormalizedLineEvent } from '../../integrations/line/events.js';
import { LineEventRouter } from '../../integrations/line/event-router.js';
import { LineMessageAdapter, LineMessagingClient, LineMessageContentClient, type LineMessageObject } from '../../integrations/line/message-client.js';
import { FileSystemEvidenceStorage } from '../evidence/storage.js';
import { EvidenceService } from '../evidence/evidence-service.js';
import { parseEvidenceRequestPostback } from '../evidence/postback.js';
import { DomainError } from '../../domain/errors.js';
import { ClaimService } from '../claims/claim-service.js';
import { DrizzleClaimStore } from '../claims/drizzle-claim-store.js';
import { CampaignService } from '../campaigns/campaign-service.js';
import { campaignButtonPostback } from '../campaigns/postback-data.js';
import { parseCampaignButtonPostback } from '../campaigns/postback-data.js';
import { buildActivityCard, buildCampaignCard } from '../../integrations/line/campaign-renderer.js';

type Db = NodePgDatabase<typeof schema>;
type InboxRow = typeof schema.webhookEvents.$inferSelect;
const PROCESSING_LEASE_MS = 45_000;

export interface ReplySender { sendReply(token: string, messages: LineMessageObject[]): Promise<void>; sendToUser?(userId:string,messages:LineMessageObject[],retryKey?:string):Promise<void> }

export { buildCampaignCard, buildActivityCard };

export class WebhookEventProcessor {
  private readonly router = new LineEventRouter();
  private readonly campaigns: CampaignService;
  private readonly claims: ClaimService;

  constructor(private readonly db: Db, private readonly sender: ReplySender, private readonly accessTokenConfigured = true,
    private readonly evidence?:EvidenceService) {
    this.campaigns = new CampaignService(db);
    this.claims = new ClaimService(new DrizzleClaimStore(db));
    this.router.register('follow', (event) => this.onFollow(event));
    this.router.register('postback', (event) => this.onPostback(event));
    this.router.register('message', (event) => this.onMessage(event));
  }

  async processPending(limit = 20) {
    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      const row = await this.claimNext();
      if (!row) break;
      try {
        const existingOutbound = await this.getOutbound(row);
        if (existingOutbound?.status === 'READY') {
          await this.deliverOutbox(existingOutbound.dedupeKey);
          const [updatedOutbound] = await this.db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.id, existingOutbound.id)).limit(1);
          await this.finishInbox(row.id, 'PROCESSED', `OUTBOUND_RESUMED_${updatedOutbound?.status ?? 'UNKNOWN'}`);
          processed += 1;
          continue;
        }
        await this.router.dispatch(this.normalize(row));
        await this.finishInbox(row.id, 'PROCESSED', null);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'LINE_CONFIG_MISSING') {
          await this.finishInbox(row.id, 'RECEIVED', 'LINE_CONFIG_MISSING', 5_000);
        } else if (await this.outboundAlreadyStarted(row)) {
          await this.finishInbox(row.id, 'PROCESSED', 'OUTBOUND_OUTCOME_REQUIRES_REVIEW');
        } else {
          const attempts = row.attemptCount + 1;
          await this.finishInbox(row.id, attempts >= 5 ? 'FAILED' : 'RECEIVED', errorCode(error), Math.min(60_000, 1000 * 2 ** (attempts - 1)), attempts);
        }
      }
      processed += 1;
    }
    return processed;
  }

  async recoverExpiredWork(now = new Date()) {
    return this.db.transaction(async (tx) => {
      const expired = await tx.select().from(schema.webhookEvents).where(and(
        eq(schema.webhookEvents.status, 'PROCESSING'), or(lte(schema.webhookEvents.leaseUntil, now), isNull(schema.webhookEvents.leaseUntil)),
      )).orderBy(asc(schema.webhookEvents.receivedAt)).limit(100).for('update', { skipLocked: true });
      let recovered = 0;
      for (const row of expired) {
        const [outbound] = await tx.select().from(schema.outboundMessages)
          .where(eq(schema.outboundMessages.dedupeKey, `line-reply:${row.providerEventId}`)).limit(1).for('update');
        if (!outbound) {
          await tx.update(schema.webhookEvents).set({ status: 'RECEIVED', leaseUntil: null, processingStartedAt: null,
            errorCode: 'LEASE_EXPIRED_BEFORE_OUTBOUND' }).where(eq(schema.webhookEvents.id, row.id));
        } else if (outbound.status === 'READY') {
          await tx.update(schema.webhookEvents).set({ status: 'RECEIVED', leaseUntil: null, processingStartedAt: null,
            errorCode: 'LEASE_EXPIRED_WITH_READY_REPLY' }).where(eq(schema.webhookEvents.id, row.id));
        } else if (outbound.status === 'SENDING') {
          await tx.update(schema.outboundMessages).set({ status: 'UNCERTAIN', replyToken: null,
            errorCode: 'PROCESS_CRASH_DURING_LINE_REPLY' }).where(eq(schema.outboundMessages.id, outbound.id));
          await tx.update(schema.webhookEvents).set({ status: 'PROCESSED', processedAt: now, leaseUntil: null,
            processingStartedAt: null, errorCode: 'OUTBOUND_UNCERTAIN_AFTER_CRASH' }).where(eq(schema.webhookEvents.id, row.id));
        } else {
          await tx.update(schema.webhookEvents).set({ status: 'PROCESSED', processedAt: now, leaseUntil: null,
            processingStartedAt: null, errorCode: `OUTBOUND_${outbound.status}` }).where(eq(schema.webhookEvents.id, row.id));
        }
        recovered += 1;
      }
      return recovered;
    });
  }

  async processReadyPushes(limit=50) {
    if(!this.accessTokenConfigured)return 0;
    const rows=await this.db.select({dedupeKey:schema.outboundMessages.dedupeKey}).from(schema.outboundMessages)
      .where(and(eq(schema.outboundMessages.deliveryType,'PUSH'),eq(schema.outboundMessages.status,'READY')))
      .orderBy(asc(schema.outboundMessages.createdAt)).limit(limit);
    for(const row of rows)await this.deliverOutbox(row.dedupeKey);
    return rows.length;
  }

  async quarantineStalePushes(now=new Date()) {
    const staleAt=new Date(now.getTime()-PROCESSING_LEASE_MS);
    const rows=await this.db.update(schema.outboundMessages).set({status:'UNCERTAIN',errorCode:'PUSH_PROCESS_CRASH_OUTCOME_UNCERTAIN',updatedAt:now})
      .where(and(eq(schema.outboundMessages.deliveryType,'PUSH'),eq(schema.outboundMessages.status,'SENDING'),lte(schema.outboundMessages.sendingStartedAt,staleAt))).returning({id:schema.outboundMessages.id});
    return rows.length;
  }

  private async claimNext(): Promise<InboxRow | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.select().from(schema.webhookEvents).where(and(
        eq(schema.webhookEvents.status, 'RECEIVED'), or(lte(schema.webhookEvents.nextAttemptAt, now), sql`${schema.webhookEvents.nextAttemptAt} IS NULL`),
      )).orderBy(asc(schema.webhookEvents.receivedAt)).limit(1).for('update', { skipLocked: true });
      const row = rows[0];
      if (!row) return null;
      await tx.update(schema.webhookEvents).set({ status: 'PROCESSING', processingStartedAt: now,
        leaseUntil: new Date(now.getTime() + PROCESSING_LEASE_MS), errorCode: null }).where(eq(schema.webhookEvents.id, row.id));
      return row;
    });
  }

  private async finishInbox(id: string, status: 'PROCESSED' | 'RECEIVED' | 'FAILED', errorCodeValue: string | null, delayMs = 0, attemptCount?: number) {
    await this.db.update(schema.webhookEvents).set({ status, errorCode: errorCodeValue,
      processedAt: status === 'PROCESSED' ? new Date() : null, leaseUntil: null, processingStartedAt: null,
      nextAttemptAt: new Date(Date.now() + delayMs), ...(attemptCount === undefined ? {} : { attemptCount }),
    }).where(eq(schema.webhookEvents.id, id));
  }

  private async outboundAlreadyStarted(row: InboxRow) {
    const outbound = await this.getOutbound(row);
    return Boolean(outbound && ['SENDING', 'SENT', 'FAILED', 'UNCERTAIN'].includes(outbound.status));
  }

  private async getOutbound(row: InboxRow) {
    const [outbound] = await this.db.select().from(schema.outboundMessages)
      .where(eq(schema.outboundMessages.dedupeKey, `line-reply:${row.providerEventId}`)).limit(1);
    return outbound ?? null;
  }

  private async getOrCreatePushRetryKey(id:string) {
    const [created]=await this.db.update(schema.outboundMessages).set({retryKey:randomUUID()})
      .where(and(eq(schema.outboundMessages.id,id),isNull(schema.outboundMessages.retryKey))).returning({retryKey:schema.outboundMessages.retryKey});
    if(created?.retryKey)return created.retryKey;
    const [existing]=await this.db.select({retryKey:schema.outboundMessages.retryKey}).from(schema.outboundMessages)
      .where(eq(schema.outboundMessages.id,id)).limit(1);
    if(!existing?.retryKey)throw new DomainError('LINE push retry key was not persisted.','PUSH_RETRY_KEY_MISSING');
    return existing.retryKey;
  }

  private normalize(row: InboxRow): NormalizedLineEvent {
    return { providerEventId: row.providerEventId, type: row.eventType, isRedelivery: row.isRedelivery, payload: row.payload };
  }

  private async onFollow(event: NormalizedLineEvent) {
    const actor = object(event.payload.source);
    const lineUserId = string(actor?.userId);
    const replyToken = string(event.payload.replyToken);
    if (!lineUserId || !replyToken) return;
    const campaign = await this.campaigns.getActiveCampaign();
    if (!campaign) return;
    const [message, buttons] = await Promise.all([
      this.campaigns.getCampaignMessages(campaign.id), this.campaigns.getCampaignButtons(campaign.id),
    ]);
    const welcome = message.find((item) => item.messageKey === 'WELCOME_MESSAGE')?.content;
    const enabledButtons = buttons.filter((button) => button.enabled);
    if (!welcome || enabledButtons.length === 0) return;
    const claimButton = enabledButtons.find((button) => button.buttonKey === 'BTN_CLAIM' && button.actionType === 'POSTBACK'
      && button.actionValue === campaignButtonPostback(campaign.code, 'BTN_CLAIM'));
    if (!claimButton) throw new DomainError('Active campaign is missing a valid claim button.', 'ACTIVE_CAMPAIGN_INVALID');
    const card = buildCampaignCard(campaign, enabledButtons);
    this.assertDeliveryConfigured();
    await this.ensureLineIdentity(lineUserId);
    await this.enqueueReply(event.providerEventId, lineUserId, replyToken, [{ type: 'text', text: welcome }, card]);
  }

  private async onPostback(event: NormalizedLineEvent) {
    const actor = object(event.payload.source);
    const lineUserId = string(actor?.userId);
    const replyToken = string(event.payload.replyToken);
    const postback = object(event.payload.postback);
    const rawData = string(postback?.data);
    const evidenceRequest=parseEvidenceRequestPostback(rawData??'');
    if(evidenceRequest){if(!lineUserId||!replyToken)return;await this.onEvidenceRequest(event,lineUserId,replyToken,evidenceRequest.campaignCode,evidenceRequest.activityKey);return;}
    const parsed = parseCampaignButtonPostback(rawData ?? '');
    if (!lineUserId || !replyToken || !parsed || parsed.buttonKey !== 'BTN_CLAIM') return;
    const campaign = await this.campaigns.getCampaignByCode(parsed.campaignCode);
    if (!campaign || campaign.status !== 'ACTIVE') return;
    const configured = (await this.campaigns.getCampaignButtons(campaign.id)).some((button) => button.buttonKey === parsed.buttonKey
      && button.enabled && button.actionType === 'POSTBACK' && button.actionValue === rawData);
    if (!configured) return;
    this.assertDeliveryConfigured();
    await this.ensureLineIdentity(lineUserId);
    const [identity] = await this.db.select().from(schema.channelIdentities).where(and(
      eq(schema.channelIdentities.channel, 'LINE'), eq(schema.channelIdentities.externalUserId, lineUserId),
    )).limit(1);
    if (!identity) return;
    const result = await this.claims.createClaim(identity.userId, campaign.code);
    const messages = await this.campaigns.getCampaignMessages(campaign.id);
    await this.ensureClaimActivities(result.claim.id,campaign.id);
    const statusKey=result.created?'CLAIM_CREATED':claimStatusMessageKey(result.claim.status);
    const response = messages.find((item) => item.messageKey === statusKey)?.content
      ?? messages.find((item) => item.messageKey === (result.created ? 'CLAIM_CREATED' : 'CLAIM_ALREADY_EXISTS'))?.content;
    if (!response) return;
    const activities = (await this.campaigns.getCampaignActivities(campaign.id)).filter((activity) => activity.enabled);
    const payload: LineMessageObject[] = [{ type: 'text', text: response }];
    if (activities.length && !['APPROVED','REWARD_SENT'].includes(result.claim.status)) payload.push(buildActivityCard(campaign, activities, result.claim.claimCode));
    await this.enqueueReply(event.providerEventId, lineUserId, replyToken, payload);
  }

  private async onEvidenceRequest(event:NormalizedLineEvent,lineUserId:string,replyToken:string,campaignCode:string,activityKey:string){
    if(!this.evidence)throw new DomainError('Evidence storage is not configured.','EVIDENCE_STORAGE_MISSING');
    this.assertDeliveryConfigured();
    try{
      const context=await this.evidence.requestUploadContext(lineUserId,campaignCode,activityKey,event.providerEventId);
      const text=(await this.campaigns.getCampaignMessages(context.campaign.id)).find((m)=>m.messageKey==='EVIDENCE_UPLOAD_PROMPT')?.content;
      if(text)await this.enqueueReply(event.providerEventId,lineUserId,replyToken,[{type:'text',text}]);
    }catch(error){
      if (error instanceof DomainError && error.code === 'LINE_CONFIG_MISSING') throw error;
      const campaign=await this.campaigns.getCampaignByCode(campaignCode).catch(()=>null);
      const text=campaign?(await this.campaigns.getCampaignMessages(campaign.id)).find((m)=>m.messageKey==='EVIDENCE_SELECT_ACTIVITY')?.content:null;
      await this.enqueueReply(event.providerEventId,lineUserId,replyToken,[{type:'text',text:text||'Select a specific activity using its Submit proof button before sending an image.'}]);
    }
  }

  private async onMessage(event:NormalizedLineEvent){
    const actor=object(event.payload.source);const lineUserId=string(actor?.userId);const replyToken=string(event.payload.replyToken);
    const message=object(event.payload.message);if(!lineUserId||!replyToken||message?.type!=='image')return;
    const messageId=string(message.id);if(!messageId)return;
    this.assertDeliveryConfigured();
    if(!this.evidence)throw new DomainError('Evidence storage is not configured.','EVIDENCE_STORAGE_MISSING');
    const result=await this.evidence.receiveImage(lineUserId,messageId,event.providerEventId);
    if(result.kind==='no_context'){
      await this.enqueueReply(event.providerEventId,lineUserId,replyToken,[{type:'text',text:'Select a specific activity using its Submit proof button before sending an image.'}]);return;
    }
    const messages=await this.campaigns.getCampaignMessages(result.campaign.id);
    if(result.kind==='invalid_image'){
      const text=messages.find((m)=>m.messageKey==='EVIDENCE_INVALID')?.content;
      await this.enqueueReply(event.providerEventId,lineUserId,replyToken,[{type:'text',text:text||'Send a JPEG or PNG image under 10 MB.'}]);return;
    }
    if(result.kind==='duplicate'){
      // A redelivered image event is acknowledged without creating or notifying twice.
      const prior=await this.db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.dedupeKey,`line-reply:${event.providerEventId}`)).limit(1);
      if(prior.length)return;
    }
    const receipt=messages.find((m)=>m.messageKey==='EVIDENCE_RECEIVED')?.content;
    const pending=messages.find((m)=>m.messageKey==='EVIDENCE_PENDING')?.content;
    const reply:LineMessageObject[]=[];if(receipt)reply.push({type:'text',text:receipt});if(pending)reply.push({type:'text',text:pending});
    if(reply.length)await this.enqueueReply(event.providerEventId,lineUserId,replyToken,reply);
  }

  private async ensureClaimActivities(claimId:string,campaignId:string){
    const activities=await this.db.select({id:schema.campaignActivities.id}).from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId,campaignId));
    if(activities.length)await this.db.insert(schema.claimActivities).values(activities.map((activity)=>({claimId,campaignActivityId:activity.id}))).onConflictDoNothing();
  }

  private async ensureLineIdentity(lineUserId: string) {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.channelIdentities).where(and(
        eq(schema.channelIdentities.channel, 'LINE'), eq(schema.channelIdentities.externalUserId, lineUserId),
      )).limit(1);
      if (existing) return;
      const [user] = await tx.insert(schema.users).values({}).returning({ id: schema.users.id });
      const [identity] = await tx.insert(schema.channelIdentities).values({ userId: user!.id, channel: 'LINE', externalUserId: lineUserId })
        .onConflictDoNothing({ target: [schema.channelIdentities.channel, schema.channelIdentities.externalUserId] }).returning({ id: schema.channelIdentities.id });
      if (!identity) await tx.delete(schema.users).where(eq(schema.users.id, user!.id));
    });
  }

  private async enqueueReply(dedupeKey: string, recipient: string, replyToken: string, messages: LineMessageObject[]) {
    this.assertDeliveryConfigured();
    if (messages.length > 5) throw new DomainError('LINE reply supports at most five message objects.', 'LINE_REPLY_TOO_MANY_MESSAGES');
    await this.db.insert(schema.outboundMessages).values({
      dedupeKey: `line-reply:${dedupeKey}`, deliveryType:'REPLY',recipientLineUserId: recipient, replyToken,
      messages: messages as Record<string, unknown>[], status: 'READY',
    }).onConflictDoNothing({ target: schema.outboundMessages.dedupeKey });
    await this.deliverReply(`line-reply:${dedupeKey}`);
  }

  private async deliverReply(dedupeKey: string) {
    this.assertDeliveryConfigured();
    const [row] = await this.db.update(schema.outboundMessages).set({ status: 'SENDING', sendingStartedAt: new Date(),
      attemptCount: sql`${schema.outboundMessages.attemptCount} + 1`, updatedAt: new Date() })
      .where(and(eq(schema.outboundMessages.dedupeKey, dedupeKey), eq(schema.outboundMessages.status, 'READY'))).returning();
    if (!row || !row.replyToken) return;
    try {
      await this.sender.sendReply(row.replyToken, row.messages);
      await this.db.update(schema.outboundMessages).set({ status: 'SENT', sentAt: new Date(), replyToken: null, errorCode: null })
        .where(eq(schema.outboundMessages.id, row.id));
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : null;
      const result = status !== null && status >= 400 && status < 500 ? 'FAILED' : 'UNCERTAIN';
      await this.db.update(schema.outboundMessages).set({ status: result, replyToken: null, errorCode: errorCode(error) })
        .where(eq(schema.outboundMessages.id, row.id));
    }
  }

  private async deliverOutbox(dedupeKey:string){
    this.assertDeliveryConfigured();
    const [row]=await this.db.update(schema.outboundMessages).set({status:'SENDING',sendingStartedAt:new Date(),attemptCount:sql`${schema.outboundMessages.attemptCount}+1`,updatedAt:new Date()})
      .where(and(eq(schema.outboundMessages.dedupeKey,dedupeKey),eq(schema.outboundMessages.status,'READY'))).returning();
    if(!row)return;
    try{
      if(row.deliveryType==='PUSH'){
        if(!this.sender.sendToUser)throw new Error('LINE push adapter is unavailable');
        const pushKey=await this.getOrCreatePushRetryKey(row.id);
        await this.sender.sendToUser(row.recipientLineUserId,row.messages,pushKey);
      }else{
        if(!row.replyToken)throw new Error('Reply token missing');
        await this.sender.sendReply(row.replyToken,row.messages);
      }
      await this.db.update(schema.outboundMessages).set({status:'SENT',sentAt:new Date(),replyToken:null,errorCode:null}).where(eq(schema.outboundMessages.id,row.id));
    }catch(error){
      const status=typeof error==='object'&&error!==null&&'status'in error?Number(error.status):null;
      await this.db.update(schema.outboundMessages).set({status:status!==null&&status>=400&&status<500?'FAILED':'UNCERTAIN',replyToken:null,errorCode:errorCode(error)}).where(eq(schema.outboundMessages.id,row.id));
    }
  }

  private assertDeliveryConfigured() {
    if (!this.accessTokenConfigured) throw new DomainError('LINE_CHANNEL_ACCESS_TOKEN is required before reply delivery.', 'LINE_CONFIG_MISSING');
  }
}

export function createWebhookEventProcessor(db: Db, accessToken: string, evidenceStorageDir='work/evidence') {
  const adapter=new LineMessageAdapter(new LineMessagingClient(accessToken));
  const evidence=new EvidenceService(db,new LineMessageContentClient(accessToken),new FileSystemEvidenceStorage(evidenceStorageDir));
  return new WebhookEventProcessor(db,adapter,Boolean(accessToken.trim()),evidence);
}

export { campaignButtonPostback };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string | null { return typeof value === 'string' && value.length ? value : null; }
function errorCode(error: unknown) { return error instanceof Error ? error.name : 'PROCESSING_ERROR'; }
function claimStatusMessageKey(status:string){return({IN_PROGRESS:'CLAIM_STATUS_IN_PROGRESS',PROOF_SUBMITTED:'CLAIM_STATUS_UNDER_REVIEW',UNDER_REVIEW:'CLAIM_STATUS_UNDER_REVIEW',APPROVED:'CLAIM_STATUS_APPROVED',REJECTED:'CLAIM_STATUS_REJECTED',REWARD_SENT:'CLAIM_STATUS_APPROVED'} as Record<string,string>)[status]??'CLAIM_ALREADY_EXISTS'}
