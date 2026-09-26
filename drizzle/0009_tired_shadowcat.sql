CREATE INDEX "claims_campaign_claimed_at_idx" ON "claims" USING btree ("campaign_id","claimed_at");--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_status_lease_idx" ON "webhook_events" USING btree ("status","lease_until");