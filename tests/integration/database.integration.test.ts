import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { CampaignService } from '../../src/modules/campaigns/campaign-service.js';
import { ClaimService } from '../../src/modules/claims/claim-service.js';
import { DrizzleClaimStore } from '../../src/modules/claims/drizzle-claim-store.js';
import { TrackingService } from '../../src/modules/tracking/tracking-service.js';
import { DrizzleWebhookEventStore, WebhookInbox } from '../../src/modules/webhooks/webhook-inbox.js';
import { WebhookEventProcessor, buildActivityCard, type ReplySender } from '../../src/modules/webhooks/webhook-processor.js';
import { campaignButtonPostback } from '../../src/modules/campaigns/postback-data.js';
import * as schema from '../../src/db/schema.js';
import { AdminAuthService, sha256 } from '../../src/modules/admin/admin-auth-service.js';
import { buildServer } from '../../src/server.js';
import { loadConfig } from '../../src/config/env.js';
import { EvidenceService } from '../../src/modules/evidence/evidence-service.js';
import { FileSystemEvidenceStorage } from '../../src/modules/evidence/storage.js';
import { AnalyticsService } from '../../src/modules/admin/analytics-service.js';
import { bangkokDateRange } from '../../src/modules/admin/bangkok-date-range.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const safeLocalTestDatabase = Boolean(parsedDatabaseUrl
  && ['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname)
  && /(?:^|[_-])test(?:[_-]|$)/i.test(parsedDatabaseUrl.pathname.slice(1)));
if (databaseUrl && !safeLocalTestDatabase) {
  throw new Error('TEST_DATABASE_URL must target a local database whose name includes "test"; integration tests truncate it.');
}
const integration = describe.skipIf(!safeLocalTestDatabase);
function editable(detail: {campaign:Record<string,unknown>;buttons:Array<Record<string,unknown>>;activities:Array<Record<string,unknown>>;messages:Array<Record<string,unknown>>}) {
  const c=detail.campaign;
  return {campaign:{code:c.code,name:c.name,templateType:c.templateType,claimPolicy:'SINGLE_CLAIM',title:c.title,subtitle:c.subtitle,rewardType:c.rewardType,
    rewardValue:c.rewardValue,heroImage:c.heroImage,startAt:c.startAt,endAt:c.endAt,maxClaims:c.maxClaims,settings:c.settings||{}},
    buttons:detail.buttons.map(({buttonKey,label,actionType,actionValue,displayOrder,enabled,metadata})=>({buttonKey,label,actionType,actionValue,displayOrder,enabled,metadata})),
    activities:detail.activities.map(({activityKey,title,description,actionType,actionValue,displayOrder,required,enabled,metadata})=>({activityKey,title,description,actionType,actionValue,displayOrder,required,enabled,metadata})),
    messages:detail.messages.map(({messageKey,messageType,content,metadata})=>({messageKey,messageType,content,metadata}))};
}
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

integration('PostgreSQL foundation constraints', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS drizzle; DROP TABLE IF EXISTS drizzle.__drizzle_migrations;');
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE admin_login_attempts, admin_sessions, admin_users, outbound_messages, webhook_events, audit_logs, tracking_events, evidence, claim_activities, claims, campaign_messages, campaign_activities, campaign_buttons, campaigns, channel_identities, users CASCADE');
  });

  it('reports idempotent funnel metrics, current statuses, Bangkok daily rows, and paginated redacted issues', async () => {
    const from=new Date('2026-09-01T00:00:00.000Z');const to=new Date('2026-10-01T00:00:00.000Z');
    const [campaign]=await db.insert(schema.campaigns).values({code:'ANALYTICS_CAMPAIGN',name:'Analytics',templateType:'WELCOME',status:'ACTIVE'}).returning();
    const [user1,user2]=await db.insert(schema.users).values([{},{}]).returning();
    const tracking=new TrackingService(db);
    await tracking.trackEvent({sourceEventId:'analytics-follow-1',userId:user1!.id,campaignId:campaign!.id,eventType:'FOLLOW_PROCESSED',metadata:{lineUserId:'never-return-this'}});
    await tracking.trackEvent({sourceEventId:'analytics-follow-1',userId:user1!.id,campaignId:campaign!.id,eventType:'FOLLOW_PROCESSED'});
    await tracking.trackEvent({sourceEventId:'analytics-follow-2',userId:user2!.id,campaignId:campaign!.id,eventType:'FOLLOW_PROCESSED'});
    await db.insert(schema.trackingEvents).values({sourceEventId:'analytics-follow-outside-range',userId:user2!.id,campaignId:campaign!.id,eventType:'FOLLOW_PROCESSED',createdAt:new Date('2026-08-31T23:59:59Z')});
    const [identity1]=await db.insert(schema.channelIdentities).values({userId:user1!.id,channel:'LINE',externalUserId:'analytics-line-1'}).returning();
    await db.insert(schema.channelIdentities).values({userId:user2!.id,channel:'LINE',externalUserId:'analytics-line-2'});
    const claimService=new ClaimService(new DrizzleClaimStore(db),()=>new Date('2026-09-15T12:00:00.000Z'));
    const first=await claimService.createClaim(user1!.id,campaign!.code,'analytics-claim-first');
    const duplicate=await claimService.createClaim(user1!.id,campaign!.code,'analytics-claim-duplicate');
    await claimService.createClaim(user1!.id,campaign!.code,'analytics-claim-first');
    expect(first.created).toBe(true);expect(duplicate.created).toBe(false);
    const [firstRequest]=await db.select().from(schema.trackingEvents).where(eq(schema.trackingEvents.sourceEventId,'analytics-claim-first'));
    expect(firstRequest!.metadata).toMatchObject({outcome:'NEW',created:true});
    const [claim2]=await db.insert(schema.claims).values({userId:user2!.id,campaignId:campaign!.id,claimCode:'ANALYTICS_CLAIM_2',claimedAt:new Date('2026-09-14T18:00:00Z')}).returning();
    await db.insert(schema.outboundMessages).values({dedupeKey:'analytics-welcome-1',deliveryType:'REPLY',campaignId:campaign!.id,purpose:'WELCOME',recipientLineUserId:'analytics-line-1',replyToken:null,messages:[],status:'SENT',createdAt:new Date('2026-09-15T12:00:00Z'),sentAt:new Date('2026-09-15T12:00:01Z')});
    await db.insert(schema.evidence).values([
      {claimId:first.claim.id,userId:user1!.id,channelIdentityId:identity1!.id,type:'image/png',storageKey:'analytics-pending.png',status:'SUBMITTED',createdAt:new Date('2026-09-16T12:00:00Z')},
      {claimId:claim2!.id,userId:user2!.id,type:'image/png',storageKey:'analytics-approved.png',status:'APPROVED',createdAt:new Date('2026-09-17T12:00:00Z'),reviewedAt:new Date('2026-09-19T12:00:00Z')},
      {claimId:claim2!.id,userId:user2!.id,type:'image/png',storageKey:'analytics-rejected.png',status:'REJECTED',createdAt:new Date('2026-09-17T13:00:00Z'),reviewedAt:new Date('2026-09-20T12:00:00Z')},
    ]);
    await db.insert(schema.webhookEvents).values([
      {channel:'LINE',providerEventId:'analytics-webhook-failed',eventType:'postback',payload:{secret:'must-not-leak'},status:'FAILED',receivedAt:new Date('2026-09-21T12:00:00Z'),errorCode:'TEST_FAILURE'},
      {channel:'LINE',providerEventId:'analytics-webhook-processing',eventType:'follow',payload:{},status:'PROCESSING',leaseUntil:new Date('2026-09-21T11:00:00Z'),receivedAt:new Date('2026-09-21T10:00:00Z')},
      {channel:'LINE',providerEventId:'analytics-webhook-received',eventType:'message',payload:{},status:'RECEIVED',receivedAt:new Date('2026-09-21T12:30:00Z')},
    ]);
    await db.insert(schema.outboundMessages).values([
      {dedupeKey:'analytics-outbound-uncertain',deliveryType:'PUSH',campaignId:campaign!.id,purpose:'EVIDENCE_DECISION',recipientLineUserId:'line-private',replyToken:null,messages:[{type:'text',text:'private body'}],status:'UNCERTAIN'},
      {dedupeKey:'analytics-outbound-failed',deliveryType:'REPLY',campaignId:campaign!.id,purpose:'CLAIM_RESPONSE',recipientLineUserId:'line-private',replyToken:null,messages:[],status:'FAILED'},
    ]);
    const service=new AnalyticsService(db,()=>new Date('2026-09-25T12:00:00Z'));
    const result=await service.overview({from,to,campaignId:campaign!.id});
    expect(result.metrics).toMatchObject({follow_events:2,unique_followers:2,welcome_sent:1,claim_request_events:2,claim_request_claims:1,
      duplicate_claim_requests:1,unique_claims:2,unique_claimers:2,proof_submitted:3,claims_with_proof:2,pending_review:1,evidence_approved:1,claims_approved:1,evidence_rejected:1,claims_rejected:1});
    expect(result.outbound).toMatchObject({SENT:1,UNCERTAIN:1,FAILED:1});
    expect(result.webhooks).toMatchObject({FAILED:1,PROCESSING:1,RECEIVED:1});
    expect(result.daily.length).toBeGreaterThan(0);
    expect(result.daily).toContainEqual({day:'2026-09-15',metric:'UNIQUE_CLAIM',total:1});
    const webhookIssues=await service.issues('webhook',{limit:1,offset:0});
    expect(webhookIssues).toHaveLength(1);expect(JSON.stringify(webhookIssues)).not.toContain('must-not-leak');
    expect(await service.issues('webhook',{limit:1,offset:1})).toHaveLength(1);
    // Webhook rows have no reliable campaign attribution; a campaign filter must not hide them.
    expect(await service.issues('webhook',{campaignId:campaign!.id,limit:10,offset:0})).toHaveLength(2);
    const outboundIssues=await service.issues('outbound',{campaignId:campaign!.id,limit:10,offset:0});
    expect(outboundIssues).toHaveLength(2);expect(JSON.stringify(outboundIssues)).not.toContain('private body');
    expect(await service.issues('review',{campaignId:campaign!.id,limit:10,offset:0})).toHaveLength(1);
  });

  it('returns zero-valued metrics and empty trends when no data matches a date range', async () => {
    const result=await new AnalyticsService(db).overview({from:new Date('2020-01-01T00:00:00Z'),to:new Date('2020-02-01T00:00:00Z')});
    expect(result.metrics).toMatchObject({follow_events:0,unique_followers:0,welcome_sent:0,claim_request_events:0,unique_claims:0,pending_review:0});
    expect(result.daily).toEqual([]);expect(result.outbound).toEqual({});expect(result.webhooks).toEqual({});
  });

  afterAll(async () => { await pool?.end(); });

  it('enforces unique campaign codes and channel identities', async () => {
    const campaigns = new CampaignService(db);
    await campaigns.createCampaign({ code: 'UNIQUE_CODE', name: 'One', templateType: 'CUSTOM_CAMPAIGN' });
    await expect(campaigns.createCampaign({ code: 'UNIQUE_CODE', name: 'Two', templateType: 'CUSTOM_CAMPAIGN' })).rejects.toThrow();

    const [user] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.channelIdentities).values({ userId: user!.id, channel: 'LINE', externalUserId: 'line-user-1' });
    await expect(db.insert(schema.channelIdentities).values({ userId: user!.id, channel: 'LINE', externalUserId: 'line-user-1' })).rejects.toThrow();
  });

  it('ingests image evidence only for the selected owned claim activity, deduplicates LINE message IDs, and resumes after rejection', async () => {
    const [campaign]=await db.insert(schema.campaigns).values({code:'EVIDENCE_FLOW',name:'Evidence flow',templateType:'ACTIVITY'}).returning();
    const [activities]=[await db.insert(schema.campaignActivities).values([
      {campaignId:campaign!.id,activityKey:'A',title:'Activity A',actionType:'URI',actionValue:'https://example.org/a',required:true,enabled:true},
      {campaignId:campaign!.id,activityKey:'B',title:'Activity B',actionType:'URI',actionValue:'https://example.org/b',required:true,enabled:true},
    ]).returning()];
    await db.insert(schema.campaignMessages).values([
      {campaignId:campaign!.id,messageKey:'EVIDENCE_APPROVED',messageType:'TEXT',content:'Approved.'},
      {campaignId:campaign!.id,messageKey:'EVIDENCE_REJECTED',messageType:'TEXT',content:'Rejected: {{reason}}'},
    ]);
    const [user]=await db.insert(schema.users).values({}).returning();
    await db.update(schema.campaigns).set({status:'ACTIVE'}).where(eq(schema.campaigns.id,campaign!.id));
    const [identity]=await db.insert(schema.channelIdentities).values({userId:user!.id,channel:'LINE',externalUserId:'line-evidence-owner'}).returning();
    const [claim]=await db.insert(schema.claims).values({userId:user!.id,campaignId:campaign!.id,claimCode:'EVID-CLAIM',status:'CLAIM_CREATED'}).returning();
    const progress=await db.insert(schema.claimActivities).values(activities.map((activity)=>({claimId:claim!.id,campaignActivityId:activity.id}))).returning();
    const scratch=await mkdtemp(join(tmpdir(),'ole88-evidence-'));
    const bytes=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
    const storage=new FileSystemEvidenceStorage(scratch);
    let failDownload=false;
    const service=new EvidenceService(db,{getMessageContent:async()=>{if(failDownload)throw new Error('temporary download failure');return{contentType:'image/png',data:bytes}}},storage);
    try {
      await expect(service.receiveImage('line-evidence-owner','unknown-image','no-activity')).resolves.toMatchObject({kind:'no_context'});
      await expect(service.requestUploadContext('line-other','EVIDENCE_FLOW','A','request-wrong-owner')).rejects.toMatchObject({code:'CLAIM_NOT_FOUND'});
      await service.requestUploadContext('line-evidence-owner','EVIDENCE_FLOW','A','request-a');
      await expect(service.receiveImage('line-someone-else','image-owner-check','wrong-user')).resolves.toMatchObject({kind:'no_context'});
      failDownload=true;
      await expect(service.receiveImage('line-evidence-owner','image-retry','event-download-failure')).rejects.toThrow('temporary download failure');
      expect(await service.currentContext('line-evidence-owner')).not.toBeNull();
      failDownload=false;
      const accepted=await service.receiveImage('line-evidence-owner','image-one','event-one');
      expect(accepted).toMatchObject({kind:'accepted',evidence:{claimActivityId:progress[0]!.id,channelIdentityId:identity!.id,status:'SUBMITTED'}});
      if(accepted.kind!=='accepted')throw new Error('Expected evidence acceptance');
      expect(await service.receiveImage('line-evidence-owner','image-one','event-redelivery')).toMatchObject({kind:'duplicate'});
      expect(await db.select().from(schema.evidence)).toHaveLength(1);
      const wrongOwner=await db.insert(schema.users).values({}).returning();
      await db.insert(schema.channelIdentities).values({userId:wrongOwner[0]!.id,channel:'LINE',externalUserId:'line-intruder'});
      await expect(service.receiveImage('line-intruder','image-one','other-event')).rejects.toMatchObject({code:'EVIDENCE_OWNER_MISMATCH'});
      await expect(service.decide(accepted.evidence.id,'admin-id','REJECTED',accepted.evidence.version,'Unreadable proof'))
        .resolves.toMatchObject({claimStatus:'REJECTED'});
      const rejected=(await db.select().from(schema.claims).where(eq(schema.claims.id,claim!.id)))[0]!;
      expect(rejected.status).toBe('REJECTED');
      const oldEvidence=(await db.select().from(schema.evidence).where(eq(schema.evidence.id,accepted.evidence.id)))[0]!;
      expect(oldEvidence).toMatchObject({status:'REJECTED',reviewReason:'Unreadable proof'});
      await service.requestUploadContext('line-evidence-owner','EVIDENCE_FLOW','A','request-a-again');
      const replacement=await service.receiveImage('line-evidence-owner','image-two','event-two');
      expect(replacement).toMatchObject({kind:'accepted',evidence:{claimActivityId:progress[0]!.id}});
      if(replacement.kind!=='accepted')throw new Error('Expected replacement evidence');
      await service.requestUploadContext('line-evidence-owner','EVIDENCE_FLOW','B','request-b');
      const second=await service.receiveImage('line-evidence-owner','image-three','event-three');
      expect(second).toMatchObject({kind:'accepted',evidence:{claimActivityId:progress[1]!.id}});
      if(second.kind!=='accepted')throw new Error('Expected second required activity evidence');
      await service.decide(replacement.evidence.id,'admin-id','APPROVED',replacement.evidence.version);
      expect((await db.select().from(schema.claims).where(eq(schema.claims.id,claim!.id)))[0]!.status).not.toBe('APPROVED');
      await service.decide(second.evidence.id,'admin-id','APPROVED',second.evidence.version);
      expect((await db.select().from(schema.claims).where(eq(schema.claims.id,claim!.id)))[0]!.status).toBe('APPROVED');
      expect((await db.select().from(schema.claims).where(eq(schema.claims.id,claim!.id)))[0]!.status).not.toBe('REWARD_SENT');
      const queuedNotifications=await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.deliveryType,'PUSH'));
      expect(queuedNotifications.every((row)=>row.campaignId===campaign!.id&&row.purpose==='EVIDENCE_DECISION')).toBe(true);
      const retryKeys:string[]=[];
      const pushWorker=new WebhookEventProcessor(db,{sendReply:async()=>undefined,sendToUser:async(_user,_messages,retryKey)=>{retryKeys.push(retryKey!)} });
      await pushWorker.processReadyPushes();
      const notifications=await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.deliveryType,'PUSH'));
      expect(notifications).toHaveLength(3);
      expect(notifications.every((row)=>row.status==='SENT'&&row.retryKey&&row.lineRequestId===null)).toBe(true);
      expect(new Set(retryKeys).size).toBe(3);
      expect(notifications.map((row)=>row.retryKey).sort()).toEqual([...retryKeys].sort());
    } finally { await rm(scratch,{recursive:true,force:true}); }
  });

  it('filters review dates on Bangkok calendar days with a half-open interval', async () => {
    const [campaign]=await db.insert(schema.campaigns).values({code:'REVIEW_DATE_RANGE',name:'Review range',templateType:'ACTIVITY'}).returning();
    const [activity]=await db.insert(schema.campaignActivities).values({campaignId:campaign!.id,activityKey:'PROOF',title:'Proof',actionType:'URI'}).returning();
    const [user]=await db.insert(schema.users).values({}).returning();
    const [identity]=await db.insert(schema.channelIdentities).values({userId:user!.id,channel:'LINE',externalUserId:'review-range-user'}).returning();
    const [claim]=await db.insert(schema.claims).values({userId:user!.id,campaignId:campaign!.id,claimCode:'REVIEW_RANGE_CLAIM'}).returning();
    const [progress]=await db.insert(schema.claimActivities).values({claimId:claim!.id,campaignActivityId:activity!.id}).returning();
    const evidence=await db.insert(schema.evidence).values([
      {claimId:claim!.id,claimActivityId:progress!.id,userId:user!.id,channelIdentityId:identity!.id,type:'image/png',storageKey:'before.png',sourceMessageId:'review-before',status:'SUBMITTED',createdAt:new Date('2026-09-25T16:59:59.999Z')},
      {claimId:claim!.id,claimActivityId:progress!.id,userId:user!.id,channelIdentityId:identity!.id,type:'image/png',storageKey:'start.png',sourceMessageId:'review-start',status:'SUBMITTED',createdAt:new Date('2026-09-25T17:00:00.000Z')},
      {claimId:claim!.id,claimActivityId:progress!.id,userId:user!.id,channelIdentityId:identity!.id,type:'image/png',storageKey:'last.png',sourceMessageId:'review-last',status:'SUBMITTED',createdAt:new Date('2026-09-26T16:59:59.999Z')},
      {claimId:claim!.id,claimActivityId:progress!.id,userId:user!.id,channelIdentityId:identity!.id,type:'image/png',storageKey:'end.png',sourceMessageId:'review-end',status:'SUBMITTED',createdAt:new Date('2026-09-26T17:00:00.000Z')},
    ]).returning();
    const range=bangkokDateRange('2026-09-26','2026-09-26');
    const rows=await new EvidenceService(db,{getMessageContent:async()=>{throw new Error('unused');}},{put:async()=>undefined,read:async()=>Buffer.alloc(0),delete:async()=>undefined})
      .listQueue({...(range.from?{from:range.from}:{}),...(range.to?{to:range.to}:{})});
    expect(rows.map((row)=>row.evidence.id)).toEqual([evidence[2]!.id,evidence[1]!.id]);
  });

  it('deduplicates concurrent evidence event processing and version-checks competing Admin decisions', async () => {
    const [campaign]=await db.insert(schema.campaigns).values({code:'EVIDENCE_RACE',name:'Evidence race',templateType:'ACTIVITY'}).returning();
    const [activity]=await db.insert(schema.campaignActivities).values({campaignId:campaign!.id,activityKey:'CHECK',title:'Check',actionType:'URI',actionValue:'https://example.org',required:true,enabled:true}).returning();
    const [user]=await db.insert(schema.users).values({}).returning();
    await db.update(schema.campaigns).set({status:'ACTIVE'}).where(eq(schema.campaigns.id,campaign!.id));
    const [identity]=await db.insert(schema.channelIdentities).values({userId:user!.id,channel:'LINE',externalUserId:'line-evidence-race'}).returning();
    const [claim]=await db.insert(schema.claims).values({userId:user!.id,campaignId:campaign!.id,claimCode:'RACE-CLAIM',status:'CLAIM_CREATED'}).returning();
    const [progress]=await db.insert(schema.claimActivities).values({claimId:claim!.id,campaignActivityId:activity!.id}).returning();
    const [row]=await db.insert(schema.evidence).values({claimId:claim!.id,claimActivityId:progress!.id,userId:user!.id,channelIdentityId:identity!.id,
      type:'image/png',storageKey:'a'.repeat(64)+'.png',sourceMessageId:'seed-image-id',status:'SUBMITTED',version:1}).returning();
    const service=new EvidenceService(db,{getMessageContent:async()=>({contentType:'image/png',data:Buffer.alloc(0)})},new FileSystemEvidenceStorage(join(tmpdir(),'unused-evidence')));
    const decisions=await Promise.allSettled([
      service.decide(row!.id,'admin-one','APPROVED',1),
      service.decide(row!.id,'admin-two','REJECTED',1,'Not eligible'),
    ]);
    expect(decisions.filter((result)=>result.status==='fulfilled')).toHaveLength(1);
    expect(decisions.filter((result)=>result.status==='rejected')).toHaveLength(1);
    expect(decisions.find((result)=>result.status==='rejected')).toMatchObject({reason:{code:'EVIDENCE_VERSION_CONFLICT'}});
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId,row!.id))).toHaveLength(1);
  });

  it('protects evidence media and review actions behind Admin authentication and CSRF', async () => {
    const app=buildServer(loadConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl!}),db);
    try {
      const denied=await app.inject({method:'GET',url:'/api/admin/reviews'});
      expect(denied.statusCode).toBe(401);
      expect((await app.inject({method:'GET',url:'/api/admin/analytics?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z'})).statusCode).toBe(401);
      const image=await app.inject({method:'GET',url:'/api/admin/evidence/not-an-id/content'});
      expect(image.statusCode).toBe(401);
      const post=await app.inject({method:'POST',url:'/api/admin/reviews/not-an-id/approve',payload:{expectedVersion:1}});
      expect(post.statusCode).toBe(401);
      await new AdminAuthService(db).createFirstAdmin('reviewer','A safe review passphrase!');
      const login=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'reviewer',password:'A safe review passphrase!'}});
      const cookieHeader=login.headers['set-cookie'];const cookie=Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!;
      const headers={cookie:cookie.split(';')[0]!};
      const missingCsrf=await app.inject({method:'POST',url:'/api/admin/reviews/not-an-id/approve',headers,payload:{expectedVersion:1}});
      expect(missingCsrf.statusCode).toBe(403);
      const queue=await app.inject({method:'GET',url:'/api/admin/reviews',headers});
      expect(queue.statusCode).toBe(200);
      const rawToken=decodeURIComponent(cookie.split(';')[0]!.split('=').slice(1).join('='));
      await db.update(schema.adminSessions).set({expiresAt:new Date(Date.now()-1000)}).where(eq(schema.adminSessions.tokenHash,sha256(rawToken)));
      expect((await app.inject({method:'GET',url:'/api/admin/reviews',headers})).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('validates Admin Origin independently from the public asset origin behind a proxy', async () => {
    await new AdminAuthService(db).createFirstAdmin('staging-admin','A safe staging passphrase!');
    const app=buildServer(loadConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl!,PUBLIC_BASE_URL:'https://campaign-assets.example.test',ADMIN_ORIGIN:'https://staging.example.test'}),db);
    try {
      const rejected=await app.inject({method:'POST',url:'/api/admin/login',headers:{origin:'https://attacker.example'},payload:{username:'staging-admin',password:'A safe staging passphrase!'}});
      expect(rejected.statusCode).toBe(403);
      const login=await app.inject({method:'POST',url:'/api/admin/login',headers:{origin:'https://staging.example.test'},payload:{username:'staging-admin',password:'A safe staging passphrase!'}});
      expect(login.statusCode).toBe(200);
      const cookieHeader=login.headers['set-cookie'];const cookie=Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!;
      const headers={cookie:cookie.split(';')[0]!,'x-csrf-token':(login.json() as {csrfToken:string}).csrfToken,origin:'https://staging.example.test'};
      expect((await app.inject({method:'POST',url:'/api/admin/campaigns',headers,payload:{templateId:'welcome-claim',code:'STAGING_ORIGIN'}})).statusCode).toBe(200);
      expect((await app.inject({method:'POST',url:'/api/admin/campaigns',headers:{...headers,origin:'https://attacker.example'},payload:{templateId:'welcome-claim',code:'STAGING_ATTACK'}})).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('keeps ADMIN_ONLY staging in draft-only mode even for authenticated publish requests', async () => {
    const [campaign]=await db.insert(schema.campaigns).values({code:'ADMIN_ONLY_DRAFT',name:'Offline draft',templateType:'WELCOME'}).returning();
    await new AdminAuthService(db).createFirstAdmin('offline-admin','A safe offline passphrase!');
    const app=buildServer(loadConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl!,ADMIN_ONLY:'true'}),db);
    try {
      const login=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'offline-admin',password:'A safe offline passphrase!'}});
      expect(login.statusCode).toBe(200);
      const cookieHeader=login.headers['set-cookie'];const cookie=Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!;
      const headers={cookie:cookie.split(';')[0]!,'x-csrf-token':(login.json() as {csrfToken:string}).csrfToken};
      expect((await app.inject({method:'GET',url:'/api/admin/status',headers})).json()).toEqual({adminOnly:true});
      const response=await app.inject({method:'POST',url:`/api/admin/campaigns/${campaign!.id}/publish`,headers,payload:{expectedVersion:1}});
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({code:'ADMIN_ONLY_MODE'});
      expect((await db.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaign!.id)))[0]!.status).toBe('DRAFT');
      expect(await db.select().from(schema.campaigns).where(eq(schema.campaigns.status,'ACTIVE'))).toHaveLength(0);
    } finally { await app.close(); }
  });

  it('runs the authenticated campaign-manager workflow, auditing mutations and rejecting stale edits', async () => {
    await new AdminAuthService(db).createFirstAdmin('owner','A safe passphrase 2026!');
    const app=buildServer(loadConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl!}),db);
    try {
      const denied=await app.inject({method:'GET',url:'/api/admin/campaigns'});
      expect(denied.statusCode).toBe(401);
      const badLogin=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'owner',password:'wrong password'}});
      expect(badLogin.statusCode,badLogin.body).toBe(401);
      const login=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'owner',password:'A safe passphrase 2026!'}});
      expect(login.statusCode).toBe(200);
      const loginUser=(await db.select().from(schema.adminUsers))[0]!;
      expect(loginUser.passwordHash).not.toContain('A safe passphrase 2026!');
      const cookieHeader=login.headers['set-cookie'];
      const cookie=Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!;
      expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
      const rawToken=decodeURIComponent(cookie.split(';')[0]!.split('=').slice(1).join('='));
      const sessions=await db.select().from(schema.adminSessions);
      expect(sessions[0]!.tokenHash).toBe(sha256(rawToken));expect(sessions[0]!.tokenHash).not.toBe(rawToken);
      const {csrfToken}=login.json() as {csrfToken:string};
      const headers={cookie:cookie.split(';')[0]!, 'x-csrf-token':csrfToken};
      const dashboard=await app.inject({method:'GET',url:'/api/admin/analytics?from=2026-09-01T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z',headers});
      expect(dashboard.statusCode).toBe(200);expect(dashboard.json().metrics).toHaveProperty('unique_claims');
      expect((await app.inject({method:'GET',url:'/api/admin/analytics/issues?kind=webhook&status=UNCERTAIN',headers})).statusCode).toBe(400);
      const webhookQueue=await app.inject({method:'GET',url:'/api/admin/analytics/issues?kind=webhook&campaignId=00000000-0000-4000-8000-000000000001',headers});
      expect(webhookQueue.statusCode).toBe(200);expect(webhookQueue.json().campaignScope).toBe('ALL_CAMPAIGNS');
      expect((await app.inject({method:'GET',url:'/admin'})).headers['content-security-policy']).toContain("default-src 'self'");
      expect((await app.inject({method:'GET',url:'/admin.js'})).statusCode).toBe(200);
      const noCsrf=await app.inject({method:'POST',url:'/api/admin/campaigns',headers:{cookie:headers.cookie},payload:{templateId:'welcome-claim',code:'ADMIN_NO_CSRF'}});
      expect(noCsrf.statusCode).toBe(403);
      const createdResponse=await app.inject({method:'POST',url:'/api/admin/campaigns',headers,payload:{templateId:'welcome-claim',code:'ADMIN_FLOW'}});
      expect(createdResponse.statusCode).toBe(200);
      const created=createdResponse.json() as {campaign:{id:string;version:number;status:string};activities:Array<{activityKey:string}>};
      expect(created.campaign).toMatchObject({code:'ADMIN_FLOW',status:'DRAFT',version:1});
      const detail=await app.inject({method:'GET',url:`/api/admin/campaigns/${created.campaign.id}`,headers});
      const draft=detail.json() as {campaign:Record<string,unknown>;buttons:Array<Record<string,unknown>>;activities:Array<Record<string,unknown>>;messages:Array<Record<string,unknown>>};
      const clean=editable(draft);const updateDraft={campaign:{...clean.campaign,title:'Updated title',heroImage:'https://images.example.org/card.png',rewardType:'POINTS',rewardValue:'250'},
        buttons:clean.buttons,activities:Array.from({length:15},(_,i)=>({activityKey:`TASK_${i}`,title:`Task ${i}`,description:null,actionType:'URI',actionValue:'https://example.org/task',displayOrder:i,required:i===0,enabled:true,metadata:{}})),messages:clean.messages};
      const saved=await app.inject({method:'PUT',url:`/api/admin/campaigns/${created.campaign.id}`,headers,payload:{expectedVersion:1,draft:updateDraft}});
      expect(saved.statusCode).toBe(200);expect(saved.json().activities).toHaveLength(15);
      const stale=await app.inject({method:'PUT',url:`/api/admin/campaigns/${created.campaign.id}`,headers,payload:{expectedVersion:1,draft:updateDraft}});
      expect(stale.statusCode).toBe(409);
      const validPreview=await app.inject({method:'POST',url:'/api/admin/campaigns/preview',headers,payload:updateDraft});
      expect(validPreview.statusCode).toBe(200);expect(validPreview.json().issues).toHaveLength(0);
      expect(validPreview.json().welcomeMessages[1]).toMatchObject({type:'flex'});
      expect(JSON.stringify(validPreview.json().welcomeMessages[1])).toContain(campaignButtonPostback('ADMIN_FLOW','BTN_CLAIM'));
      expect(JSON.stringify(validPreview.json().claimMessages[1])).toContain('Task 0');
      const preview=await app.inject({method:'POST',url:'/api/admin/campaigns/preview',headers,payload:{...updateDraft,campaign:{...updateDraft.campaign,title:null},activities:[]}});
      expect(preview.statusCode).toBe(200);expect(preview.json().issues).toEqual(expect.arrayContaining([expect.objectContaining({path:'campaign.title'}),expect.objectContaining({path:'activities'})]));
      const version=saved.json().campaign.version as number;
      const published=await app.inject({method:'POST',url:`/api/admin/campaigns/${created.campaign.id}/publish`,headers,payload:{expectedVersion:version}});
      expect(published.statusCode).toBe(200);expect(published.json().status).toBe('ACTIVE');
      const [secondCampaign]=await db.insert(schema.campaigns).values({code:'ADMIN_SECOND_ACTIVE',name:'Second',templateType:'WELCOME',title:'Second'}).returning();
      await db.insert(schema.campaignButtons).values({campaignId:secondCampaign!.id,buttonKey:'BTN_CLAIM',label:'Claim',actionType:'POSTBACK',actionValue:campaignButtonPostback(secondCampaign!.code,'BTN_CLAIM')});
      await db.insert(schema.campaignActivities).values({campaignId:secondCampaign!.id,activityKey:'ACT',title:'Activity',actionType:'URI',actionValue:'https://example.org'});
      await db.insert(schema.campaignMessages).values([{campaignId:secondCampaign!.id,messageKey:'WELCOME_MESSAGE',messageType:'TEXT',content:'Welcome'},
        {campaignId:secondCampaign!.id,messageKey:'CLAIM_CREATED',messageType:'TEXT',content:'Created'},
        {campaignId:secondCampaign!.id,messageKey:'CLAIM_ALREADY_EXISTS',messageType:'TEXT',content:'Already'}]);
      await expect(new CampaignService(db).publishCampaign(secondCampaign!.id)).rejects.toMatchObject({code:'ANOTHER_CAMPAIGN_ACTIVE'});
      const activeEdit=await app.inject({method:'PUT',url:`/api/admin/campaigns/${created.campaign.id}`,headers,payload:{expectedVersion:published.json().version,draft:updateDraft}});
      expect(activeEdit.statusCode).toBe(409);
      const [owner]=await db.insert(schema.users).values({}).returning();
      const [claim]=await db.insert(schema.claims).values({userId:owner!.id,campaignId:created.campaign.id,claimCode:'ADMIN_FLOW_CLAIM'}).returning();
      const [usedActivity]=await db.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId,created.campaign.id)).limit(1);
      await db.insert(schema.claimActivities).values({claimId:claim!.id,campaignActivityId:usedActivity!.id});
      await db.insert(schema.trackingEvents).values({campaignId:created.campaign.id,eventType:'ADMIN_TEST_TRACKING'});
      const paused=await app.inject({method:'POST',url:`/api/admin/campaigns/${created.campaign.id}/pause`,headers,payload:{expectedVersion:published.json().version}});
      expect(paused.statusCode).toBe(200);expect(paused.json().status).toBe('PAUSED');
      const pausedDetail=await app.inject({method:'GET',url:`/api/admin/campaigns/${created.campaign.id}`,headers});
      const pausedDraft=editable(pausedDetail.json());pausedDraft.activities[0]!.title='Edited but referenced activity';
      const pausedSave=await app.inject({method:'PUT',url:`/api/admin/campaigns/${created.campaign.id}`,headers,payload:{expectedVersion:paused.json().version,draft:pausedDraft}});
      expect(pausedSave.statusCode).toBe(200);
      const [activityAfterEdit]=await db.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId,created.campaign.id)).limit(1);
      expect(activityAfterEdit!.id).toBe(usedActivity!.id);
      expect(await db.select().from(schema.claimActivities).where(eq(schema.claimActivities.campaignActivityId,usedActivity!.id))).toHaveLength(1);
      const duplicate=await app.inject({method:'POST',url:`/api/admin/campaigns/${created.campaign.id}/duplicate`,headers,payload:{code:'ADMIN_COPY'}});
      expect(duplicate.statusCode).toBe(200);expect(duplicate.json().campaign).toMatchObject({code:'ADMIN_COPY',status:'DRAFT'});
      const duplicateId=(duplicate.json() as {campaign:{id:string}}).campaign.id;
      expect(await db.select().from(schema.claims).where(eq(schema.claims.campaignId,duplicateId))).toHaveLength(0);
      expect(await db.select().from(schema.trackingEvents).where(eq(schema.trackingEvents.campaignId,duplicateId))).toHaveLength(0);
      const auditRows=await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.actorType,'ADMIN'));
      expect(auditRows.map((row)=>row.action)).toEqual(expect.arrayContaining(['CAMPAIGN_CREATED','CAMPAIGN_UPDATED','CAMPAIGN_PUBLISHED','CAMPAIGN_PAUSED','CAMPAIGN_DUPLICATED']));
    } finally {await app.close();}
  });

  it('allows only one concurrent admin edit for one campaign version', async () => {
    await new AdminAuthService(db).createFirstAdmin('editor','Another safe passphrase!');
    const app=buildServer(loadConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl!}),db);
    try {
      const login=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'editor',password:'Another safe passphrase!'}});
      const cookieHeader=login.headers['set-cookie'];const cookie=Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!;
      const headers={cookie:cookie.split(';')[0]!, 'x-csrf-token':(login.json() as {csrfToken:string}).csrfToken};
      const created=await app.inject({method:'POST',url:'/api/admin/campaigns',headers,payload:{templateId:'welcome-claim',code:'ADMIN_RACE'}});
      const id=(created.json() as {campaign:{id:string}}).campaign.id;
      const detail=await app.inject({method:'GET',url:`/api/admin/campaigns/${id}`,headers});const draft=editable(detail.json());
      const payload={expectedVersion:1,draft};
      const outcomes=await Promise.all([app.inject({method:'PUT',url:`/api/admin/campaigns/${id}`,headers,payload}),app.inject({method:'PUT',url:`/api/admin/campaigns/${id}`,headers,payload})]);
      expect(outcomes.map((item)=>item.statusCode).sort()).toEqual([200,409]);
    } finally {await app.close();}
  });

  it('publishes the exact edited preview graph and rejects a stale publish from another window', async () => {
    await new AdminAuthService(db).createFirstAdmin('publisher','Publish safe passphrase!');
    const app=buildServer(loadConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl!}),db);
    try {
      const login=await app.inject({method:'POST',url:'/api/admin/login',payload:{username:'publisher',password:'Publish safe passphrase!'}});
      const cookieHeader=login.headers['set-cookie'];const cookie=Array.isArray(cookieHeader)?cookieHeader[0]!:cookieHeader!;
      const headers={cookie:cookie.split(';')[0]!, 'x-csrf-token':(login.json() as {csrfToken:string}).csrfToken};

      const created=await app.inject({method:'POST',url:'/api/admin/campaigns',headers,payload:{templateId:'welcome-claim',code:'PUBLISH_LATEST'}});
      const id=(created.json() as {campaign:{id:string}}).campaign.id;
      const detail=await app.inject({method:'GET',url:`/api/admin/campaigns/${id}`,headers});
      const draft=editable(detail.json());
      draft.campaign.title='Latest title before Publish';
      draft.buttons[0]!.label='รับรางวัลล่าสุด';
      draft.activities[0]!.actionValue='https://example.org/latest-destination';
      draft.messages.find((message)=>message.messageKey==='WELCOME_MESSAGE')!.content='Welcome copy edited immediately before Publish.';

      const preview=await app.inject({method:'POST',url:'/api/admin/campaigns/preview',headers,payload:draft});
      expect(preview.statusCode).toBe(200);
      expect(preview.json().issues).toHaveLength(0);
      expect(JSON.stringify(preview.json().welcomeMessages)).toContain('Latest title before Publish');
      expect(JSON.stringify(preview.json().welcomeMessages)).toContain('รับรางวัลล่าสุด');
      expect(JSON.stringify(preview.json().welcomeMessages)).toContain('Welcome copy edited immediately before Publish.');
      expect(JSON.stringify(preview.json().claimMessages)).toContain('https://example.org/latest-destination');

      const published=await app.inject({method:'POST',url:`/api/admin/campaigns/${id}/publish`,headers,payload:{expectedVersion:1,draft}});
      expect(published.statusCode,published.body).toBe(200);
      expect(published.json()).toMatchObject({status:'ACTIVE',title:'Latest title before Publish'});
      const persisted=await app.inject({method:'GET',url:`/api/admin/campaigns/${id}`,headers});
      const stored=persisted.json() as {campaign:Record<string,unknown>;buttons:Array<Record<string,unknown>>;activities:Array<Record<string,unknown>>;messages:Array<Record<string,unknown>>};
      expect(stored.campaign.title).toBe('Latest title before Publish');
      expect(stored.buttons[0]!.label).toBe('รับรางวัลล่าสุด');
      expect(stored.activities[0]!.actionValue).toBe('https://example.org/latest-destination');
      expect(stored.messages.find((message)=>message.messageKey==='WELCOME_MESSAGE')!.content).toBe('Welcome copy edited immediately before Publish.');

      const second=await app.inject({method:'POST',url:'/api/admin/campaigns',headers,payload:{templateId:'welcome-claim',code:'STALE_PUBLISH'}});
      const secondId=(second.json() as {campaign:{id:string}}).campaign.id;
      const staleDetail=await app.inject({method:'GET',url:`/api/admin/campaigns/${secondId}`,headers});
      const staleDraft=editable(staleDetail.json());
      const otherWindowDraft=structuredClone(staleDraft);
      otherWindowDraft.campaign.title='Saved from another window';
      const otherWindowSave=await app.inject({method:'PUT',url:`/api/admin/campaigns/${secondId}`,headers,payload:{expectedVersion:1,draft:otherWindowDraft}});
      expect(otherWindowSave.statusCode).toBe(200);

      staleDraft.campaign.title='Unsaved stale window title';
      staleDraft.messages.find((message)=>message.messageKey==='WELCOME_MESSAGE')!.content='Unsaved stale window message';
      const stalePublish=await app.inject({method:'POST',url:`/api/admin/campaigns/${secondId}/publish`,headers,payload:{expectedVersion:1,draft:staleDraft}});
      expect(stalePublish.statusCode).toBe(409);
      const afterConflict=await app.inject({method:'GET',url:`/api/admin/campaigns/${secondId}`,headers});
      expect(afterConflict.json().campaign).toMatchObject({status:'DRAFT',title:'Saved from another window',version:2});
      expect(afterConflict.json().messages.find((message:{messageKey:string})=>message.messageKey==='WELCOME_MESSAGE')!.content)
        .not.toBe('Unsaved stale window message');
    } finally {await app.close();}
  });

  it('enforces one claim across concurrent requests', async () => {
    const campaignService = new CampaignService(db);
    const [campaign] = await db.insert(schema.campaigns).values({
      code: 'CONCURRENT_TEST', name: 'Concurrency test', templateType: 'CUSTOM_CAMPAIGN', status: 'ACTIVE',
    }).returning();
    const [user] = await db.insert(schema.users).values({}).returning();
    const service = new ClaimService(new DrizzleClaimStore(db));
    const results = await Promise.all(Array.from({ length: 8 }, () => service.createClaim(user!.id, campaign!.code)));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.map((result) => result.claim.id).filter((id, index, ids) => ids.indexOf(id) === index)).toHaveLength(1);
    expect(await campaignService.getCampaignByCode(campaign!.code)).not.toBeNull();
  });

  it('stores tracking events and deduplicates webhook event IDs durably', async () => {
    const tracker = new TrackingService(db);
    await expect(tracker.trackEvent({ eventType: 'BUTTON_CLICK', buttonKey: 'BTN_PROMOTION' })).resolves.toMatchObject({ eventType: 'BUTTON_CLICK' });
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    const event = { providerEventId: 'line-event-1', type: 'follow', isRedelivery: false, payload: { type: 'follow' } };
    expect(await inbox.acceptLineEvents([event])).toEqual({ accepted: 1, duplicates: 0 });
    expect(await inbox.acceptLineEvents([event])).toEqual({ accepted: 0, duplicates: 1 });
  });

  it('retrieves any configured number of campaign activities', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({
      code: 'DYNAMIC_TEST', name: 'Dynamic test', templateType: 'ACTIVITY_CAMPAIGN',
    }).returning();
    await db.insert(schema.campaignActivities).values(Array.from({ length: 9 }, (_, index) => ({
      campaignId: campaign!.id, activityKey: `ITEM_${index}`, title: `Item ${index}`, actionType: 'URI', displayOrder: index,
    })));
    expect(await new CampaignService(db).getCampaignActivities(campaign!.id)).toHaveLength(9);
  });

  it('processes follow to welcome once and deduplicates postback claim replies', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({
      code: 'FLOW_TEST', name: 'Flow test', templateType: 'WELCOME', title: 'Hello',
    }).returning();
    const postback = campaignButtonPostback(campaign!.code, 'BTN_CLAIM');
    await db.insert(schema.campaignButtons).values({ campaignId: campaign!.id, buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: postback });
    await db.insert(schema.campaignActivities).values({ campaignId: campaign!.id, activityKey: 'JOIN', title: 'Join us', actionType: 'URI', actionValue: 'https://example.org/join' });
    await db.insert(schema.campaignMessages).values([
      { campaignId: campaign!.id, messageKey: 'WELCOME_MESSAGE', messageType: 'TEXT', content: 'Welcome!' },
      { campaignId: campaign!.id, messageKey: 'CLAIM_CREATED', messageType: 'TEXT', content: 'Claim created.' },
      { campaignId: campaign!.id, messageKey: 'CLAIM_ALREADY_EXISTS', messageType: 'TEXT', content: 'Claim already exists.' },
    ]);
    await db.update(schema.campaigns).set({ status: 'ACTIVE' }).where(eq(schema.campaigns.id, campaign!.id));
    const sender = { sendReply: async () => undefined } satisfies ReplySender;
    const processor = new WebhookEventProcessor(db, sender);
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    await inbox.acceptLineEvents([{ providerEventId: 'follow-1', type: 'follow', isRedelivery: false,
      payload: { type: 'follow', replyToken: 'reply-follow', source: { userId: 'line-user-flow' } } }]);
    expect(await processor.processPending()).toBe(1);
    await inbox.acceptLineEvents([{ providerEventId: 'postback-1', type: 'postback', isRedelivery: false,
      payload: { type: 'postback', replyToken: 'reply-postback-1', source: { userId: 'line-user-flow' }, postback: { data: postback } } }]);
    expect(await processor.processPending()).toBe(1);
    await inbox.acceptLineEvents([{ providerEventId: 'postback-2', type: 'postback', isRedelivery: false,
      payload: { type: 'postback', replyToken: 'reply-postback-2', source: { userId: 'line-user-flow' }, postback: { data: postback } } }]);
    expect(await processor.processPending()).toBe(1);
    const outbound = await db.select().from(schema.outboundMessages);
    expect(outbound).toHaveLength(3);
    expect(outbound.map((row) => row.status)).toEqual(['SENT', 'SENT', 'SENT']);
    expect(outbound.find((row) => row.dedupeKey === 'line-reply:postback-1')!.messages[0]!.text).toBe('Claim created.');
    expect(outbound.find((row) => row.dedupeKey === 'line-reply:postback-2')!.messages[0]!.text).toBe('Claim already exists.');
    const welcome = outbound.find((row) => row.dedupeKey === 'line-reply:follow-1')!;
    expect(welcome.messages).toHaveLength(2);
    expect(welcome.messages[1]!.type).toBe('flex');
    expect(JSON.stringify(welcome.messages[1]!.contents)).toContain(postback);
    const claims = await db.select().from(schema.claims);
    expect(claims).toHaveLength(1);
  });

  it('marks a reply UNCERTAIN on timeout and never retries the reply token', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'UNCERTAIN_TEST', name: 'Uncertain', templateType: 'WELCOME' }).returning();
    await db.insert(schema.campaignButtons).values({ campaignId: campaign!.id, buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: campaignButtonPostback(campaign!.code, 'BTN_CLAIM') });
    await db.insert(schema.campaignMessages).values({ campaignId: campaign!.id, messageKey: 'WELCOME_MESSAGE', messageType: 'TEXT', content: 'Welcome.' });
    await db.update(schema.campaigns).set({ status: 'ACTIVE' }).where(eq(schema.campaigns.id, campaign!.id));
    const sender = { sendReply: async () => { throw new Error('socket timeout'); } } satisfies ReplySender;
    const processor = new WebhookEventProcessor(db, sender);
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    await inbox.acceptLineEvents([{ providerEventId: 'follow-timeout', type: 'follow', isRedelivery: false,
      payload: { type: 'follow', replyToken: 'single-use-token', source: { userId: 'line-user-timeout' } } }]);
    await processor.processPending();
    const rows = await db.select().from(schema.outboundMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'UNCERTAIN', replyToken: null, attemptCount: 1 });
  });

  it('builds an activity card from data instead of campaign-specific rules', () => {
    const card = buildActivityCard({ title: 'Dynamic', subtitle: null }, [
      { activityKey:'TASK',title: 'Task', description: null, actionType: 'URI', actionValue: 'https://example.org' },
    ]);
    expect(card).toMatchObject({ type: 'flex', contents: { type: 'bubble' } });
  });

  it('resumes expired processing events before outbound starts and preserves uncertain sends', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'RECOVERY_TEST', name: 'Recovery', templateType: 'WELCOME', title: 'Welcome' }).returning();
    const postback = campaignButtonPostback(campaign!.code, 'BTN_CLAIM');
    await db.insert(schema.campaignButtons).values({ campaignId: campaign!.id, buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: postback });
    await db.insert(schema.campaignMessages).values({ campaignId: campaign!.id, messageKey: 'WELCOME_MESSAGE', messageType: 'TEXT', content: 'Welcome!' });
    await db.update(schema.campaigns).set({ status: 'ACTIVE' }).where(eq(schema.campaigns.id, campaign!.id));
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    await inbox.acceptLineEvents([{ providerEventId: 'crash-before-send', type: 'follow', isRedelivery: false,
      payload: { replyToken: 'token-before', source: { userId: 'line-crash-before' } } }]);
    await db.update(schema.webhookEvents).set({ status: 'PROCESSING', leaseUntil: null })
      .where(eq(schema.webhookEvents.providerEventId, 'crash-before-send'));
    const sender = { sendReply: async () => undefined } satisfies ReplySender;
    const processor = new WebhookEventProcessor(db, sender);
    expect(await processor.recoverExpiredWork()).toBe(1);
    expect(await processor.processPending()).toBe(1);
    expect(await db.select().from(schema.outboundMessages)).toHaveLength(1);

    await inbox.acceptLineEvents([{ providerEventId: 'crash-during-send', type: 'follow', isRedelivery: false,
      payload: { replyToken: 'token-during', source: { userId: 'line-crash-during' } } }]);
    await db.insert(schema.outboundMessages).values({ dedupeKey: 'line-reply:crash-during-send', recipientLineUserId: 'line-crash-during',
      replyToken: 'token-during', messages: [{ type: 'text', text: 'possibly sent' }], status: 'SENDING' });
    await db.update(schema.webhookEvents).set({ status: 'PROCESSING', leaseUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.webhookEvents.providerEventId, 'crash-during-send'));
    expect(await processor.recoverExpiredWork()).toBe(1);
    const [uncertain] = await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.dedupeKey, 'line-reply:crash-during-send'));
    expect(uncertain).toMatchObject({ status: 'UNCERTAIN', replyToken: null, errorCode: 'PROCESS_CRASH_DURING_LINE_REPLY' });
  });

  it('does not create outbound state when access token configuration is missing', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'NO_TOKEN_TEST', name: 'No token', templateType: 'WELCOME' }).returning();
    await db.insert(schema.campaignButtons).values({ campaignId: campaign!.id, buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: campaignButtonPostback(campaign!.code, 'BTN_CLAIM') });
    await db.insert(schema.campaignMessages).values({ campaignId: campaign!.id, messageKey: 'WELCOME_MESSAGE', messageType: 'TEXT', content: 'Welcome!' });
    await db.update(schema.campaigns).set({ status: 'ACTIVE' }).where(eq(schema.campaigns.id, campaign!.id));
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    await inbox.acceptLineEvents([{ providerEventId: 'missing-token', type: 'follow', isRedelivery: false,
      payload: { replyToken: 'token', source: { userId: 'line-no-token' } } }]);
    const processor = new WebhookEventProcessor(db, { sendReply: async () => { throw new Error('should not be called'); } }, false);
    expect(await processor.processPending()).toBe(1);
    const [event] = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.providerEventId, 'missing-token'));
    expect(event).toMatchObject({ status: 'RECEIVED', errorCode: 'LINE_CONFIG_MISSING' });
    expect(await db.select().from(schema.outboundMessages)).toHaveLength(0);
    expect(await db.select().from(schema.channelIdentities)).toHaveLength(0);
    expect(await db.select().from(schema.claims)).toHaveLength(0);
  });

  it('resumes persisted READY outbound after a worker crash without rebuilding or duplicating it', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'READY_RECOVERY', name: 'Ready recovery', templateType: 'WELCOME', status: 'ACTIVE', title: 'Stored' }).returning();
    const [event] = await db.insert(schema.webhookEvents).values({ channel: 'LINE', providerEventId: 'ready-crash', eventType: 'follow',
      payload: { replyToken: 'ready-token', source: { userId: 'line-ready-crash' } }, status: 'PROCESSING', leaseUntil: new Date(Date.now() - 1000) }).returning();
    await db.insert(schema.outboundMessages).values({ dedupeKey: 'line-reply:ready-crash', recipientLineUserId: 'line-ready-crash',
      replyToken: 'ready-token', messages: [{ type: 'text', text: 'persisted payload' }], status: 'READY' });
    const sent: Array<{ token: string; messages: Record<string, unknown>[] }> = [];
    const processor = new WebhookEventProcessor(db, { sendReply: async (token, messages) => { sent.push({ token, messages }); } });
    expect(await processor.recoverExpiredWork()).toBe(1);
    expect(await processor.processPending()).toBe(1);
    expect(sent).toEqual([{ token: 'ready-token', messages: [{ type: 'text', text: 'persisted payload' }] }]);
    expect(await db.select().from(schema.outboundMessages)).toHaveLength(1);
    expect(event).toBeDefined();
    expect(campaign).toBeDefined();
  });

  it('allows concurrent processor instances to claim distinct rows and deliver once', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'WORKER_CONCURRENCY', name: 'Workers', templateType: 'WELCOME', title: 'Workers' }).returning();
    await db.insert(schema.campaignButtons).values({ campaignId: campaign!.id, buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: campaignButtonPostback(campaign!.code, 'BTN_CLAIM') });
    await db.insert(schema.campaignMessages).values({ campaignId: campaign!.id, messageKey: 'WELCOME_MESSAGE', messageType: 'TEXT', content: 'Hello!' });
    await db.update(schema.campaigns).set({ status: 'ACTIVE' }).where(eq(schema.campaigns.id, campaign!.id));
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    await inbox.acceptLineEvents(Array.from({ length: 6 }, (_, index) => ({ providerEventId: `worker-${index}`, type: 'follow', isRedelivery: false,
      payload: { replyToken: `worker-token-${index}`, source: { userId: `line-worker-${index}` } } })));
    const sent: string[] = [];
    const sender: ReplySender = { sendReply: async (token) => { await new Promise((resolve) => setTimeout(resolve, 15)); sent.push(token); } };
    const workerA = new WebhookEventProcessor(db, sender);
    const workerB = new WebhookEventProcessor(db, sender);
    await Promise.all([workerA.processPending(6), workerB.processPending(6)]);
    expect(sent).toHaveLength(6);
    expect(new Set(sent).size).toBe(6);
  });

  it('does not send or create a user when no active campaign exists', async () => {
    const sent: string[] = [];
    const processor = new WebhookEventProcessor(db, { sendReply: async (token) => { sent.push(token); } });
    const inbox = new WebhookInbox(new DrizzleWebhookEventStore(db));
    await inbox.acceptLineEvents([{ providerEventId: 'follow-no-campaign', type: 'follow', isRedelivery: false,
      payload: { replyToken: 'no-campaign-token', source: { userId: 'line-no-campaign' } } }]);
    expect(await processor.processPending()).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await db.select().from(schema.outboundMessages)).toHaveLength(0);
    expect(await db.select().from(schema.channelIdentities)).toHaveLength(0);
  });

  it('prevents editing active campaign content without pausing and revalidation', async () => {
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'IMMUTABLE_TEST', name: 'Immutable', templateType: 'WELCOME', status: 'ACTIVE' }).returning();
    await expect(new CampaignService(db).updateCampaign(campaign!.id, { title: 'mutated' }))
      .rejects.toMatchObject({ code: 'ACTIVE_CAMPAIGN_IMMUTABLE' });
  });

  it('serializes concurrent publish and campaign edits under row locking', async () => {
    const service = new CampaignService(db);
    const [campaign] = await db.insert(schema.campaigns).values({ code: 'PUBLISH_RACE_TEST', name: 'Race', templateType: 'WELCOME', title: 'Race' }).returning();
    const claimPostback = campaignButtonPostback(campaign!.code, 'BTN_CLAIM');
    await db.insert(schema.campaignButtons).values({ campaignId: campaign!.id, buttonKey: 'BTN_CLAIM', label: 'Claim', actionType: 'POSTBACK', actionValue: claimPostback });
    await db.insert(schema.campaignActivities).values({ campaignId: campaign!.id, activityKey: 'JOIN', title: 'Join', actionType: 'URI', actionValue: 'https://example.org/join' });
    await db.insert(schema.campaignMessages).values([
      { campaignId: campaign!.id, messageKey: 'WELCOME_MESSAGE', messageType: 'TEXT', content: 'Welcome.' },
      { campaignId: campaign!.id, messageKey: 'CLAIM_CREATED', messageType: 'TEXT', content: 'Created.' },
      { campaignId: campaign!.id, messageKey: 'CLAIM_ALREADY_EXISTS', messageType: 'TEXT', content: 'Already.' },
    ]);
    const outcomes = await Promise.allSettled([
      service.publishCampaign(campaign!.id),
      db.update(schema.campaignActivities).set({ enabled: false }).where(eq(schema.campaignActivities.campaignId, campaign!.id)),
    ]);
    const active = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaign!.id));
    const activity = await db.select().from(schema.campaignActivities).where(eq(schema.campaignActivities.campaignId, campaign!.id));
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(active[0]!.status === 'ACTIVE' ? activity[0]!.enabled : !activity[0]!.enabled).toBe(true);

    if (active[0]!.status === 'DRAFT') await service.publishCampaign(campaign!.id);
    await expect(db.update(schema.campaignActivities).set({ enabled: false })
      .where(eq(schema.campaignActivities.campaignId, campaign!.id))).rejects.toThrow();
  });
});
