# Staging installation and end-to-end test plan

This guide is for an isolated **test-only** deployment. It is not a production deployment procedure. Use a dedicated test LINE Official Account, test users, a separate PostgreSQL database, and test campaign content. Never point this environment at production data or an OA used by customers.

## Staging prerequisites

| Item | Owner setup |
|---|---|
| Host and HTTPS | A staging hostname with DNS and a TLS-terminating reverse proxy. The public URL must be reachable by LINE over HTTPS. Configure `PUBLIC_BASE_URL` to the exact origin only, for example `https://staging.example.test` (no path or trailing application route). Configure the LINE webhook endpoint as `https://staging.example.test/webhooks/line`. |
| PostgreSQL | A dedicated PostgreSQL database and least-privilege application role, separate from every production/shared database. Make an initial backup and prove restore into a separate disposable database. |
| LINE OA | A dedicated test LINE Official Account / Messaging API channel, with a designated test user. Enable its webhook and configure the staging URL in LINE Developers Console. Do not use a customer-facing OA. |
| Secrets | Supply `DATABASE_URL`, `LINE_CHANNEL_SECRET`, and `LINE_CHANNEL_ACCESS_TOKEN` through the staging host's secret manager/environment injection. Never paste values into chat, commit them, put them in workflow YAML, or include them in logs. |
| Evidence storage | Mount a persistent private filesystem volume at `EVIDENCE_STORAGE_DIR` (default `work/evidence`), outside the static web root, writable only by the app account. The application creates private directories/files. Back up this volume under the same access controls as the database. Production object storage is not implemented. |
| Admin | Create the first Admin through an interactive terminal with `npm run admin:create`; do not use a default password. Provision the passphrase directly to the intended administrator using the organization's secret-sharing method. |

The current evidence adapter is local private filesystem storage, suitable for development and controlled staging only. Keep it on persistent storage and restrict host access. Do not expose its directory through a reverse proxy or static file server.

## Install and prepare the staging instance

1. Deploy this repository to the staging host using the team's normal reviewed release process. Do not run deployment commands against production as part of this plan.
2. Inject the database URL, test channel secret/access token, `PUBLIC_BASE_URL`, and evidence storage path from the staging secret/configuration manager.
3. Run `npm ci`, then `npm run db:migrate` against the dedicated staging database. Verify the migration output and take a database backup.
4. Run `npm run admin:create` in an interactive terminal and create the designated staging administrator.
5. Start the application using the staging service manager and confirm `GET /health` returns `{"status":"ok"}` over the staging host.
6. In LINE Developers Console for the **test** channel, set webhook URL to `https://<staging-host>/webhooks/line`, enable webhook delivery, and use its verification function. Check that a valid event is accepted and that an invalid signature is rejected. Never use a real customer channel.
7. Sign into `/admin`. Create or duplicate a **test-only** campaign from a template. Use only destinations and artwork controlled for testing. Confirm messages, button IDs, activities, dates, limits, reward labels, and evidence outcome copy. Publish only in staging, then verify the UI marks it active. This guide does not create or publish the campaign for you.

The public `PUBLIC_BASE_URL` is used for Admin Origin/CSRF checks behind a TLS-terminating proxy. Do not make the app trust arbitrary forwarded host/protocol headers. Production-mode configuration requires an HTTPS origin.

## End-to-end administrator test

Use a designated test LINE account and a test campaign that has passed Publish validation. A test campaign must have an HTTPS hero image reachable by LINE, a configured `BTN_CLAIM` postback, enabled activity buttons, and the required campaign messages. Current evidence intake accepts JPEG and PNG up to 10 MiB.

1. **Follow:** Remove the test account as a friend if necessary, then add/follow the test OA. Expected in LINE: configured welcome text and campaign card, including the claim button. In Admin: a welcome outbox row appears as `SENT` when delivery succeeds; follow tracking is recorded once per provider event.
2. **Claim:** Tap the campaign's claim button. Expected in LINE: the configured claim response and activity card for the test campaign. Tap an activity's “send proof” action. Expected in LINE: an upload prompt for the selected activity.
3. **Submit evidence:** Send one test JPEG or PNG image smaller than 10 MiB. Expected in LINE: receipt/waiting-for-review copy configured for the campaign. In Admin: the item appears in Review Queue with the correct campaign, claim and activity and a protected image preview. Sending an image without selecting an activity should ask the user to choose; it must not attach to a guessed/latest claim.
4. **Reject and resubmit:** Reject the test evidence with a reason. Expected in LINE: configured rejection copy with that reason. Ask the test user to choose the same activity and submit a replacement image; Admin should see the replacement in the correct activity.
5. **Approve:** Approve the replacement. Expected in LINE: configured approval/status message sent through the push outbox. In Admin: review status and audit record show the actor, timestamp, previous/new state and decision. When multiple required activities exist, the claim must not be approved until all are approved. Approval does not send a reward.
6. **Operational check:** In Dashboard, verify the selected date range, counts, delivery statuses and issue queues. Webhook backlog is global because webhook events do not have reliable campaign attribution; the page labels this scope explicitly even when a campaign is selected.
7. **Retry safety:** For an outbound result marked `UNCERTAIN`, inspect the LINE provider/account logs before any manual action. The application intentionally does not automatically resend uncertain sends. Never replay a one-time reply token.

Record the test date, app commit, campaign code, test account reference (in the organization's controlled test log only), and observed pass/fail results. Do not put LINE user IDs, image data, secrets, or raw webhook payloads in issue reports.

## Stop and rollback

If any step produces an unexpected message, wrong campaign/activity association, exposed evidence, or repeated delivery:

1. Pause the staging test campaign in Admin to stop new claims.
2. Disable webhook delivery for the **test** OA in LINE Developers Console and/or stop the staging worker/application. Do not alter a production OA.
3. Preserve database, application, and private evidence-storage logs/files needed to investigate; do not manually replay `UNCERTAIN`/`SENDING` outbox rows or delete evidence files.
4. Roll back only the staging application release. If a database restore is needed, restore a known backup into a separate staging database first; verify it before changing the staging connection string. Do not restore staging data over production.
5. Revoke/rotate the test-channel credentials in the secret manager if they may have been exposed. Never send the old or replacement secret in chat.
6. Keep the test campaign paused and the test webhook disabled until the issue is understood and the end-to-end test is repeated successfully.

## Backup and restore rehearsal

Back up PostgreSQL using the organization's supported PostgreSQL backup method and separately back up the private evidence volume. The database contains references to stored evidence; restoring only one side can leave missing media. Restore both into an isolated staging recovery target, apply no production traffic, verify migrations and Admin read access to a known test evidence item, then document the recovery time and any mismatch. Establish retention and encrypted off-host storage for backups before considering production use.

## Owner-provided staging setup still required

- Staging hostname/DNS/TLS proxy and an HTTPS endpoint reachable by LINE.
- Dedicated staging PostgreSQL database, application role, backup destination, and restore rehearsal target.
- Dedicated test LINE OA/channel and authorized test user.
- Secret-manager entries for the database and test LINE credentials (do not send their values in chat).
- Persistent private evidence volume and designated first Admin.
- A test-only campaign configuration/artwork/destinations prepared in Admin after staging is installed.
