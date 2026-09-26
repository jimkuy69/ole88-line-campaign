import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';

type Db = NodePgDatabase<typeof schema>;
export type AnalyticsRange = { from: Date; to: Date; campaignId?: string };
const REVIEW_OVERDUE_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_STALE_MS = 45_000;

export class InvalidAnalyticsRangeError extends Error {}

export class AnalyticsService {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async overview(range: AnalyticsRange) {
    if (range.from >= range.to || range.to.getTime() - range.from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new InvalidAnalyticsRangeError('Analytics range must be increasing and no longer than 366 days.');
    }
    const campaignTrack = range.campaignId ? sql`AND campaign_id = ${range.campaignId}` : sql``;
    const campaignOut = range.campaignId ? sql`AND campaign_id = ${range.campaignId}` : sql``;
    const campaignClaim = range.campaignId ? sql`AND campaign_id = ${range.campaignId}` : sql``;
    const campaignEvidence = range.campaignId ? sql`AND c.campaign_id = ${range.campaignId}` : sql``;
    const metricResult = await this.db.execute(sql`
      SELECT
        (SELECT count(*) FROM tracking_events WHERE event_type='FOLLOW_PROCESSED' AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack}) AS follow_events,
        (SELECT count(DISTINCT user_id) FROM tracking_events WHERE event_type='FOLLOW_PROCESSED' AND user_id IS NOT NULL AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack}) AS unique_followers,
        (SELECT count(*) FROM outbound_messages WHERE purpose='WELCOME' AND status='SENT' AND sent_at >= ${range.from} AND sent_at < ${range.to} ${campaignOut}) AS welcome_sent,
        (SELECT count(*) FROM tracking_events WHERE event_type='CLAIM_REQUEST' AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack}) AS claim_request_events,
        (SELECT count(DISTINCT claim_id) FROM tracking_events WHERE event_type='CLAIM_REQUEST' AND claim_id IS NOT NULL AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack}) AS claim_request_claims,
        (SELECT count(*) FROM tracking_events WHERE event_type='CLAIM_REQUEST' AND metadata->>'outcome'='DUPLICATE' AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack}) AS duplicate_claim_requests,
        (SELECT count(*) FROM tracking_events WHERE event_type='CLAIM_REQUEST' AND metadata->>'outcome'='INELIGIBLE' AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack}) AS ineligible_claim_requests,
        (SELECT count(*) FROM claims WHERE claimed_at >= ${range.from} AND claimed_at < ${range.to} ${campaignClaim}) AS unique_claims,
        (SELECT count(DISTINCT user_id) FROM claims WHERE claimed_at >= ${range.from} AND claimed_at < ${range.to} ${campaignClaim}) AS unique_claimers,
        (SELECT count(*) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.created_at >= ${range.from} AND e.created_at < ${range.to} ${campaignEvidence}) AS proof_submitted,
        (SELECT count(DISTINCT e.claim_id) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.created_at >= ${range.from} AND e.created_at < ${range.to} ${campaignEvidence}) AS claims_with_proof,
        (SELECT count(*) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.status='SUBMITTED' ${campaignEvidence}) AS pending_review,
        (SELECT count(*) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.status='APPROVED' AND e.reviewed_at >= ${range.from} AND e.reviewed_at < ${range.to} ${campaignEvidence}) AS evidence_approved,
        (SELECT count(DISTINCT e.claim_id) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.status='APPROVED' AND e.reviewed_at >= ${range.from} AND e.reviewed_at < ${range.to} ${campaignEvidence}) AS claims_approved,
        (SELECT count(*) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.status='REJECTED' AND e.reviewed_at >= ${range.from} AND e.reviewed_at < ${range.to} ${campaignEvidence}) AS evidence_rejected,
        (SELECT count(DISTINCT e.claim_id) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.status='REJECTED' AND e.reviewed_at >= ${range.from} AND e.reviewed_at < ${range.to} ${campaignEvidence}) AS claims_rejected
    `);
    const raw = metricResult.rows[0] as Record<string, string | number>;
    const deliveryResult = await this.db.execute(sql`SELECT status, count(*) AS total FROM outbound_messages
      WHERE created_at >= ${range.from} AND created_at < ${range.to} ${campaignOut} GROUP BY status`);
    const webhookResult = await this.db.execute(sql`SELECT status, count(*) AS total FROM webhook_events
      WHERE received_at >= ${range.from} AND received_at < ${range.to} GROUP BY status`);
    const dailyResult = await this.db.execute(sql`
      SELECT day, metric, sum(total)::int AS total FROM (
        SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::date AS day, 'FOLLOW' AS metric, count(*)::int AS total
          FROM tracking_events WHERE event_type='FOLLOW_PROCESSED' AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack} GROUP BY 1
        UNION ALL SELECT (sent_at AT TIME ZONE 'Asia/Bangkok')::date, 'WELCOME_SENT', count(*)::int FROM outbound_messages
          WHERE purpose='WELCOME' AND status='SENT' AND sent_at >= ${range.from} AND sent_at < ${range.to} ${campaignOut} GROUP BY 1
        UNION ALL SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::date, 'CLAIM_REQUEST', count(*)::int FROM tracking_events
          WHERE event_type='CLAIM_REQUEST' AND created_at >= ${range.from} AND created_at < ${range.to} ${campaignTrack} GROUP BY 1
        UNION ALL SELECT (claimed_at AT TIME ZONE 'Asia/Bangkok')::date, 'UNIQUE_CLAIM', count(*)::int FROM claims
          WHERE claimed_at >= ${range.from} AND claimed_at < ${range.to} ${campaignClaim} GROUP BY 1
        UNION ALL SELECT (e.created_at AT TIME ZONE 'Asia/Bangkok')::date, 'PROOF_SUBMITTED', count(*)::int FROM evidence e JOIN claims c ON c.id=e.claim_id
          WHERE e.created_at >= ${range.from} AND e.created_at < ${range.to} ${campaignEvidence} GROUP BY 1
        UNION ALL SELECT (e.reviewed_at AT TIME ZONE 'Asia/Bangkok')::date, 'APPROVED', count(*)::int FROM evidence e JOIN claims c ON c.id=e.claim_id
          WHERE e.status='APPROVED' AND e.reviewed_at >= ${range.from} AND e.reviewed_at < ${range.to} ${campaignEvidence} GROUP BY 1
        UNION ALL SELECT (e.reviewed_at AT TIME ZONE 'Asia/Bangkok')::date, 'REJECTED', count(*)::int FROM evidence e JOIN claims c ON c.id=e.claim_id
          WHERE e.status='REJECTED' AND e.reviewed_at >= ${range.from} AND e.reviewed_at < ${range.to} ${campaignEvidence} GROUP BY 1
      ) d GROUP BY day, metric ORDER BY day, metric
    `);
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), timeZone: 'Asia/Bangkok' },
      metrics: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value)])),
      outbound: statusCounts(deliveryResult.rows as Array<{ status: string; total: string | number }>),
      webhooks: statusCounts(webhookResult.rows as Array<{ status: string; total: string | number }>),
      daily: (dailyResult.rows as Array<{day:Date|string;metric:string;total:string|number}>).map((row)=>({day:String(row.day).slice(0,10),metric:row.metric,total:Number(row.total)})),
      definitions: {
        period: 'Time metrics use [from,to) UTC instants; the date inputs represent Asia/Bangkok calendar days.',
        snapshots: 'pending_review is current SUBMITTED evidence; outbound and webhook maps are current statuses for records created/received in the selected period.',
        noImpressions: 'LINE follow is recorded only when the follow event is processed. There is no verified campaign impression metric.',
      },
    };
  }

  async issues(kind: 'webhook'|'outbound'|'review', options:{campaignId?:string;status?:string;limit:number;offset:number}) {
    const now = this.now();
    if (kind === 'webhook') {
      const statusFilter=options.status==='FAILED'?eq(schema.webhookEvents.status,'FAILED'):options.status==='PROCESSING'?eq(schema.webhookEvents.status,'PROCESSING'):
        or(eq(schema.webhookEvents.status,'FAILED'),eq(schema.webhookEvents.status,'PROCESSING'))!;
      const rows = await this.db.select({id:schema.webhookEvents.id,status:schema.webhookEvents.status,eventType:schema.webhookEvents.eventType,
        receivedAt:schema.webhookEvents.receivedAt,updatedAt:schema.webhookEvents.processingStartedAt,leaseUntil:schema.webhookEvents.leaseUntil,errorCode:schema.webhookEvents.errorCode})
        .from(schema.webhookEvents).where(and(statusFilter,or(eq(schema.webhookEvents.status,'FAILED'),and(eq(schema.webhookEvents.status,'PROCESSING'),or(isNull(schema.webhookEvents.leaseUntil),lte(schema.webhookEvents.leaseUntil,now))))!))
        .orderBy(asc(schema.webhookEvents.receivedAt)).limit(options.limit).offset(options.offset);
      return rows.map((row)=>({kind,reference:row.id,status:row.status,category:row.eventType,at:row.receivedAt,startedAt:row.updatedAt,code:row.errorCode}));
    }
    if (kind === 'outbound') {
      const statusFilter=options.status==='FAILED'?eq(schema.outboundMessages.status,'FAILED'):options.status==='UNCERTAIN'?eq(schema.outboundMessages.status,'UNCERTAIN'):
        options.status==='SENDING'?eq(schema.outboundMessages.status,'SENDING'):or(inArray(schema.outboundMessages.status,['FAILED','UNCERTAIN']),
          and(eq(schema.outboundMessages.deliveryType,'PUSH'),eq(schema.outboundMessages.status,'SENDING'),lte(schema.outboundMessages.sendingStartedAt,new Date(now.getTime()-WEBHOOK_STALE_MS))))!;
      const clauses = [statusFilter,or(inArray(schema.outboundMessages.status,['FAILED','UNCERTAIN']),and(eq(schema.outboundMessages.deliveryType,'PUSH'),eq(schema.outboundMessages.status,'SENDING'),lte(schema.outboundMessages.sendingStartedAt,new Date(now.getTime()-WEBHOOK_STALE_MS))))!];
      if (options.campaignId) clauses.push(eq(schema.outboundMessages.campaignId,options.campaignId));
      const rows = await this.db.select({id:schema.outboundMessages.id,status:schema.outboundMessages.status,deliveryType:schema.outboundMessages.deliveryType,
        purpose:schema.outboundMessages.purpose,createdAt:schema.outboundMessages.createdAt,updatedAt:schema.outboundMessages.updatedAt,
        errorCode:schema.outboundMessages.errorCode,campaignId:schema.outboundMessages.campaignId})
        .from(schema.outboundMessages).where(and(...clauses)).orderBy(asc(schema.outboundMessages.createdAt)).limit(options.limit).offset(options.offset);
      return rows.map((row)=>({kind,reference:row.id,status:row.status,category:row.purpose??row.deliveryType,at:row.createdAt,updatedAt:row.updatedAt,code:row.errorCode,campaignId:row.campaignId}));
    }
    const clauses = [eq(schema.evidence.status,'SUBMITTED'),lte(schema.evidence.createdAt,new Date(now.getTime()-REVIEW_OVERDUE_MS))];
    if (options.campaignId) clauses.push(eq(schema.claims.campaignId,options.campaignId));
    const rows = await this.db.select({id:schema.evidence.id,status:schema.evidence.status,createdAt:schema.evidence.createdAt,claimId:schema.evidence.claimId,
      campaignId:schema.claims.campaignId}).from(schema.evidence).innerJoin(schema.claims,eq(schema.claims.id,schema.evidence.claimId))
      .where(and(...clauses)).orderBy(asc(schema.evidence.createdAt)).limit(options.limit).offset(options.offset);
    return rows.map((row)=>({kind,reference:row.id,status:row.status,category:'EVIDENCE_REVIEW_OVERDUE',at:row.createdAt,campaignId:row.campaignId,claimReference:row.claimId}));
  }
}

function statusCounts(rows:Array<{status:string;total:string|number}>) {
  return Object.fromEntries(rows.map((row)=>[row.status,Number(row.total)]));
}
