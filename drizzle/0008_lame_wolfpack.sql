ALTER TABLE "outbound_messages" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "purpose" varchar(32);--> statement-breakpoint
ALTER TABLE "tracking_events" ADD COLUMN "source_event_id" varchar(128);--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_campaign_purpose_status_idx" ON "outbound_messages" USING btree ("campaign_id","purpose","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_source_event_uq" ON "tracking_events" USING btree ("source_event_id") WHERE "tracking_events"."source_event_id" IS NOT NULL;