# Task Queue

Valid statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

| Phase | Status | Scope |
|---|---|---|
| Phase 1 — Foundation | DONE | Repository, schema/migrations, domain and services, supported SINGLE_CLAIM policy, publish validation, LINE adapter, seed, tests, and docs |
| Phase 2 — LINE Flow | DONE | Database-backed lease/recovery, welcome Flex card with configured claim action, duplicate/first claim response, worker concurrency, config-safe retries, uncertain-send quarantine, transactional publish and active-content locks; verified on fresh PostgreSQL 18 |
| Phase 3 — Admin Campaign Manager | DONE | Secure first-admin bootstrap/login/session/CSRF, real template-backed campaign editor, duplicate, image URL preview, renderer-backed message preview, publish validation, publish/pause, version locking, audit log, PostgreSQL migrations/tests and docs |
| Phase 4 — Evidence / Review | TODO | Evidence management, review queue, approve/reject, and audit trail |
| Phase 5 — Analytics / Optimization | TODO | Tracking views and operational improvements |

## Next up

- Phase 4 — evidence/review queue: evidence management, review queue, approve/reject and reviewer audit workflow.
- Before production: configure real LINE credentials and channel, deploy migrations, verify a publish-ready campaign with approved destinations, define webhook payload retention, and monitor `UNCERTAIN`/stale `SENDING` outbound statuses. No real LINE calls were made in local tests.
- Phase 2 follow/postback replies use one-time reply tokens and are never retried after a network-uncertain result. A separate, explicitly designed push workflow would need LINE retry-key semantics.
- Phase 3 verification: `npm test` on disposable local PostgreSQL 18 database `ole88_test`, with migration harness rebuilding the empty schema: 37 passed, 0 skipped. Admin login/permission, draft create/edit, 15 activities, duplication without claim/tracking copy, renderer preview, LINE bubble size validation, publish/pause, version conflict/concurrent edit, and audit assertions passed. `npm run typecheck`, `npm run build`, `npm run lint`, `node --check public/admin.js`, and `npm run db:generate` all passed; Drizzle reported no schema changes after migrations 0004 (Admin/version) and 0005 (single ACTIVE campaign constraint).

Stop here; Phase 3 is complete. Do not begin Phase 4 without a separate instruction.
