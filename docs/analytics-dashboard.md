# Analytics and operational dashboard

The Admin dashboard is available at `/admin` and its API is under `/api/admin/analytics`. Every dashboard endpoint requires an Admin session. The dashboard reads PostgreSQL records; it contains no seeded or mock metric values. Its date inputs are Bangkok calendar dates, converted to UTC instants with an exclusive end (`[from,to)`). Daily trend buckets use `Asia/Bangkok`. Database timestamps remain `timestamptz` instants.

## Metric contract

| Metric | Formula / source | Time basis and interpretation |
|---|---|---|
| Follow events | Count of `tracking_events.event_type = FOLLOW_PROCESSED` | `created_at` in selected range. An accepted LINE follow processed by the worker; does not prove a campaign impression. |
| Unique followers | Distinct non-null `tracking_events.user_id` for `FOLLOW_PROCESSED` | Same range; counts platform user records, never LINE IDs in the response. |
| Welcome sent | `outbound_messages` where `purpose = WELCOME` and current status is `SENT` | `sent_at` in selected range; campaign ID was captured when the welcome was queued. Failed/uncertain welcome attempts do not count as sent. |
| Claim request events | Count of idempotent `CLAIM_REQUEST` tracking rows | A configured claim postback is recorded before eligibility/claim handling starts; keyed to the provider webhook event ID so redelivery is not counted twice. Pending outcomes remain visible if work stops. |
| Claims referenced by claim requests | Distinct non-null `claim_id` among those request rows | A claim may be referenced by multiple request events. |
| Duplicate claim requests | Claim request rows whose recorded `metadata.outcome` is `DUPLICATE` | The outcome is set transactionally with claim lookup/creation and remains unchanged on webhook retry. |
| Ineligible claim requests | Claim request rows whose outcome is `INELIGIBLE` | The configured postback was recognized but campaign schedule/limit/state prevented a claim. |
| Unique claims | Count of `claims` by `claimed_at`; unique per user/campaign is enforced by PostgreSQL | Claim records created in selected range. |
| Unique claimers | Distinct `claims.user_id` in the selected range | Users may still appear once per campaign in the selected campaign filter. |
| Proof submitted | Count of `evidence` by `created_at` | Evidence submissions, including a permitted resubmission, not unique people. |
| Claims with proof | Distinct `evidence.claim_id` by evidence `created_at` | Claims with at least one evidence submission in the range. |
| Pending review | Current count of `evidence.status = SUBMITTED` | Snapshot at query time; not restricted by the selected dates. Campaign filter still applies. |
| Evidence approved/rejected | Evidence rows in the current `APPROVED`/`REJECTED` state with `reviewed_at` in range | Evidence decisions, not unique users. Separate distinct-claim totals are also returned. |
| Outbound SENT/FAILED/UNCERTAIN | Outbox row counts grouped by current status | Outbox `created_at` in selected range. This is a current-state view of records created in that period; no retry action is provided. |
| Webhook RECEIVED/PROCESSING/FAILED | Inbox row counts grouped by current status | Inbox `received_at` in selected range. LINE redelivery is deduplicated by channel/provider event ID. |

The daily trend reports follow events, welcome messages sent, claim request events, unique claim records, proof submissions, and evidence decisions. It counts event/evidence/claim rows by Bangkok day; it does not claim unique daily people unless the metric is explicitly labelled unique.

## Operational issue queues

The issue endpoint is paginated (`limit` 1–100 and `offset`) and returns references, status, category, timestamps, and error codes only. It never returns webhook payloads, message bodies, reply tokens, LINE user IDs, or evidence bytes.

- **Webhook backlog:** `FAILED` events and `PROCESSING` events whose lease has expired (or has no lease).
- **Outbound review:** `FAILED` and `UNCERTAIN` outbox rows, plus `PUSH/SENDING` rows whose send lease is older than 45 seconds. The dashboard does not retry messages. Review uncertain sends against provider records before any manual action.
- **Overdue evidence:** `SUBMITTED` evidence older than 24 hours. The current threshold is fixed in the service and shown as an operational signal, not a service-level guarantee.

Queries use event/claim/evidence/outbound time indexes and webhook lease indexes introduced with migrations 0008–0010, along with existing status indexes. Dashboard read APIs are session-protected and are not cached. Issue rows are ordered oldest first so operators see the longest-running work first.

## Tracking and limits

`FOLLOW_PROCESSED` is written once per provider event ID when an active campaign's configured welcome card can be built. A valid claim postback is first recorded as `PENDING`; claim creation and final `NEW`/`DUPLICATE` outcome are committed in one PostgreSQL transaction. A recognized but ineligible request is marked `INELIGIBLE`. The unique nullable provider event key prevents webhook redelivery from creating a second row or turning a first successful request into a duplicate. Welcome delivery is identified on the outbox row itself, while proof and review metrics read evidence records directly. Existing historical records from before this migration do not gain reconstructed tracking events, so the new interaction metrics only cover events recorded after deployment; claim/evidence/outbox/inbox metrics can include older rows if their timestamps fall inside the selected range.

There is no confirmed “campaign seen” event in this platform. LINE follow does not mean the user saw a campaign card. Event, webhook, evidence, outbox, and audit retention policies must be decided and implemented before production; dashboard access follows the existing Admin session controls. Avoid exporting dashboard data because references can be sensitive operational identifiers.

## Verification and production prerequisites

Dashboard behavior is exercised with a disposable local PostgreSQL database, including unique and duplicate claims, follow webhook redelivery idempotency, outbound/webhook statuses, evidence decision counts, Bangkok daily rows, issue pagination, and unauthenticated API denial. Tests use generated data and a simulated LINE sender. This does not verify a real LINE OA.

Before production use, configure private object storage for evidence, test image retrieval and push notifications with an authorized LINE OA, configure HTTPS, manage secrets in a protected secret store, establish database backups and restore tests, and define retention/deletion periods for webhook payloads, tracking, audit, outbound metadata, and evidence. No production deployment or customer messages were performed for Phase 5.
