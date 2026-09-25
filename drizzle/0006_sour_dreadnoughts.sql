CREATE TABLE "evidence_upload_contexts" (
	"channel_identity_id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_activity_id" uuid NOT NULL,
	"requested_event_id" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "claim_activity_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "channel_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivery_type" varchar(16) DEFAULT 'REPLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_upload_contexts" ADD CONSTRAINT "evidence_upload_contexts_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_upload_contexts" ADD CONSTRAINT "evidence_upload_contexts_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_upload_contexts" ADD CONSTRAINT "evidence_upload_contexts_claim_activity_id_claim_activities_id_fk" FOREIGN KEY ("claim_activity_id") REFERENCES "public"."claim_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_upload_contexts_expiry_idx" ON "evidence_upload_contexts" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_claim_activity_id_claim_activities_id_fk" FOREIGN KEY ("claim_activity_id") REFERENCES "public"."claim_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_status_created_idx" ON "evidence" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_source_message_uq" ON "evidence" USING btree ("source_message_id") WHERE "source_message_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_activities" ADD CONSTRAINT "claim_activities_status_ck" CHECK ("claim_activities"."status" IN ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'));--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_status_ck" CHECK ("evidence"."status" IN ('SUBMITTED', 'APPROVED', 'REJECTED'));--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_delivery_type_ck" CHECK ("outbound_messages"."delivery_type" IN ('REPLY', 'PUSH'));
