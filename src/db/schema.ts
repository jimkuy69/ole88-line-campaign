import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const campaignStatus = pgEnum('campaign_status', ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED']);
export const claimStatus = pgEnum('claim_status', [
  'NEW', 'ELIGIBLE', 'CLAIM_CREATED', 'ACTIVITY_SENT', 'IN_PROGRESS', 'PROOF_SUBMITTED',
  'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REWARD_SENT', 'EXPIRED', 'CANCELLED',
]);
export const webhookStatus = pgEnum('webhook_status', ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED']);
export const outboundStatus = pgEnum('outbound_status', ['READY', 'SENDING', 'SENT', 'FAILED', 'UNCERTAIN']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const channelIdentities = pgTable('channel_identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  channel: varchar('channel', { length: 32 }).notNull(),
  externalUserId: varchar('external_user_id', { length: 255 }).notNull(),
  displayName: text('display_name'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique('channel_identities_channel_external_user_uq').on(t.channel, t.externalUserId)]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  name: text('name').notNull(),
  templateType: varchar('template_type', { length: 64 }).notNull(),
  status: campaignStatus('status').notNull().default('DRAFT'),
  claimPolicy: varchar('claim_policy', { length: 32 }).notNull().default('SINGLE_CLAIM'),
  title: text('title'), subtitle: text('subtitle'),
  rewardType: varchar('reward_type', { length: 32 }), rewardValue: text('reward_value'),
  heroImage: text('hero_image'),
  startAt: timestamp('start_at', { withTimezone: true }), endAt: timestamp('end_at', { withTimezone: true }),
  maxClaims: integer('max_claims'),
  version: integer('version').notNull().default(1),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [check('campaigns_claim_policy_supported_ck', sql`${t.claimPolicy} = 'SINGLE_CLAIM'`),
  uniqueIndex('campaigns_single_active_idx').on(t.status).where(sql`${t.status} = 'ACTIVE'`)]);

export const campaignButtons = pgTable('campaign_buttons', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  buttonKey: varchar('button_key', { length: 100 }).notNull(), label: text('label').notNull(),
  actionType: varchar('action_type', { length: 32 }).notNull(), actionValue: text('action_value'),
  displayOrder: integer('display_order').notNull().default(0), enabled: boolean('enabled').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique('campaign_buttons_campaign_key_uq').on(t.campaignId, t.buttonKey)]);

export const campaignActivities = pgTable('campaign_activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  activityKey: varchar('activity_key', { length: 100 }).notNull(), title: text('title').notNull(),
  description: text('description'), actionType: varchar('action_type', { length: 32 }).notNull(),
  actionValue: text('action_value'), displayOrder: integer('display_order').notNull().default(0),
  required: boolean('required').notNull().default(false), enabled: boolean('enabled').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique('campaign_activities_campaign_key_uq').on(t.campaignId, t.activityKey)]);

export const campaignMessages = pgTable('campaign_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  messageKey: varchar('message_key', { length: 100 }).notNull(),
  messageType: varchar('message_type', { length: 32 }).notNull(), content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique('campaign_messages_campaign_key_uq').on(t.campaignId, t.messageKey)]);

export const claims = pgTable('claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
  status: claimStatus('status').notNull().default('CLAIM_CREATED'),
  claimCode: varchar('claim_code', { length: 100 }).notNull().unique(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp('approved_at', { withTimezone: true }), rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique('claims_user_campaign_uq').on(t.userId, t.campaignId), index('claims_campaign_status_idx').on(t.campaignId, t.status),
  index('claims_campaign_claimed_at_idx').on(t.campaignId, t.claimedAt), index('claims_claimed_at_idx').on(t.claimedAt)]);

export const claimActivities = pgTable('claim_activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  campaignActivityId: uuid('campaign_activity_id').notNull().references(() => campaignActivities.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  clickedAt: timestamp('clicked_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique('claim_activities_claim_activity_uq').on(t.claimId, t.campaignActivityId),
  check('claim_activities_status_ck', sql`${t.status} IN ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')`)]);

export const evidence = pgTable('evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  claimActivityId: uuid('claim_activity_id').references(() => claimActivities.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  channelIdentityId: uuid('channel_identity_id').references(() => channelIdentities.id, { onDelete: 'restrict' }),
  type: varchar('type', { length: 32 }).notNull(), storageKey: text('storage_key').notNull(),
  sourceMessageId: varchar('source_message_id', { length: 255 }),
  status: varchar('status', { length: 32 }).notNull().default('SUBMITTED'),
  version: integer('version').notNull().default(1), reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewReason: text('review_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index('evidence_claim_created_idx').on(t.claimId, t.createdAt),
  uniqueIndex('evidence_source_message_uq').on(t.sourceMessageId).where(sql`${t.sourceMessageId} IS NOT NULL`),
  index('evidence_status_created_idx').on(t.status, t.createdAt),
  index('evidence_created_at_idx').on(t.createdAt), index('evidence_status_reviewed_at_idx').on(t.status, t.reviewedAt),
  check('evidence_status_ck', sql`${t.status} IN ('SUBMITTED', 'APPROVED', 'REJECTED')`)]);

export const evidenceUploadContexts = pgTable('evidence_upload_contexts', {
  channelIdentityId: uuid('channel_identity_id').primaryKey().references(() => channelIdentities.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  claimActivityId: uuid('claim_activity_id').notNull().references(() => claimActivities.id, { onDelete: 'cascade' }),
  requestedEventId: varchar('requested_event_id', { length: 128 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('evidence_upload_contexts_expiry_idx').on(t.expiresAt)]);

export const trackingEvents = pgTable('tracking_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  claimId: uuid('claim_id').references(() => claims.id, { onDelete: 'set null' }),
  eventType: varchar('event_type', { length: 64 }).notNull(), buttonKey: varchar('button_key', { length: 100 }),
  sourceEventId: varchar('source_event_id', { length: 128 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), createdAt: createdAt(),
}, (t) => [index('tracking_campaign_created_idx').on(t.campaignId, t.createdAt),
  index('tracking_created_at_idx').on(t.createdAt),
  uniqueIndex('tracking_source_event_uq').on(t.sourceEventId).where(sql`${t.sourceEventId} IS NOT NULL`)]);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorType: varchar('actor_type', { length: 32 }).notNull(), actorId: varchar('actor_id', { length: 255 }),
  action: varchar('action', { length: 100 }).notNull(), entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: varchar('entity_id', { length: 255 }),
  beforeData: jsonb('before_data').$type<Record<string, unknown>>(), afterData: jsonb('after_data').$type<Record<string, unknown>>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), createdAt: createdAt(),
}, (t) => [index('audit_entity_created_idx').on(t.entityType, t.entityId, t.createdAt)]);

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(), username: varchar('username', { length: 120 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(), disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').defaultRandom().primaryKey(), tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  csrfToken: varchar('csrf_token', { length: 64 }).notNull(), adminUserId: uuid('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: createdAt(),
});
export const adminLoginAttempts = pgTable('admin_login_attempts', {
  keyHash: varchar('key_hash', { length: 64 }).primaryKey(), failures: integer('failures').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(), lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(), channel: varchar('channel', { length: 32 }).notNull(),
  providerEventId: varchar('provider_event_id', { length: 128 }).notNull(), eventType: varchar('event_type', { length: 64 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  isRedelivery: boolean('is_redelivery').notNull().default(false),
  status: webhookStatus('status').notNull().default('RECEIVED'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }), errorCode: varchar('error_code', { length: 100 }),
  attemptCount: integer('attempt_count').notNull().default(0), nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow().$defaultFn(() => new Date()),
  leaseUntil: timestamp('lease_until', { withTimezone: true }), processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
}, (t) => [unique('webhook_events_channel_provider_id_uq').on(t.channel, t.providerEventId), index('webhook_events_status_received_idx').on(t.status, t.nextAttemptAt),
  index('webhook_events_received_at_idx').on(t.receivedAt), index('webhook_events_status_lease_idx').on(t.status, t.leaseUntil)]);

export const outboundMessages = pgTable('outbound_messages', {
  id: uuid('id').defaultRandom().primaryKey(), dedupeKey: varchar('dedupe_key', { length: 200 }).notNull().unique(),
  deliveryType: varchar('delivery_type', { length: 16 }).notNull().default('REPLY'),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  purpose: varchar('purpose', { length: 32 }),
  retryKey: varchar('retry_key', { length: 36 }),
  recipientLineUserId: varchar('recipient_line_user_id', { length: 255 }).notNull(),
  replyToken: text('reply_token'), messages: jsonb('messages').$type<Record<string, unknown>[]>().notNull(),
  status: outboundStatus('status').notNull().default('READY'), attemptCount: integer('attempt_count').notNull().default(0),
  errorCode: varchar('error_code', { length: 100 }), lineRequestId: varchar('line_request_id', { length: 255 }),
  sendingStartedAt: timestamp('sending_started_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(), sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => [index('outbound_messages_status_created_idx').on(t.status, t.createdAt),
  index('outbound_campaign_purpose_status_idx').on(t.campaignId, t.purpose, t.status, t.createdAt),
  index('outbound_campaign_purpose_sent_idx').on(t.campaignId, t.purpose, t.status, t.sentAt),
  uniqueIndex('outbound_messages_retry_key_uq').on(t.retryKey).where(sql`${t.retryKey} IS NOT NULL`),
  check('outbound_messages_delivery_type_ck', sql`${t.deliveryType} IN ('REPLY', 'PUSH')`)]);
