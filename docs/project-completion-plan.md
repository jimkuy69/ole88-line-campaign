# OLE88 Admin staging completion plan

**Scope:** finish an isolated Admin staging deployment for the codebase whose baseline is commit `61b56699bdccf443cbc51ea6b539aa7fc1ceeac1`. This is not production readiness, a live LINE test, or authorization to publish a campaign.

**Safety constraints:** no LINE credentials or OA connection; no LINE network requests; no campaign publishing on staging; no rewards; no customer data. Use only clearly labeled synthetic fixtures. The staging application binds to loopback and is reached through an SSH local forward. Do not expose PostgreSQL or the app port to the public internet.

## Completion tracks

| Track | Required result | Evidence |
|---|---|---|
| Code | `/health` and bounded `/ready`; `ADMIN_ONLY` blocks webhook processing, delivery, and publishing; worker cycles do not overlap and shut down with a bound; LINE sends time out conservatively; Review dates and campaign attribution are correct; UI errors/session expiry are actionable | Reviewed diff, regression tests, typecheck/build |
| Automated tests | Fresh migrations and repeat migration check on disposable `ole88_test`; unit + integration tests all pass with **zero skipped**; static checks and Admin JS syntax pass | Commands and output in the verification report |
| VPS staging | Inspect owner/sudo/SSH socket/storage/package state first; install/update only after host facts are known; local-only PostgreSQL with separate least-privilege roles/databases; reviewed commit deployed as an immutable release; restricted config and evidence paths; systemd restart on boot | Host and release facts in the verification report |
| Admin acceptance | Login/logout, template, draft save/reload, duplicate, preview, stale-version conflict, Review approve/reject, protected media, Dashboard filters, desktop/mobile; no ACTIVE campaign and ADMIN_ONLY visible | Browser observations recorded separately from automated tests |
| Operations | Health/readiness/log checks, reboot recovery, coordinated database+evidence backup, restore into `ole88_restore_test` and separate evidence path, rollback instructions | Restore and reboot observations; backup retention inventory |
| External prerequisites | Domain/TLS, production storage, LINE OA verification, messaging credentials and reward workflow remain future work | Explicitly not a staging blocker and not claimed complete |

## Repository work

1. Preserve the historical Phase 1–5 evidence in `TASK_QUEUE.md`; append closeout status rather than rewriting prior test totals.
2. Compare application behavior with docs/tests, fix reproducible defects surgically, and add regression coverage. Do not rewrite already-applied migrations; any justified schema change gets a new reviewed migration.
3. Keep the staging safety flag opt-in and report its effective state in Admin. Verify it is enabled in staging and there is no ACTIVE campaign before sign-off.
4. Run targeted tests during implementation. Before sign-off, validate all unit and PostgreSQL integration tests using a verified disposable local test database; stop rather than run destructive integration setup against an unknown or shared database.

## VPS preparation and release

Before changing the host, collect read-only facts for the `ole88admin` account, allowed sudo scope, SSH connectivity, OS/release, free disk, package sources/security status, current PostgreSQL/service state, and the July 14 incident logs. Do not modify SSH keys or access policy. Use no sudo password in chat; prepare narrowly scoped root commands for the owner to run interactively after reviewing the host facts.

Once inspected, prepare installation and update steps for the host's actual OS. Configure PostgreSQL to listen only on local interfaces. Create `ole88_staging`, `ole88_test`, and `ole88_restore_test`, with separate roles and no superuser grants; staging credentials must not connect to either test database. Run migrations only on the intended target. Create the first Admin with the interactive bootstrap so the owner supplies the username/password directly.

Deploy an exact, tested commit under `/opt/ole88-staging/releases/<commit>/`, run as `ole88-staging`, with a systemd unit named `ole88-staging`. Keep environment in `/etc/ole88-staging/` with restrictive ownership/mode and evidence in `/var/lib/ole88-staging/evidence` outside the web root. For the initial no-domain stage use `NODE_ENV=development`, `ADMIN_ONLY=true`, `HOST=127.0.0.1`, `PORT=3000`, and `PUBLIC_BASE_URL=http://127.0.0.1:3000`. Do not configure LINE values. Reach the Admin via:

```powershell
ssh -N -L 127.0.0.1:3000:127.0.0.1:3000 ole88-staging
```

Then open `http://127.0.0.1:3000/admin`. Do not open the app or database port externally.

## Staging acceptance and recovery

Use fixture labels such as `SYNTHETIC_STAGING_*`; do not use real LINE identifiers/images. Verify that Admin operations can be exercised while publish and LINE processing are blocked. No mock or browser action may make a LINE network call.

Create paired PostgreSQL and evidence backups while the staging service is stopped. Keep seven private daily sets. Restore both to the separate restore database and evidence directory; verify migrations, fixture campaign, and protected image access with the worker disabled. Keep the previous immutable release for application rollback. Do not reverse migrations or overwrite a live database to roll back.

Check systemd status, health/readiness, and logs before and after restart/reboot. Record the July 14 log's original timestamp and timezone, plus only necessary original message text. Keep the observed systemd stop attributed to `gil-u26` separate from any assertion about an authenticated login. Ask Kamatera which system/user initiated the stop and whether Console/API/maintenance audit logs are available; record the response only if received.

## Acceptance rule

Closeout requires a working Admin login on the VPS, permitted workflow acceptance, no skipped automated tests, successful reboot recovery, successful paired restore rehearsal, restricted network binding, an exact deployed commit, and documented start/stop/check/rollback operations. Until each item has evidence, the result is **in progress**, not passed.
