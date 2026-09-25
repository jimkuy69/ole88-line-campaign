# Task Queue

Valid statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

| Phase | Status | Scope |
|---|---|---|
| Phase 1 — Foundation | DONE | Repository, schema/migrations, domain and services, supported SINGLE_CLAIM policy, publish validation, LINE adapter, seed, tests, and docs |
| Phase 2 — LINE Flow | DONE | Database-backed lease/recovery, welcome Flex card with configured claim action, duplicate/first claim response, worker concurrency, config-safe retries, uncertain-send quarantine, transactional publish and active-content locks; verified on fresh PostgreSQL 18 |
| Phase 3 — Admin Campaign Manager | DONE | Secure first-admin bootstrap/login/session/CSRF, real template-backed campaign editor, duplicate, image URL preview, renderer-backed message preview, publish validation, publish/pause, version locking, audit log, PostgreSQL migrations/tests and docs |
| Phase 4 — Evidence / Review | DONE | Activity-scoped LINE image evidence, protected storage/media, Admin review decisions, retry-safe notifications, retention, migrations, PostgreSQL integration and unit tests. Production object storage and real LINE OA verification remain pre-production configuration/validation. |
| Phase 5 — Analytics / Optimization | TODO | Tracking views and operational improvements |

## Next up

- Before production: provide a production private object-storage adapter/configuration and validate real LINE image retrieval/push notification behavior with an authorized test OA. No live OA credentials/calls are in this task.
- Before production: configure real LINE credentials and channel, deploy migrations, verify a publish-ready campaign with approved destinations, define webhook payload retention, and monitor `UNCERTAIN`/stale `SENDING` outbound statuses. No real LINE calls were made in local tests.
- Phase 2 follow/postback replies use one-time reply tokens and are never retried after a network-uncertain result. A separate, explicitly designed push workflow would need LINE retry-key semantics.
- Phase 3 hardening (post-completion): Editor Publish previews and submits the same in-memory draft snapshot. Server persists that graph, validates the persisted records, and publishes within one transaction. A stale version from another window returns HTTP 409 without publishing or overwriting the newer draft. PostgreSQL test covers edited message, button label, title and activity link published without a separate Save click, plus stale-window conflict. Latest verification: full `npm test` against disposable local PostgreSQL 18.6 (`ole88_test`), all migrations reapplied from an empty schema: 38 passed, 0 skipped (17 PostgreSQL integration, 21 unit). `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, and `npm run db:generate` passed; Drizzle reports no schema changes. No LINE OA calls or production deployment.

## Phase 4 behavior and verification status

- Evidence requires an explicit activity-specific Submit proof postback; a 10-minute context binds the LINE identity, its exact claim, and claim activity. An unknown/expired selection never chooses the latest claim. LINE message IDs are uniquely indexed; evidence records identity and claim-activity references, with legacy unlinked rows excluded from queue/media and needing reconciliation.
- Only one pending evidence item per activity is accepted. Admin Reject requires a reason; a customer may reselect and resubmit. Claim becomes APPROVED only after every enabled required activity is approved. Claim is never moved to `REWARD_SENT` here.
- Development/test storage is private filesystem storage (`EVIDENCE_STORAGE_DIR`, default `work/evidence`); Admin media is protected by session auth and never served publicly. Production private object storage adapter remains TODO. `npm run evidence:purge` removes reviewed evidence after `EVIDENCE_RETENTION_DAYS` (default 180); pending records/files are preserved.
- Image fetch follows LINE's official message content endpoint; Admin outcome notifications use push via outbox with a persisted `X-Line-Retry-Key`. Reply tokens are not reused for delayed decisions. No actual LINE OA requests, messages, or production deployment were performed.
- Latest Phase 4 verification: `npm run db:generate` reports no schema changes. Disposable local PostgreSQL 18.6 at localhost port 55439 was started from ignored `work/postgres-disposable` using `postgres.exe` foreground (`pg_ctl` itself failed with restricted-token error 87); the integration harness dropped/recreated `public`, then applied every migration from empty. `npm test -- --maxWorkers=1` with `NODE_OPTIONS=--max-old-space-size=4096` and `TEST_DATABASE_URL=postgres://ole88@127.0.0.1:55439/ole88_test`: 8 suites, 44 passed, 0 skipped (20 PostgreSQL integration, 24 unit). `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, and `npm run db:generate` passed. No real LINE OA calls/messages or production deployment. Production object storage and authorized test OA validation remain before production use.

Stop here; Phase 4 only. Do not begin Phase 5.
