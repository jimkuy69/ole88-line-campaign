import { and, desc, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import { assertClaimTransition, type ClaimState } from '../../domain/claim-state.js';
import { DomainError } from '../../domain/errors.js';
import type { LineMessageContent, LineMessageContentPort } from '../../integrations/line/message-client.js';
import type { EvidenceStorage, ImageMimeType } from './storage.js';
import { createHash } from 'node:crypto';

type Db = NodePgDatabase<typeof schema>;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const allowedClaimStatuses = ['CLAIM_CREATED','ACTIVITY_SENT','IN_PROGRESS','PROOF_SUBMITTED','UNDER_REVIEW','REJECTED'] as const;

export class EvidenceService {
  constructor(private readonly db: Db, private readonly fetcher: LineMessageContentPort, private readonly storage: EvidenceStorage,
    private readonly now: () => Date = () => new Date()) {}

  async requestUploadContext(lineUserId: string, campaignCode: string, activityKey: string, providerEventId: string) {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(schema.channelIdentities).where(and(eq(schema.channelIdentities.channel,'LINE'),eq(schema.channelIdentities.externalUserId,lineUserId))).limit(1);
      if (!identity) throw new DomainError('LINE identity has no claim for this campaign.', 'CLAIM_NOT_FOUND');
      const [campaign] = await tx.select().from(schema.campaigns).where(eq(schema.campaigns.code,campaignCode)).limit(1);
      if (!campaign) throw new DomainError('Campaign not found.', 'CAMPAIGN_NOT_FOUND');
      const [claim] = await tx.select().from(schema.claims).where(and(eq(schema.claims.userId,identity.userId),eq(schema.claims.campaignId,campaign.id))).for('update').limit(1);
      if (!claim) throw new DomainError('No claim found for the selected campaign.', 'CLAIM_NOT_FOUND');
      if (!allowedClaimStatuses.includes(claim.status as typeof allowedClaimStatuses[number])) throw new DomainError('This claim is not accepting evidence.', 'CLAIM_NOT_ACCEPTING_EVIDENCE');
      const [activity] = await tx.select({activity:schema.campaignActivities,progress:schema.claimActivities})
        .from(schema.claimActivities).innerJoin(schema.campaignActivities,eq(schema.campaignActivities.id,schema.claimActivities.campaignActivityId))
        .where(and(eq(schema.claimActivities.claimId,claim.id),eq(schema.campaignActivities.activityKey,activityKey),eq(schema.campaignActivities.campaignId,campaign.id))).limit(1);
      if (!activity) throw new DomainError('Activity does not belong to this claim.', 'CLAIM_ACTIVITY_NOT_FOUND');
      if (!activity.activity.enabled) throw new DomainError('This activity is not accepting evidence.', 'CLAIM_ACTIVITY_DISABLED');
      if (activity.progress.status === 'APPROVED') throw new DomainError('This activity is already approved.', 'CLAIM_ACTIVITY_ALREADY_APPROVED');
      if (activity.progress.status === 'UNDER_REVIEW' || activity.progress.status === 'SUBMITTED') {
        throw new DomainError('This activity already has evidence awaiting review.', 'CLAIM_ACTIVITY_EVIDENCE_PENDING');
      }
      const expiresAt = new Date(this.now().getTime()+CONTEXT_TTL_MS);
      const [previous]=await tx.select().from(schema.evidenceUploadContexts).where(eq(schema.evidenceUploadContexts.channelIdentityId,identity.id)).for('update').limit(1);
      if(previous?.requestedEventId!==providerEventId)await tx.insert(schema.evidenceUploadContexts).values({channelIdentityId:identity.id,claimId:claim.id,claimActivityId:activity.progress.id,
        requestedEventId:providerEventId,expiresAt,consumedAt:null}).onConflictDoUpdate({target:schema.evidenceUploadContexts.channelIdentityId,
          set:{claimId:claim.id,claimActivityId:activity.progress.id,requestedEventId:providerEventId,expiresAt,consumedAt:null,createdAt:this.now()}});
      return {campaign,claim,activity:activity.activity,identity,expiresAt};
    });
  }

  async currentContext(lineUserId: string) {
    const [row] = await this.db.select({identity:schema.channelIdentities,context:schema.evidenceUploadContexts,claim:schema.claims,
      progress:schema.claimActivities,activity:schema.campaignActivities,campaign:schema.campaigns}).from(schema.channelIdentities)
      .innerJoin(schema.evidenceUploadContexts,eq(schema.evidenceUploadContexts.channelIdentityId,schema.channelIdentities.id))
      .innerJoin(schema.claims,eq(schema.claims.id,schema.evidenceUploadContexts.claimId))
      .innerJoin(schema.claimActivities,eq(schema.claimActivities.id,schema.evidenceUploadContexts.claimActivityId))
      .innerJoin(schema.campaignActivities,eq(schema.campaignActivities.id,schema.claimActivities.campaignActivityId))
      .innerJoin(schema.campaigns,eq(schema.campaigns.id,schema.claims.campaignId))
      .where(and(eq(schema.channelIdentities.channel,'LINE'),eq(schema.channelIdentities.externalUserId,lineUserId),gt(schema.evidenceUploadContexts.expiresAt,this.now()),isNull(schema.evidenceUploadContexts.consumedAt)))
      .limit(1);
      if (!row || row.claim.userId !== row.identity.userId || row.claim.campaignId !== row.campaign.id
      || row.progress.claimId!==row.claim.id || row.progress.campaignActivityId!==row.activity.id || row.activity.campaignId!==row.campaign.id
      || row.context.claimId!==row.claim.id || row.context.claimActivityId!==row.progress.id
      || !allowedClaimStatuses.includes(row.claim.status as typeof allowedClaimStatuses[number])) return null;
    return row;
  }

  async receiveImage(lineUserId: string, messageId: string, providerEventId: string) {
    const existing = await this.findBySourceMessage(messageId);
    if (existing) {
      if (existing.identity.externalUserId !== lineUserId) throw new DomainError('Image message owner does not match.', 'EVIDENCE_OWNER_MISMATCH');
      return {kind:'duplicate' as const,evidence:existing.evidence,campaign:existing.campaign,identity:existing.identity};
    }
    const context = await this.currentContext(lineUserId);
    if (!context) return {kind:'no_context' as const};
    const content = await this.fetcher.getMessageContent(messageId);
    const image = validateImage(content);
      if (!image) return {kind:'invalid_image' as const,campaign:context.campaign};
    const storageKey = createHash('sha256').update(`LINE:${messageId}`).digest('hex')+(image.mimeType==='image/jpeg'?'.jpg':'.png');
    await this.storage.put(storageKey,image.mimeType,image.data);
    try { return await this.db.transaction(async (tx) => {
      const [lockedContext] = await tx.select().from(schema.evidenceUploadContexts).where(eq(schema.evidenceUploadContexts.channelIdentityId,context.identity.id)).for('update').limit(1);
      const [identity] = await tx.select().from(schema.channelIdentities).where(eq(schema.channelIdentities.id,context.identity.id)).for('update').limit(1);
      const [claim] = await tx.select().from(schema.claims).where(eq(schema.claims.id,context.claim.id)).for('update').limit(1);
      const [progress] = await tx.select().from(schema.claimActivities).where(eq(schema.claimActivities.id,context.context.claimActivityId)).for('update').limit(1);
      if (!lockedContext || lockedContext.consumedAt || lockedContext.expiresAt<=this.now() || !identity || identity.externalUserId!==lineUserId
        || !claim || !progress || claim.userId!==identity.userId || claim.id!==context.claim.id
        || lockedContext.claimId!==claim.id || lockedContext.claimActivityId!==progress.id
        || !allowedClaimStatuses.includes(claim.status as typeof allowedClaimStatuses[number])) {
        throw new DomainError('Evidence upload context expired or changed; ask the customer to choose an activity again.', 'EVIDENCE_CONTEXT_STALE');
      }
      const [alreadySubmitted] = await tx.select({id:schema.evidence.id}).from(schema.evidence)
        .where(and(eq(schema.evidence.claimActivityId,progress.id),eq(schema.evidence.status,'SUBMITTED'))).limit(1);
      if (alreadySubmitted) throw new DomainError('This activity already has evidence awaiting review.', 'CLAIM_ACTIVITY_EVIDENCE_PENDING');
      const [inserted] = await tx.insert(schema.evidence).values({claimId:claim.id,claimActivityId:progress.id,userId:identity.userId,channelIdentityId:identity.id,
        type:image.mimeType,storageKey,sourceMessageId:messageId,status:'SUBMITTED',version:1,
        metadata:{sizeBytes:image.data.length,sha256:createHash('sha256').update(image.data).digest('hex')}})
        .onConflictDoNothing().returning();
      if (!inserted) {
        const [prior] = await tx.select().from(schema.evidence).where(eq(schema.evidence.sourceMessageId,messageId)).limit(1);
        if (!prior || prior.channelIdentityId!==identity.id || prior.claimActivityId!==progress.id) throw new DomainError('Image was already attached to another activity.', 'EVIDENCE_SOURCE_CONFLICT');
        return {kind:'duplicate' as const,evidence:prior,campaign:context.campaign,identity};
      }
      await tx.update(schema.claimActivities).set({status:'UNDER_REVIEW',updatedAt:this.now()}).where(eq(schema.claimActivities.id,progress.id));
      const nextStatus = advanceClaimForEvidence(claim.status);
      if (nextStatus!==claim.status) await tx.update(schema.claims).set({status:nextStatus,updatedAt:this.now()}).where(eq(schema.claims.id,claim.id));
      await tx.update(schema.evidenceUploadContexts).set({consumedAt:this.now()}).where(eq(schema.evidenceUploadContexts.channelIdentityId,identity.id));
      return {kind:'accepted' as const,evidence:inserted,campaign:context.campaign,identity};
    }); } catch(error) {
      // Keep the deterministic file if another redelivery committed the same LINE message meanwhile.
      const committed=await this.findBySourceMessage(messageId).catch(()=>null);
      if(!committed)await this.storage.delete(storageKey).catch(()=>undefined);
      throw error;
    }
  }

  async listQueue(filters:{campaignId?:string;status?:string;from?:Date;to?:Date;limit?:number}={}) {
    const clauses = [isNotNull(schema.evidence.claimActivityId),isNotNull(schema.evidence.channelIdentityId)];
    if(filters.campaignId)clauses.push(eq(schema.claims.campaignId,filters.campaignId));
    if(filters.status)clauses.push(eq(schema.evidence.status,filters.status));
    if(filters.from)clauses.push(gt(schema.evidence.createdAt,filters.from));
    if(filters.to)clauses.push(lte(schema.evidence.createdAt,filters.to));
    return this.db.select({evidence:schema.evidence,claim:schema.claims,campaign:schema.campaigns,activity:schema.campaignActivities,
      identity:schema.channelIdentities}).from(schema.evidence).innerJoin(schema.claims,eq(schema.claims.id,schema.evidence.claimId))
      .innerJoin(schema.campaigns,eq(schema.campaigns.id,schema.claims.campaignId))
      .innerJoin(schema.claimActivities,eq(schema.claimActivities.id,schema.evidence.claimActivityId))
      .innerJoin(schema.campaignActivities,eq(schema.campaignActivities.id,schema.claimActivities.campaignActivityId))
      .innerJoin(schema.channelIdentities,eq(schema.channelIdentities.id,schema.evidence.channelIdentityId))
      .where(and(...clauses)).orderBy(desc(schema.evidence.createdAt)).limit(Math.min(filters.limit??100,100));
  }

  async reviewDetail(evidenceId:string) {
    const [row]=await this.db.select({evidence:schema.evidence,claim:schema.claims,campaign:schema.campaigns,activity:schema.campaignActivities,
      identity:schema.channelIdentities}).from(schema.evidence).innerJoin(schema.claims,eq(schema.claims.id,schema.evidence.claimId))
      .innerJoin(schema.campaigns,eq(schema.campaigns.id,schema.claims.campaignId))
      .innerJoin(schema.claimActivities,eq(schema.claimActivities.id,schema.evidence.claimActivityId))
      .innerJoin(schema.campaignActivities,eq(schema.campaignActivities.id,schema.claimActivities.campaignActivityId))
      .innerJoin(schema.channelIdentities,eq(schema.channelIdentities.id,schema.evidence.channelIdentityId))
      .where(eq(schema.evidence.id,evidenceId)).limit(1);
    if(!row)throw new DomainError('Evidence not found.','EVIDENCE_NOT_FOUND');
    return row;
  }

  async assertMediaReadable(evidenceId:string) {
    const [row]=await this.db.select({storageKey:schema.evidence.storageKey,claimActivityId:schema.evidence.claimActivityId,channelIdentityId:schema.evidence.channelIdentityId})
      .from(schema.evidence).where(eq(schema.evidence.id,evidenceId)).limit(1);
    if(!row)throw new DomainError('Evidence not found.','EVIDENCE_NOT_FOUND');
    if(!row.claimActivityId||!row.channelIdentityId)throw new DomainError('Legacy evidence has no verified activity or LINE identity and needs manual reconciliation.','EVIDENCE_LEGACY_UNLINKED');
    return row.storageKey;
  }

  async decide(evidenceId:string,actorId:string,decision:'APPROVED'|'REJECTED',expectedVersion:number,reason?:string) {
    if(decision==='REJECTED'&&!reason?.trim())throw new DomainError('A rejection reason is required.','EVIDENCE_REJECTION_REASON_REQUIRED');
    const now=this.now();
    return this.db.transaction(async(tx)=>{
      const [item]=await tx.select().from(schema.evidence).where(eq(schema.evidence.id,evidenceId)).for('update').limit(1);
      if(!item)throw new DomainError('Evidence not found.','EVIDENCE_NOT_FOUND');
      if(!item.claimActivityId||!item.channelIdentityId)throw new DomainError('Legacy evidence has no verified activity or LINE identity and needs manual reconciliation.','EVIDENCE_LEGACY_UNLINKED');
      if(item.version!==expectedVersion||item.status!=='SUBMITTED')throw new DomainError('Evidence changed since it was opened.','EVIDENCE_VERSION_CONFLICT');
      const [claim]=await tx.select().from(schema.claims).where(eq(schema.claims.id,item.claimId)).for('update').limit(1);
      const [progress]=await tx.select().from(schema.claimActivities).where(eq(schema.claimActivities.id,item.claimActivityId)).for('update').limit(1);
      if(!claim||!progress||claim.userId!==item.userId)throw new DomainError('Evidence claim relationship is invalid.','EVIDENCE_RELATIONSHIP_INVALID');
      const [owner] = await tx.select({id:schema.channelIdentities.id,userId:schema.channelIdentities.userId})
        .from(schema.channelIdentities).where(eq(schema.channelIdentities.id,item.channelIdentityId)).limit(1);
      if (!owner || owner.userId!==item.userId) throw new DomainError('Evidence LINE identity does not belong to the claim owner.','EVIDENCE_RELATIONSHIP_INVALID');
      const [updated]=await tx.update(schema.evidence).set({status:decision,version:item.version+1,reviewedAt:now,reviewReason:decision==='REJECTED'?reason!.trim():null,updatedAt:now})
        .where(and(eq(schema.evidence.id,evidenceId),eq(schema.evidence.version,expectedVersion),eq(schema.evidence.status,'SUBMITTED'))).returning();
      if(!updated)throw new DomainError('Evidence changed while being reviewed.','EVIDENCE_VERSION_CONFLICT');
      await tx.update(schema.claimActivities).set({status:decision,updatedAt:now}).where(eq(schema.claimActivities.id,progress.id));
      let nextClaimStatus=claim.status;
      if(decision==='REJECTED'&&claim.status!=='REJECTED'){
        if (claim.status === 'UNDER_REVIEW') { assertClaimTransition(claim.status as ClaimState,'REJECTED');nextClaimStatus='REJECTED'; }
        else nextClaimStatus=claim.status;
      } else if(decision==='APPROVED'&&claim.status==='UNDER_REVIEW'){
        const required=await tx.select({status:schema.claimActivities.status}).from(schema.claimActivities)
          .innerJoin(schema.campaignActivities,eq(schema.campaignActivities.id,schema.claimActivities.campaignActivityId))
          .where(and(eq(schema.claimActivities.claimId,claim.id),eq(schema.campaignActivities.required,true),eq(schema.campaignActivities.enabled,true)));
        if(required.length>0&&required.every((activity)=>activity.status==='APPROVED')){
          assertClaimTransition(claim.status as ClaimState,'APPROVED');nextClaimStatus='APPROVED';
        }
      }
      if(nextClaimStatus!==claim.status) await tx.update(schema.claims).set({status:nextClaimStatus,updatedAt:now,...(nextClaimStatus==='APPROVED'?{approvedAt:now}:nextClaimStatus==='REJECTED'?{rejectedAt:now}:{})}).where(eq(schema.claims.id,claim.id));
      const [campaign]=await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id,claim.campaignId)).limit(1);
      const messageKey=decision==='APPROVED'?'EVIDENCE_APPROVED':'EVIDENCE_REJECTED';
      const [message]=await tx.select().from(schema.campaignMessages).where(and(eq(schema.campaignMessages.campaignId,claim.campaignId),eq(schema.campaignMessages.messageKey,messageKey))).limit(1);
      const [identity]=await tx.select().from(schema.channelIdentities).where(eq(schema.channelIdentities.id,item.channelIdentityId)).limit(1);
      if(message&&identity){
        const text=decision==='REJECTED'?message.content.replaceAll('{{reason}}',reason!.trim()):message.content;
        const dedupeKey=`evidence-decision:${evidenceId}:${updated.version}`;
        await tx.insert(schema.outboundMessages).values({dedupeKey,deliveryType:'PUSH',recipientLineUserId:identity.externalUserId,replyToken:null,
          messages:[{type:'text',text}],status:'READY'}).onConflictDoNothing({target:schema.outboundMessages.dedupeKey});
      }
      await tx.insert(schema.auditLogs).values({actorType:'ADMIN',actorId,action:decision==='APPROVED'?'EVIDENCE_APPROVED':'EVIDENCE_REJECTED',
        entityType:'EVIDENCE',entityId:evidenceId,beforeData:{status:item.status,version:item.version,claimStatus:claim.status},
        afterData:{status:updated.status,version:updated.version,claimStatus:nextClaimStatus},metadata:{reason:decision==='REJECTED'?reason!.trim():null}});
      return {evidence:updated,claimStatus:nextClaimStatus,campaign};
    });
  }

  private async findBySourceMessage(messageId:string) {
    const [row]=await this.db.select({evidence:schema.evidence,identity:schema.channelIdentities,campaign:schema.campaigns})
      .from(schema.evidence).innerJoin(schema.channelIdentities,eq(schema.channelIdentities.id,schema.evidence.channelIdentityId))
      .innerJoin(schema.claims,eq(schema.claims.id,schema.evidence.claimId)).innerJoin(schema.campaigns,eq(schema.campaigns.id,schema.claims.campaignId))
      .where(eq(schema.evidence.sourceMessageId,messageId)).limit(1);
    return row??null;
  }
}

export function validateImage(content:LineMessageContent):{mimeType:ImageMimeType;data:Buffer}|null{
  if(content.data.length<8||content.data.length>MAX_IMAGE_BYTES)return null;
  const jpeg=content.data[0]===0xff&&content.data[1]===0xd8&&content.data[2]===0xff;
  const png=content.data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(jpeg&&content.contentType==='image/jpeg')return{mimeType:'image/jpeg',data:content.data};
  if(png&&content.contentType==='image/png')return{mimeType:'image/png',data:content.data};
  return null;
}

function advanceClaimForEvidence(status:typeof schema.claims.$inferSelect.status){
  let current=status as ClaimState;
  if(current==='CLAIM_CREATED'||current==='ACTIVITY_SENT'||current==='REJECTED'){
    assertClaimTransition(current,'IN_PROGRESS');current='IN_PROGRESS';
  }
  if(current==='IN_PROGRESS') { assertClaimTransition(current,'PROOF_SUBMITTED');current='PROOF_SUBMITTED'; }
  if(current==='PROOF_SUBMITTED') { assertClaimTransition(current,'UNDER_REVIEW');current='UNDER_REVIEW'; }
  if(current!=='UNDER_REVIEW')throw new DomainError('Claim cannot accept evidence in its current state.','CLAIM_NOT_ACCEPTING_EVIDENCE');
  return current;
}
