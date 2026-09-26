# Admin Campaign Manager (Phase 3)

## Development setup

1. Install dependencies with `npm install` and copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to a local PostgreSQL database. Apply the versioned migrations with `npm run db:migrate`.
3. Create the first administrator in an interactive terminal with `npm run admin:create`. The command prompts for a username and twice for a password; password input is not echoed or read from an environment variable or command-line argument. It refuses to create an account if any admin already exists. Passwords are stored as salted scrypt hashes.
4. Start the app using `npm run dev`, then open `http://127.0.0.1:3000/admin`.

There is no default admin, no `ADMIN_SECRET` login, and no admin creation route. Admin sessions use opaque random tokens stored only as SHA-256 hashes, eight-hour expiry, HttpOnly/SameSite=Strict cookies (Secure in production), and a CSRF token required for mutations. Login failures are rate-limited in PostgreSQL per source-IP hash. Do not expose the development server publicly.

The browser interface defaults to Thai. Use the header toggle to switch between Thai and English; the selection is saved in that browser. This localizes interface labels only and does not translate campaign content.

## Campaign workflow

The UI supports campaign listing, creation from one of the central templates, duplicate-to-new-draft, editing, preview, publish, and pause. The template registry lives in `src/modules/admin/templates.ts`; templates define initial campaign fields, buttons, activities, and the three Phase 2 messages. Campaign-specific behavior remains data-driven. The `OLE88_WELCOME_100` row remains sample seed data.

Draft save writes the campaign and child collections in one transaction. Edits require the version observed when the form was opened; stale updates return HTTP 409. Active campaigns are immutable until paused. Existing activity rows keep their database IDs when edited; an activity already referenced by a claim cannot be removed. Publish from the editor previews one snapshot of the current form and submits that same draft with the observed version. The server saves the draft graph, reads and validates the saved graph, changes it to ACTIVE, and writes audit data in one transaction (`POST /api/admin/campaigns/:id/publish` with `expectedVersion` and `draft`). If another window saved first, the version check returns HTTP 409 before any fields are changed or the campaign is published. Since the current LINE welcome flow selects a single active campaign, PostgreSQL enforces at most one ACTIVE campaign at a time; pause it before publishing another.

The preview uses the same `buildCampaignCard` and `buildActivityCard` renderer as webhook delivery. It shows welcome text/card and claim response/activity content plus field-path validation issues. Admin editing is available only to an authenticated account.

## Images and LINE constraints

Campaign hero and secondary images can use an HTTPS URL; the browser displays a preview and the application does not fetch that URL server-side. The URL must be publicly reachable by LINE when a campaign is sent.

The Admin Campaign Image Planner accepts up to four JPEG/PNG images per plan (10 MiB maximum per file, 4096 pixels per dimension, and 16 megapixels decoded). Uploads are limited to 20 per Admin per rolling hour with at most two image-processing operations concurrently per application process. It records verified file metadata and opaque asset IDs, binds normalized rectangular touch areas to existing targets, and persists the design under `campaign.settings.imageHotspots`. Each touch area has a stable ID and integer coordinates from 0–1000 against the uncropped image plane; x/y may be zero, while width/height must be positive and remain within the image. Use arrow keys to move a focused area and Shift + arrow keys to resize it.

Export is a server-validated `ole88.campaign-image-handoff/2.0.0` internal team plan with image metadata/checksums, normalized and derived pixel coordinates, target action details, checked/not-checked validation rules, warnings, and a Thai AI handoff prompt. The JSON does not embed image bytes; separately attach or open the referenced images. Upload requires Admin authentication, same-origin/CSRF checks, actual image decoding, and JPEG/PNG signature validation. Public image delivery uses opaque asset IDs only and never exposes the storage directory. The dry-run orphan endpoint reports assets not referenced by saved campaign settings and never deletes them. There is no schema migration because asset metadata and references are stored in existing JSONB settings and filesystem sidecars. Production must configure `CAMPAIGN_ASSET_STORAGE_DIR` as an absolute persistent path outside a release and back it up; the public reverse proxy must be separately configured to expose only the asset route. **This is only a planning handoff:** it is not a LINE message or ready-to-use Imagemap, does not make hotspots clickable in LINE, and does not test public image reachability or LINE acceptance. The Flex renderer, campaign webhook behavior, publishing, and outbound LINE messages are unchanged. Changes in this worktree have not been deployed to staging.

LINE documents Flex image URLs as HTTPS (TLS 1.2+), JPEG/PNG, no more than 1024 × 1024 pixels and 10 MB, with URL length up to 2000 characters. The app validates HTTPS and URL length but cannot prove image format, dimensions, size, or public reachability without a real remote check.

The renderer caps the Flex bubble JSON at 30 KB, the alt text at LINE's 1500-character maximum, postback data at 300 characters, and reply payloads at five message objects. Flex action labels are rendered to at most 40 characters. URI actions are restricted by this application to HTTPS and 1000 characters. Automated tests do not call LINE's message-validation endpoint; use LINE's official validator before live messaging.

Official references: [LINE Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/) and [Retrying API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/). LINE retry keys are documented for push, multicast, narrowcast, and broadcast calls; reply messages are not included, so Phase 2 keeps uncertain reply-token sends quarantined.

## API routes

- `POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`
- `GET /api/admin/campaigns`, `GET /api/admin/templates`
- `POST /api/admin/campaigns` (template + code), `GET /api/admin/campaigns/:id`
- `PUT /api/admin/campaigns/:id` (full draft graph + `expectedVersion`)
- `POST /api/admin/campaign-assets` (raw JPEG/PNG bytes; Admin session + CSRF)
- `GET /campaign-assets/:assetId` (public immutable image by opaque UUID)
- `GET /api/admin/campaign-assets/orphans` (authenticated dry-run report; no deletion)
- `POST /api/admin/campaigns/:id/image-plan/export` (validates the submitted draft and returns the handoff JSON plus Thai prompt; requires the observed draft version)
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

Admin user management beyond secure creation of the first administrator is not exposed in this phase. Image uploads, Imagemap runtime delivery, live LINE validation, production deployment, and Phase 4/5 are out of scope. A campaign can contain up to 200 activities in the editor API, but the actual rendered Flex card is bounded by LINE's 30 KB bubble limit; preview/publish validation reports the activity field when rendering exceeds it.
