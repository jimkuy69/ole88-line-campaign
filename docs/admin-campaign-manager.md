# Admin Campaign Manager (Phase 3)

## Development setup

1. Install dependencies with `npm install` and copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to a local PostgreSQL database. Apply the versioned migrations with `npm run db:migrate`.
3. Create the first administrator in an interactive terminal with `npm run admin:create`. The command prompts for a username and twice for a password; password input is not echoed or read from an environment variable or command-line argument. It refuses to create an account if any admin already exists. Passwords are stored as salted scrypt hashes.
4. Start the app using `npm run dev`, then open `http://127.0.0.1:3000/admin`.

There is no default admin, no `ADMIN_SECRET` login, and no admin creation route. Admin sessions use opaque random tokens stored only as SHA-256 hashes, eight-hour expiry, HttpOnly/SameSite=Strict cookies (Secure in production), and a CSRF token required for mutations. Login failures are rate-limited in PostgreSQL per source-IP hash. Do not expose the development server publicly.

## Campaign workflow

The UI supports campaign listing, creation from one of the central templates, duplicate-to-new-draft, editing, preview, publish, and pause. The template registry lives in `src/modules/admin/templates.ts`; templates define initial campaign fields, buttons, activities, and the three Phase 2 messages. Campaign-specific behavior remains data-driven. The `OLE88_WELCOME_100` row remains sample seed data.

Draft save writes the campaign and child collections in one transaction. Edits require the version observed when the form was opened; stale updates return HTTP 409. Active campaigns are immutable until paused. Existing activity rows keep their database IDs when edited; an activity already referenced by a claim cannot be removed. Publish uses the Phase 2 validation and renderer, locks the campaign row, checks its version, changes status and writes audit data in one transaction. Since the current LINE welcome flow selects a single active campaign, PostgreSQL enforces at most one ACTIVE campaign at a time; pause it before publishing another.

The preview uses the same `buildCampaignCard` and `buildActivityCard` renderer as webhook delivery. It shows welcome text/card and claim response/activity content plus field-path validation issues. Admin editing is available only to an authenticated account.

## Images and LINE constraints

Image upload is not configured. Store an HTTPS image URL in the campaign; the browser displays a preview. The application does not fetch the URL server-side. The URL must be publicly reachable by LINE when a campaign is sent. LINE documents Flex image URLs as HTTPS (TLS 1.2+), JPEG/PNG, no more than 1024 × 1024 pixels and 10 MB, with URL length up to 2000 characters. The app validates HTTPS and URL length but cannot prove image format, dimensions, size, or public reachability without a real remote check.

The renderer caps the Flex bubble JSON at 30 KB, the alt text at LINE's 1500-character maximum, postback data at 300 characters, and reply payloads at five message objects. Flex action labels are rendered to at most 40 characters. URI actions are restricted by this application to HTTPS and 1000 characters. The current sample project has no real LINE credentials and does not call LINE's message-validation endpoint; use LINE's official validator after channel credentials are configured, before live messaging.

Official references: [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/) and [Retrying API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/). LINE retry keys are documented for push, multicast, narrowcast, and broadcast calls; reply messages are not included, so Phase 2 keeps uncertain reply-token sends quarantined.

## API routes

- `POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`
- `GET /api/admin/campaigns`, `GET /api/admin/templates`
- `POST /api/admin/campaigns` (template + code), `GET /api/admin/campaigns/:id`
- `PUT /api/admin/campaigns/:id` (full draft graph + `expectedVersion`)
- `POST /api/admin/campaigns/:id/duplicate` (new code)
- `POST /api/admin/campaigns/preview` (unsaved graph)
- `POST /api/admin/campaigns/:id/publish` and `/pause` (`expectedVersion`)

All API routes other than login require an authenticated session; all mutations require a CSRF header. API JSON inputs use strict schema validation. Audit events record actor, action, campaign, versions/changed field names, and template/source references without storing credentials.

## Tests and known limits

Integration tests destructively recreate the `public` schema and migration journal. Run them only against a disposable local PostgreSQL database named with `test`:

```powershell
$env:TEST_DATABASE_URL='postgres://user@127.0.0.1:5432/ole88_test'
npm test
```

Admin user management beyond secure creation of the first administrator is not exposed in this phase. Image uploads, live LINE validation, production deployment, and Phase 4/5 are out of scope. A campaign can contain up to 200 activities in the editor API, but the actual rendered Flex card is bounded by LINE's 30 KB bubble limit; preview/publish validation reports the activity field when rendering exceeds it.
