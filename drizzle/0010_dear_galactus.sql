CREATE INDEX "claims_claimed_at_idx" ON "claims" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "evidence_created_at_idx" ON "evidence" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "evidence_status_reviewed_at_idx" ON "evidence" USING btree ("status","reviewed_at");--> statement-breakpoint
CREATE INDEX "outbound_campaign_purpose_sent_idx" ON "outbound_messages" USING btree ("campaign_id","purpose","status","sent_at");--> statement-breakpoint
CREATE INDEX "tracking_created_at_idx" ON "tracking_events" USING btree ("created_at");