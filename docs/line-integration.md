# LINE integration and customer flow

## Webhook intake

The endpoint verifies `x-line-signature` against the exact raw request bytes before parsing. It stores provider event IDs in `webhook_events` with a unique `(channel, provider_event_id)` key, then returns accepted/duplicate counts. The processor claims ready inbox events with `FOR UPDATE SKIP LOCKED` and a persisted 45-second lease, records retry timing in PostgreSQL, and marks repeated deterministic failures `FAILED` after five attempts. Expired inbox leases are recovered from DB state, so multiple workers do not rely on process-local locks for correctness. Follow/postback side effects use provider event IDs as dedupe keys; claims and LINE identities also have database uniqueness protections.

## Phase 2 handlers

- `follow`: select an active campaign, then reply with its `WELCOME_MESSAGE` and a Flex campaign card built from that campaign's title, subtitle, hero image, and enabled button rows. Its `BTN_CLAIM` action must match the exact campaign-specific postback format checked by the handler. If no active campaign exists, the event is acknowledged without creating a user or sending a message.
- Claim postback: validate the configured campaign-specific `BTN_CLAIM` postback, return/create the existing single claim through `ClaimService`, then send the configured claim response and a dynamic Flex activity card.
- Unknown event types and unrelated postbacks are acknowledged without a reply.

Campaign codes, message copy, activities, buttons, and actions are data-driven. `OLE88_WELCOME_100` exists only as draft seed data and is not referenced by the flow logic.

## Outbound delivery and retry safety

Each reply is recorded in `outbound_messages` with a unique provider-event dedupe key and statuses `READY`, `SENDING`, `SENT`, `FAILED`, or `UNCERTAIN`. The sender changes READY to SENDING with a database compare-and-set before the network call. Reply and push HTTP requests have a 15-second abort timeout. Successful responses become SENT. Definitive 4xx responses become FAILED. Timeouts, other network errors, 5xx responses, and a crash after SENDING become UNCERTAIN, clear the single-use reply token, and are never retried automatically. A crash with no outbound row resumes event processing; a persisted READY row is sent from its stored payload after restart; SENDING is never sent again. The processor logs only an error name on cycle failure and never logs tokens.

This conservative behavior is necessary because LINE reply tokens can only be used once and reply requests do not support `X-Line-Retry-Key`. LINE supports retry keys for selected push/broadcast-style APIs, but that capability is not used by this reply-based Phase 2 flow. A new user action produces a new event and reply token. Do not replay `UNCERTAIN` or stale `SENDING` rows automatically.

Activity card content is built from enabled campaign activities. Publish validation requires real HTTPS destinations for URI actions, including a configured hero image, and complete action/message configuration; seed links stay empty and the example campaign remains a draft. Active campaign and child-content mutations are serialized by parent-row locks and database triggers; pause to create an editable draft.

The rendered welcome uses two message objects (welcome text + one campaign bubble). The reply API accepts at most five message objects. The Flex alt text stays under 1,500 characters and bubble JSON is checked against LINE's 30 KB limit. A single bubble is used, so carousel limits do not apply.

The server runs at most one processor cycle at a time and waits up to five seconds for an active cycle during graceful shutdown. `ADMIN_ONLY=true` disables the cycle entirely and rejects webhook intake and Admin publish requests.

## Official references (checked 2026-09-26)

- [Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Receive webhook events and redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [Retry API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/)
- [Flex Message elements](https://developers.line.biz/en/docs/messaging-api/flex-message-elements/)
- [Reply message endpoint limits and reply token lifetime](https://developers.line.biz/en/reference/messaging-api/nojs/)

Never log channel secrets, access tokens, raw webhook payloads, or user message content. Set secrets as environment variables or a deployment secret store; never commit them.
