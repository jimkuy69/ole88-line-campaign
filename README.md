# OLE88 LINE Campaign Platform

Reusable campaign foundation. Campaign configuration is data; campaign-specific URLs and copy stay out of domain logic. The `OLE88_WELCOME_100` record is draft seed data only.

## Stack

- Node.js 24 LTS and TypeScript
- Fastify 5 for the HTTP boundary
- PostgreSQL and Drizzle ORM/Kit for schema and versioned migrations
- Vitest for automated tests

## Local setup

1. Install Node.js 24 and PostgreSQL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a local development database.
3. Install packages with `npm install`.
4. Apply migrations with `npm run db:migrate`.
5. Load the example draft campaign with `npm run db:seed`.
6. Start the API with `npm run dev`; `GET /health` checks the process and `GET /ready` checks PostgreSQL readiness.
7. Create the first Admin account from an interactive terminal with `npm run admin:create`, then open `http://127.0.0.1:3000/admin`.

No real credentials or campaign destinations are included. Configure the LINE channel secret only in a local secret store or environment variable. Never commit `.env`.

For an isolated Admin-only staging instance with no LINE account or credentials, set `ADMIN_ONLY=true`, `NODE_ENV=development`, `HOST=127.0.0.1`, and `PUBLIC_BASE_URL=http://127.0.0.1:3000`. In this mode the server does not run the webhook worker, rejects webhook requests, and rejects campaign publishing; draft management, review, and dashboard APIs remain available. Use an SSH local-forward rather than exposing the application port. The mode status is shown in Admin. Do not start this mode with an active campaign; verify the database contains no `ACTIVE` campaign.

The Admin interface defaults to Thai and has a Thai/English toggle in the header. The selected interface language is remembered in that browser; it does not translate or modify campaign content.

Integration tests destructively recreate the `public` schema and clear the Drizzle migration journal before migrating. Use a dedicated, disposable local database whose name includes `test`; the test suite rejects non-local hosts or database names without that marker. Never point `TEST_DATABASE_URL` at production or a shared database.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local API with reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run the unit test suite |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run the current static check (TypeScript; a dedicated linter is not configured) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:seed` | Insert idempotent draft example data |
| `npm run admin:create` | Interactively create the first admin (password is hidden; no default account) |
| `npm run test:integration` | Run PostgreSQL integration tests when `TEST_DATABASE_URL` points to a local database with `test` in its name |

`GET /health` is process-only. `GET /ready` executes a bounded PostgreSQL check and returns only `{"status":"not_ready"}` with HTTP 503 when the database cannot be reached.

## Scope

Phase 1 includes the database foundation, reusable campaign and claim services, validated claim state transitions, a single-claim policy guard, publish validation, LINE raw-body signature verification and durable webhook inbox deduplication, tracking foundation, seed data, tests, and documentation. Phase 2 adds leased inbox processing and restart recovery, follow/welcome with a campaign card and claim button built from database configuration, claim/postback replies, and durable outbound reply states that do not retry uncertain one-time reply tokens. Phase 3 adds a database-backed Admin Campaign Manager with secure first-admin bootstrap, hashed sessions, CSRF checks, templates, draft editing/duplication, renderer-backed preview, publish/pause, optimistic concurrency, audit records, and PostgreSQL migration/tests. Phase 4 adds activity-scoped LINE image intake, short-lived upload context, protected local file storage, Admin review queue, version-checked decisions, audit and configured push notification outbox. Rejected evidence can be resubmitted to that activity; required activities gate Claim approval. Phase 5 adds authenticated PostgreSQL analytics and paginated operational issue queues. Reward delivery is deliberately out of scope. Active campaign edits are blocked until pause; only one active campaign is allowed.

The Phase 3 baseline used the disposable local PostgreSQL 18 database `ole88_test`. Phase 4 adds evidence intake/review APIs and UI. Use `EVIDENCE_STORAGE_DIR` for a local private filesystem directory (development/test only) and `EVIDENCE_RETENTION_DAYS` (default 180). Run `npm run evidence:purge` periodically to delete reviewed files and rows after retention; pending evidence is retained. Production object storage is not implemented: configure a private storage adapter before production. A protected Admin endpoint serves image bytes after session-authenticated access; there is no public static path. LINE message-content fetching uses the webhook's message ID with the official content API; Admin decisions queue push messages with a persisted retry key, but no real LINE credentials or OA calls were used. See [LINE message content](https://developers.line.biz/en/reference/messaging-api/#get-content) and [push/retry request behavior](https://developers.line.biz/en/reference/messaging-api/#send-push-message).

Phase 5 adds migration 0008 for idempotent interaction tracking and campaign-aware welcome outbox records, plus migrations 0009–0010 for time, campaign and lease query indexes. Open `/admin` and sign in to use Analytics & operational dashboard. Bangkok date ranges are inclusive calendar days; API queries use a UTC `[from,to)` interval. The dashboard distinguishes events, unique claims/users, evidence rows and status snapshots; it does not report campaign impressions. Issue lists are paginated and omit payloads, message bodies, tokens, LINE identities and image bytes. See [analytics metric definitions and operational limits](docs/analytics-dashboard.md).

For a controlled, test-only install, follow the [staging installation and end-to-end test plan](docs/staging-test-plan.md). It covers a separate PostgreSQL database, the exact HTTPS webhook origin, a dedicated test LINE OA, secret-manager setup, private evidence storage, backup/restore rehearsal, expected LINE/Admin results, and stop/rollback steps. Production mode requires `PUBLIC_BASE_URL` to be an HTTPS origin; this also lets Admin Origin checks work behind a TLS-terminating staging proxy.

See [Admin Campaign Manager](docs/admin-campaign-manager.md), [architecture](docs/architecture.md), [database](docs/database.md), [campaign engine](docs/campaign-engine.md), [claim state machine](docs/claim-state-machine.md), [LINE integration](docs/line-integration.md), [analytics dashboard](docs/analytics-dashboard.md), and [task queue](TASK_QUEUE.md).
