# Task Queue

Valid statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

| Phase | Status | Scope |
|---|---|---|
| Phase 1 — Foundation | DONE | Repository, schema/migrations, domain and services, supported SINGLE_CLAIM policy, publish validation, LINE adapter, seed, tests, and docs |
| Phase 2 — LINE Flow | DONE | Database-backed lease/recovery, welcome Flex card with configured claim action, duplicate/first claim response, worker concurrency, config-safe retries, uncertain-send quarantine, transactional publish and active-content locks; verified on fresh PostgreSQL 18 |
| Phase 3 — Admin Campaign Manager | DONE | Secure first-admin bootstrap/login/session/CSRF, real template-backed campaign editor, duplicate, image URL preview, renderer-backed message preview, publish validation, publish/pause, version locking, audit log, PostgreSQL migrations/tests and docs |
| Phase 4 — Evidence / Review | DONE | Activity-scoped LINE image evidence, protected storage/media, Admin review decisions, retry-safe notifications, retention, migrations, PostgreSQL integration and unit tests. Production object storage and real LINE OA verification remain pre-production configuration/validation. |
| Phase 5 — Analytics / Operational Dashboard | DONE | Authenticated metrics, campaign/time filters, Bangkok daily trend, status snapshots, paginated operational issue queues, idempotent follow/claim tracking, indexes, tests and metric contract |

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

## Phase 5 behavior and verification status

- Admin Analytics is under `/admin`, with campaign and Bangkok calendar-date filters. Overview metrics and issue endpoints require an Admin session. Dates are translated to UTC `[from,to)` instants; daily buckets use `Asia/Bangkok`. Metric formulas, data sources, and interpretation limits are in `docs/analytics-dashboard.md`.
- No “campaign views/impressions” number is reported. Follow is an observed processed LINE follow event. Claims, evidence submissions, evidence decisions, outbound records, and webhook records are explicitly distinguished as events, unique claims/users, or current status snapshots.
- Tracking migration 0008 adds a unique provider event key to `tracking_events`, plus campaign and purpose metadata for welcome outbox rows. Valid claim postbacks are durably tracked once; claim creation and final NEW/DUPLICATE outcome commit in one PostgreSQL transaction, while ineligible requests are recorded explicitly. Migrations 0009–0010 add campaign/time, event/evidence/outbound time, and webhook lease indexes.
- Operational queues surface expired PROCESSING or FAILED webhooks, FAILED/UNCERTAIN outbox records and stale PUSH/SENDING records, and SUBMITTED evidence older than 24 hours. Lists support limit/offset pagination; no retry action is offered. API responses omit raw webhook payload, message body, recipient ID, token, and image bytes.
- **Passed:** `npm test -- --maxWorkers=1` with disposable PostgreSQL 18.6 (`ole88_test` at `127.0.0.1:55439`): 46 tests passed across 8 files (22 PostgreSQL integration + 24 unit), 0 skipped. The integration harness recreated `public` and applied all migrations from empty schema, including 0008–0010. `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, and `npm run db:generate` passed; generation reports no schema drift.
- Docker daemon was unavailable, so the test used the existing disposable local PostgreSQL 18 cluster under ignored `work/postgres-disposable`; no production/shared database was used. No live LINE OA, customer message, reward, or production deployment was involved.
- Production prerequisites remain: private object storage, authorized OA image/push checks, HTTPS, secret management, backup/restore, explicit retention/deletion periods for webhook/tracking/audit/outbound/evidence data, and operational monitoring. Historical follow/claim interaction rows are not reconstructed; those new tracked metrics start from deployment.

## Staging verification preparation

- Dashboard webhook issue queue explicitly reports `ALL_CAMPAIGNS`; the UI explains that webhook events cannot be attributed to an individual campaign and omits a misleading campaign filter. API returns the scope explicitly. PostgreSQL tests verify selected campaign IDs do not hide global webhook issues.
- Admin login and mutating Origin checks can use configured fixed `PUBLIC_BASE_URL` behind a TLS-terminating proxy; production mode requires an HTTPS origin. A PostgreSQL test verifies the configured public origin succeeds while a foreign origin is rejected.
- Added [staging installation and end-to-end test plan](docs/staging-test-plan.md), including separate PostgreSQL, HTTPS webhook URL, test-only LINE OA, secret-manager configuration, private evidence volume, backup/restore rehearsal, follow-to-review expected results, and stop/rollback steps.
- Added GitHub Actions checks for PostgreSQL-backed tests, typecheck, and build on main pushes and pull requests. The workflow uses a disposable PostgreSQL service and contains no project secrets.
- **Passed locally:** 47 tests across 8 files (23 PostgreSQL integration + 24 unit), 0 skipped. The integration harness recreated an empty public schema and applied all migrations first on disposable local PostgreSQL 18.6 (`ole88_test`, localhost port 55439). `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, and `npm run db:generate` passed; Drizzle reports no schema changes. `git diff --check` passed (Git printed only LF-to-CRLF working-copy notices).
- **Not performed:** no staging host, credentials, test OA, campaign, or HTTPS endpoint was provided, so no real LINE flow or staging deployment was run. No production deployment, customer messaging, or real campaign publication occurred.

## Remaining owner setup before staging

- Provide a staging host with DNS/TLS and a LINE-reachable webhook endpoint.
- Provision isolated PostgreSQL, a backup destination, and a separate restore rehearsal target.
- Create a dedicated test LINE OA/channel and designate a test user.
- Configure database and LINE credentials in the staging secret manager (do not send them in chat), private persistent evidence storage, and the initial Admin.
- Prepare campaign copy/artwork/destinations for a test-only campaign in Admin; verify the complete flow with the test OA before considering production readiness.

## Admin staging closeout — 2026-09-26

This closeout is tracked separately from the completed product phases above. The baseline remains commit `61b56699bdccf443cbc51ea6b539aa7fc1ceeac1`; the 47-test result above is historical baseline evidence and has not been replaced or restated as validation of new changes.

| Track | Status | Evidence / remaining work |
|---|---|---|
| Code hardening | IMPLEMENTED / LOCAL CHECKS PASS | Add bounded DB readiness, opt-in `ADMIN_ONLY`, non-overlapping worker cycles with bounded shutdown, 15-second LINE send timeout, Bangkok Review day filtering, and campaign-attributed Review outbox; VPS configuration and browser behavior remain unverified |
| Automated tests | PASS (LOCAL, 2026-09-26) | 56 passed across 9 files, 0 skipped on a fresh loopback-only PostgreSQL 18 disposable cluster/database `ole88_test`; fresh and repeat migrations, typecheck, build, lint, Admin JS syntax, and diff checks passed |
| VPS staging | NOT STARTED | Read-only host inspection first; OS-specific package/security work, PostgreSQL least-privilege setup, exact-commit deployment, systemd, restricted environment/evidence paths, and owner-created Admin remain outstanding |
| Admin browser acceptance | NOT STARTED | Synthetic data only; verify desktop/mobile workflows, expired session, protected image, filters, version conflict, and enforced no-publish mode |
| Backup/reboot/restore | NOT STARTED | Paired private database/evidence backups, seven daily sets, reboot recovery, and isolated `ole88_restore_test` rehearsal |
| External prerequisites | DEFERRED | HTTPS domain, LINE OA/credentials, production private object storage and rewards are outside Admin-only staging and remain explicitly disabled |
| Incident and provider follow-up | NOT STARTED | Preserve date/timezone and necessary original July 14 log text; keep `gil-u26` systemd-stop fact distinct from login evidence; ask Kamatera about initiator and Console/API/maintenance audit records |

Detailed scope and safety limits: [docs/project-completion-plan.md](docs/project-completion-plan.md). Dated evidence and the current acceptance result: [docs/staging-verification-report.md](docs/staging-verification-report.md). No stage is marked passed until its evidence is recorded.

## Admin-only staging continuation — current status, 2026-09-27

This status supersedes the older staging acceptance rows above where newer evidence is available. The Phase 1–5 history and historical test counts are retained; they are not treated as verification of this current source or of the VPS deployment.

| Track | Status | Current evidence / next gate |
|---|---|---|
| Planner responsive blocker | PASS (local browser) | Mobile and issue-filter wrapping fixed in `public/admin.css`. Actual Planner scripts loaded a local synthetic image draft; image load, hotspot keyboard edit/resize, draw, and in-memory reload passed at 320, 375, 768, 1024, and 1440 px without horizontal overflow. Repeat this check against the VPS release after deployment. |
| Unit tests | PASS | 50 tests across 10 unit files passed. |
| Typecheck/build/lint/scripts | PASS | Typecheck, build, lint, both Admin script syntax checks, and `git diff --check` passed. |
| Admin authentication/session/media boundary | PASS (disposable PostgreSQL integration) | Full suite verified unauthenticated Admin routes, evidence-media protection, CSRF and expired-session rejection. The local static preview had no API; authenticated browser behavior was not repeated against staging after the CSS change. |
| Dashboard synthetic event aggregation | PASS (disposable PostgreSQL integration) | Existing integration fixture invokes `AnalyticsService` directly against synthetic rows on the isolated test DB; it requires neither a LINE/webhook path nor a production backdoor. Live staging event ingestion remains disabled by `ADMIN_ONLY`. |
| Integration suite | PASS | Full `npm test -- --maxWorkers=1`: 75 passed across 11 files, 0 skipped. Fresh PostgreSQL 18.6 cluster, `ole88_test` database and role at `127.0.0.1:55447`; migrations applied from empty schema. One initial fixture failure was corrected to distinguish `ADMIN_ORIGIN` from `PUBLIC_BASE_URL`, then the full suite passed. |
| Disposable DB cleanup | PARTIAL / awaiting approval | Test server was gracefully stopped and the loopback port closed. One synthetic campaign row remains in the newly created, ignored test cluster at `work/ole88-test-round-ef6e87d`; no users/tracking/webhook/Admin rows remain. The cluster directory is retained pending explicit approval before irreversible deletion. |
| VPS deployment and responsive retest | NOT YET TESTED | No SSH/sudo/deployment performed. Last operator-verified VPS release remains `218e0594ed6c23e9b884adf178c7399a5f0270ab`; local HEAD at the start of this continuation was `604b953d404f4db63914bb7f45f427a1e6f602ff`. |
| Backup/restore/reboot/provider follow-up | DEFERRED TO OPERATIONAL ACCEPTANCE | Follow the existing operational checklist; requires authorized VPS/database/storage/provider access and evidence. |
| LINE/public access/production prerequisites | DEFERRED | Keep LINE disconnected, `ADMIN_ONLY` enabled, Admin private, and do not configure public exposure for this staging acceptance. |
| Working tree hygiene | PASS (preserved) | The pre-existing report changes are retained. Root `debug.log` was not deleted or staged; it is ignored to prevent accidental commit. |

**Recommended next action:** publish the verified local commits and deploy only to the isolated staging release, then repeat authenticated mobile/tablet/desktop browser acceptance and confirm the VPS runs the deployed commit. Keep `ADMIN_ONLY` enabled, Admin private, and do not route any test event through LINE.
