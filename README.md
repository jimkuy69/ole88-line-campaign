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
6. Start the API with `npm run dev`; `GET /health` is available for a local health check.
7. Create the first Admin account from an interactive terminal with `npm run admin:create`, then open `http://127.0.0.1:3000/admin`.

No real credentials or campaign destinations are included. Configure the LINE channel secret only in a local secret store or environment variable. Never commit `.env`.

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

## Scope

Phase 1 includes the database foundation, reusable campaign and claim services, validated claim state transitions, a single-claim policy guard, publish validation, LINE raw-body signature verification and durable webhook inbox deduplication, tracking foundation, seed data, tests, and documentation. Phase 2 adds leased inbox processing and restart recovery, follow/welcome with a campaign card and claim button built from database configuration, claim/postback replies, and durable outbound reply states that do not retry uncertain one-time reply tokens. Phase 3 adds a database-backed Admin Campaign Manager with secure first-admin bootstrap, hashed sessions, CSRF checks, templates, draft editing/duplication, renderer-backed preview, publish/pause, optimistic concurrency, audit records, and PostgreSQL migration/tests. Active campaign edits are blocked until pause; this LINE flow allows one active campaign at a time. Evidence review and analytics remain later phases.

The Phase 3 baseline used the disposable local PostgreSQL 18 database `ole88_test`. A follow-up hardening run verifies that Publish submits the same unsaved draft snapshot that Preview rendered, persists and validates that graph atomically, and returns HTTP 409 when another window has saved a newer version. The complete suite and checks are listed in `TASK_QUEUE.md` for the latest run. The integration harness reapplies all migrations from an empty schema. No live LINE API calls or deployment were made; reply tests use injected senders. The Admin UI uses HTTPS image URLs only; upload and real LINE message validation are not configured.

See [Admin Campaign Manager](docs/admin-campaign-manager.md), [architecture](docs/architecture.md), [database](docs/database.md), [campaign engine](docs/campaign-engine.md), [claim state machine](docs/claim-state-machine.md), [LINE integration](docs/line-integration.md), and [task queue](TASK_QUEUE.md).
