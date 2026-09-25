# Database

The Drizzle schema is in `src/db/schema.ts`; versioned migrations are in `drizzle/`. Use migrations as the deployment source of truth.

| Table | Purpose | Important uniqueness/index rules |
|---|---|---|
| `users` | Internal user record | UUID primary key |
| `channel_identities` | Map provider identity to internal user | Unique `(channel, external_user_id)` |
| `campaigns` | Reusable content, rules, schedule, and lifecycle | Unique `code` |
| `admin_users` | Admin username and scrypt password hash | Unique username; no default account |
| `admin_sessions` | Hashed opaque session token, CSRF token, and expiry | Unique token hash; cascades with admin account |
| `admin_login_attempts` | Database-backed login failure window/lock | Hashed source-IP key |
| `campaign_buttons` | Stable button identity and configurable action | Unique `(campaign_id, button_key)` |
| `campaign_activities` | Dynamic campaign activity rows | Unique `(campaign_id, activity_key)` |
| `campaign_messages` | Campaign response text keyed by message role | Unique `(campaign_id, message_key)` |
| `claims` | Per-user participation and current status | Unique `(user_id, campaign_id)` for the current single-claim policy |
| `claim_activities` | Per-claim activity progress | Unique `(claim_id, campaign_activity_id)` |
| `evidence` | Evidence storage reference and review state | Indexed by claim/time |
| `tracking_events` | Provider-neutral interaction events | Indexed by campaign/time |
| `audit_logs` | Actor and entity change record | Indexed by entity/time |
| `webhook_events` | Durable inbound event inbox | Unique `(channel, provider_event_id)`; attempt timing and lease timestamps; indexed by status/next attempt |
| `outbound_messages` | Durable LINE reply ledger | Unique `dedupe_key`; indexed by status/time; records READY/SENDING/SENT/FAILED/UNCERTAIN and send-start time |

Migration `0003_campaign_content_lock.sql` adds triggers that lock the parent campaign on button/activity/message writes and reject content mutation while the campaign is ACTIVE. `CampaignService.publishCampaign()` locks the campaign before reading child rows and setting ACTIVE in one transaction. Changes can be made after pausing, then publication validation must pass again. Integration tests recreate the dedicated local test schema from empty and apply all journaled migrations before each suite.

Migration `0004_sour_husk.sql` adds the Admin identity/session/login attempt tables and `campaigns.version`. Migration `0005_sleepy_bug.sql` creates a partial unique index enforcing at most one ACTIVE campaign, matching the Phase 2 webhook selector. Admin graph saves, publish/pause transitions, and their audit records are transactional; the parent row lock and `version` check reject concurrent/stale writes. Activity IDs are preserved during edits, and an activity referenced by a claim cannot be removed.

The seed campaign uses only example copy and null action destinations. Only its claim action is configured; other buttons and activities are disabled until real destinations are supplied. It remains `DRAFT` and fails publish validation until completed.

## Data handling

Webhook payload JSON is retained so later processing can resume after restarts. It can include user content and identifiers. Define and implement a retention/deletion policy before production deployment; do not log payloads or secrets. Evidence binaries belong in configured object storage, with only a storage key in PostgreSQL.

## Migrations

- Create/update the Drizzle schema.
- Run `npm run db:generate` and review the generated SQL.
- Commit the migration; do not use schema push as a substitute for a reviewed deployment migration.
- Apply with `npm run db:migrate` against a configured database.
