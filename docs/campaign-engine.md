# Campaign engine

`CampaignService` provides data-oriented campaign lookup, active-campaign resolution, create/update, publish/pause, and ordered button/activity/message retrieval. `ClaimService` coordinates eligibility and idempotent claim creation through a persistence port. `TrackingService` records provider-neutral events.

Campaign codes, reward values, button destinations, messages, activity count, dates, and availability belong to stored campaign data. Stable `buttonKey` and `activityKey` values identify actions; mutable destination URLs are not identities.

The current claim policy uses a unique `(user_id, campaign_id)` constraint. A future repeat-claim campaign type must define its rule and database key explicitly before relaxing that constraint. Campaign capacity checks serialize on the campaign row in PostgreSQL.

`OLE88_WELCOME_100` is only an idempotent draft seed. It has no configured external URLs, and changing or removing it does not change application logic.
