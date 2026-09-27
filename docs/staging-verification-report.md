# OLE88 Admin staging verification report

**Report started:** 2026-09-26  
**Repository baseline:** `218e0594ed6c23e9b884adf178c7399a5f0270ab`
**Staging release commit:** `218e0594ed6c23e9b884adf178c7399a5f0270ab`
**Local source HEAD at the start of this continuation (2026-09-27):** `604b953d404f4db63914bb7f45f427a1e6f602ff` (continuation changes not deployed)
**Verified source commit after this continuation:** `525226c71b8e228d34a119fd407e038c6dafb33c` (pushed to `staging/campaign-image-planner`, not deployed)
**Overall result:** **ADMIN-ONLY STAGING AVAILABLE — not production-ready and not connected to LINE.**

## Repository and code

| Check | Result | Evidence |
|---|---|---|
| Deployed commit | PASS | VPS release and repository HEAD are `218e0594ed6c23e9b884adf178c7399a5f0270ab` |
| Existing worktree changes | PRESERVED | The modified report was retained. Root `debug.log` remains on disk, was not staged or deleted, and is ignored to prevent accidental commit; only metadata was recorded. |
| `/health` and `/ready` | PASS (VPS) | Operator verified both return HTTP 200 from the VPS on 2026-09-26 |
| Admin localization asset | PASS (VPS) | `/admin-i18n.js` returned HTTP 200 with `text/javascript; charset=utf-8` after deploying the route fix |
| `ADMIN_ONLY` | PASS (staging observation, 2026-09-27) | Automated coverage verifies webhook/worker suppression and publish denial; the staging browser showed the mode notice, disabled Publish, and only DRAFT campaigns. |
| Review Bangkok date boundaries | PASS (local integration) | Review query includes Bangkok midnight and excludes the next midnight; unit and PostgreSQL boundary checks passed |
| Review notification campaign attribution | PASS (local integration) | Synthetic decision outbox rows retain campaign ID and `EVIDENCE_DECISION` purpose |

## Automated tests

Historical baseline retained from `TASK_QUEUE.md`: 47 tests across 8 files (23 PostgreSQL integration, 24 unit), zero skipped on disposable local PostgreSQL 18.6; typecheck, build, lint, Admin JS syntax, and Drizzle generation passed at the recorded earlier baseline. This historical result does not validate the current worktree.

**Current worktree, 2026-09-26:** 56 tests passed across 9 files, zero skipped. The PostgreSQL integration suite ran against a newly initialized local PostgreSQL 18 cluster bound only to `127.0.0.1`, with a fresh `ole88_test` database; the integration harness recreated `public` and applied the full migration chain. A subsequent `npm run db:migrate` completed successfully without duplicating migrations. The cluster and its temporary files were stopped and removed after the run. The tests use mocks for LINE; no LINE request was sent.

Also passed after the changes: `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, and `git diff --check`. The targeted regression subset passed 14 tests across 3 files. These local test results do not substitute for deployment or browser acceptance.

After adding the Admin localization asset route, `npm run build` and the targeted `tests/unit/server.test.ts` passed (7 tests). Documentation-only updates do not change application behavior.

## VPS and browser

| Check | Result | Evidence |
|---|---|---|
| VPS service | PASS | `ole88-staging.service` active/running under systemd; app port remains loopback-only |
| Health/readiness | PASS | `/health` = `{"status":"ok"}` and `/ready` = `{"status":"ready"}` |
| Localization asset | PASS | `/admin-i18n.js` returns HTTP 200 and JavaScript content type |
| Admin browser access | PARTIAL PASS | Authenticated Admin page and Thai interface/Dashboard rendered through local browser access; draft list visible |
| Draft save and reload | PASS (prior staging observation, 2026-09-27) | The retained synthetic campaign and image plan were present after reload. This round did not repeat a server-backed edit/save/reload. |
| Preview acceptance | PARTIAL PASS (prior staging observation, 2026-09-27) | Preview rendered the configured controls; it is not a LINE runtime and the rendered controls did not navigate or generate events. |
| DuckDNS hostname and HTTPS | NOT CONFIGURED | App is loopback-only; no public reverse proxy or external Admin access is enabled |
| LINE integration or live publish | NOT ENABLED | No LINE credentials/OA; ADMIN_ONLY mode rejects processing and publishing |
| Root/sudo changes, package updates, reboot | COMPLETED EARLIER | Operator-provided history records initial OS maintenance and reboot; post-deployment reboot recovery is not retested |
| PostgreSQL staging/test/restore databases and roles | COMPLETED EARLIER | Operator-provided history records staging database, least-privilege role, migrations and schema; backup/restore rehearsal remains outstanding |
| Desktop/mobile browser acceptance | NOT VERIFIED | A single browser session was inspected; responsive-device coverage has not been performed |
| Paired backup and restore rehearsal | NOT PERFORMED | Backup/restore rehearsal remains a release gate |
| July 14 log review / Kamatera response | NOT PERFORMED | Review evidence has not been provided |

VPS deployment and health-check evidence in this report is based on operator-provided terminal output and the shared Admin browser page. No credentials, sudo password, SSH key, LINE account, or customer data were requested or used. The staging is suitable for controlled Admin-only draft testing, but incomplete operational and browser acceptance gates prevent production sign-off.

## Safety declaration

No LINE OA is connected, no LINE API call or message has been sent, no staging campaign has been published, no reward has been delivered, and no production data or service was changed in this work session. DuckDNS and public Admin access have not been configured.

Update this report with dated, reproducible evidence. Keep automated test output separate from browser observations and operator/VPS actions.

## Admin action and dashboard acceptance — 2026-09-27

Browser checks were performed against the authenticated Admin through the existing local staging tunnel. No code or configuration was deployed or changed.

| Check | Result | Evidence |
|---|---|---|
| Dashboard refresh and campaign/date filters | PASS (read-only) | Selecting the synthetic test campaign and applying filters rendered its metrics, daily trend, outbound/webhook status, and issue queue. All counts were zero, as expected because no events were generated. |
| Operational issue queues and evidence queue | PASS (read-only) | Webhook, outbound, overdue-evidence, and review filters responded and showed empty states. |
| Language switch | PASS | Admin switched Thai → English → Thai. |
| Synthetic campaign action values | PASS (save/reload) | Created and retained `SYNTHETIC_ACTION_QA_20260927` as DRAFT v3. A generated claim POSTBACK, a URI button and a URI activity using reserved `example.invalid` destinations were present after reload. The original Welcome Bonus draft remained DRAFT v2. |
| Image plan data | PASS (save/reload; handoff only) | The synthetic draft references the existing uploaded image and stores one hotspot bound to its synthetic URI button at x=40, y=650, w=920, h=90 (scale 1000). Planner validation returned “Ready for internal handoff.” No asset was uploaded or deleted. |
| Preview and image hotspot click behavior | NOT A RUNTIME ACTION | Preview rendered buttons without href/action handlers. Clicking preview buttons did not navigate. Clicking the hotspot selected its outline only; it did not open the target or create a click event. This matches the Planner’s documented limitation: it is not a LINE Imagemap/runtime implementation. |
| Dashboard event ingestion / nonzero metrics | BLOCKED BY ADMIN_ONLY | The local staging webhook returned HTTP 503. No event or test user was inserted into staging, so the Dashboard correctly remained zero; actual metric increments were not demonstrated in staging. |
| Publish protection / active campaign check | PASS | `ADMIN_ONLY` notice was visible, Publish was disabled, and the Admin campaign list contained only DRAFT campaigns (zero ACTIVE). No publish, LINE message, or reward occurred. |
| Mobile layout | PASS (local browser CSS retest) | The earlier narrow-viewport overflow was fixed in `public/admin.css`. The local static-preview check below found no horizontal overflow at the tested viewport widths; the VPS release still needs the same responsive retest after deployment. |

Focused local unit tests passed: 16 tests across `campaign-image-hotspots.test.ts`, `campaign-publish-validation.test.ts`, and `campaign-and-tracking.test.ts`. Database integration tests were not run in this check because no verified disposable `TEST_DATABASE_URL` was configured. Existing documented PostgreSQL integration coverage is historical evidence, not a run performed here.

The synthetic QA draft is intentionally retained in staging for inspection. Its `example.invalid` links are placeholders and must not be treated as live destinations. A nonzero Dashboard event-flow test still requires an isolated test database/test event path that cannot reach LINE; do not disable `ADMIN_ONLY` on this staging deployment to obtain that result.

## Admin-only continuation — responsive fix and safe local checks — 2026-09-27

The local source HEAD for this check was `604b953d404f4db63914bb7f45f427a1e6f602ff`; this source was not deployed to the VPS. The VPS release remains the last operator-verified `218e0594ed6c23e9b884adf178c7399a5f0270ab`.

| Track | Status | Evidence / remaining work |
|---|---|---|
| Planner responsive layout | PASS (local browser, CSS/UI only) | Updated mobile spacing and wrapping for the page header, operational issue filters, Planner controls, labels and selects. An allowlisted static preview bound only to `127.0.0.1` used the actual Admin scripts/styles and a synthetic in-memory draft; the hidden manager/editor was revealed in this browser tab only for layout and interaction checks. Image loading, hotspot keyboard movement/resizing, drawing a second hotspot, and reloading Planner state from that in-memory draft worked. No document overflow or out-of-viewport elements at 320, 375, 768, 1024, and 1440 px. This was not a staging login, server-side save, or database-backed reload, and no application access control was changed. |
| Draft save/reload and preview | NOT YET TESTED in this local preview | The static preview has no Admin API. No save or preview request was simulated. Earlier staging-browser draft save/reload evidence remains as recorded above; preview action behavior remains limited to its documented non-runtime handoff. |
| Admin authentication, session expiry, protected routes/media | PASS (disposable PostgreSQL integration) | The full integration suite passed its Admin authentication boundary coverage for unauthenticated routes, protected evidence media, CSRF and an expired session. The static-preview browser itself had no Admin API; authenticated staging-browser behavior was not repeated after the CSS change. |
| ADMIN_ONLY, disabled Publish, no ACTIVE campaign | PASS (prior staging observation; not changed) | The 2026-09-27 staging observation recorded the Admin-only notice, disabled Publish button, and only DRAFT campaigns. This round did not connect to staging or change campaign records. |
| Dashboard event aggregation | PASS (disposable PostgreSQL integration) | `tests/integration/database.integration.test.ts` uses isolated test-only database fixtures and invokes `AnalyticsService` directly; it does not send a public LINE webhook or add a production backdoor. The existing live staging event path remains blocked by `ADMIN_ONLY` as intended. |
| Unit tests | PASS | The final `npm test -- --maxWorkers=1` run included 50 unit tests across 10 files. |
| Static checks | PASS | `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, `node --check public/admin-image-hotspot-planner.js`, and `git diff --check` passed. |
| Integration tests / disposable DB | PASS | Full suite: 75 passed across 11 files, zero skipped. PostgreSQL 18.6 was initialized this round in a new cluster under `work/ole88-test-round-ef6e87d`; the verified target was `ole88_test` / `ole88_test` at `127.0.0.1:55447`, bound only to loopback. The integration setup recreated the `public` schema and applied all migrations from empty; post-run checks found 11 migration records and 17 tables. |
| Integration test correction | PASS | The first run found one pre-existing test-fixture mismatch (74 passed, 1 failed): it supplied `PUBLIC_BASE_URL` while expecting that value to configure the Admin origin. The fixture now configures `ADMIN_ORIGIN` independently from the campaign-image `PUBLIC_BASE_URL`, matching the documented origin separation; the full rerun passed. No production security behavior was loosened. |
| Branch push / CI | PASS / NOT TRIGGERED | Verified source commit `525226c71b8e228d34a119fd407e038c6dafb33c` is on `origin/staging/campaign-image-planner`. The `Checks` workflow is configured for pushes to `main` and pull requests targeting `main`, so no GitHub Actions run was triggered by this staging-branch push. |
| Disposable DB cleanup | PARTIAL / approval needed for file removal | After the test suite, the database contained one synthetic campaign row and no users, tracking events, webhook events, Admin users, or sessions. The loopback test server was gracefully stopped and its port closed. The uniquely created `work/ole88-test-round-ef6e87d` data directory remains on disk; removing it would irreversibly delete that disposable test cluster and its migration/test data. |
| VPS / deployment | BLOCKED on SSH | No existing `ole88-staging` SSH process or local Admin tunnel was found. No SSH, sudo, package, database, service, or deployment command was run; no VPS files or services were changed. |
| Working tree hygiene | PASS (preserved) | The existing `docs/staging-verification-report.md` edits were retained and updated. The untracked root `debug.log` was left in place and not staged or deleted; `/debug.log` is now ignored to prevent accidental commit of a local log. |

No LINE credential, webhook, public Admin route, shared database, production database, or staging database was used for these local checks. Existing CSS breakage is resolved in the local worktree, but VPS responsive verification and the remaining operations acceptance gates are still required before closeout.
