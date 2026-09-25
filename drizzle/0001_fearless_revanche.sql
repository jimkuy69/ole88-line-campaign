CREATE TYPE "public"."outbound_status" AS ENUM('READY', 'SENDING', 'SENT', 'FAILED', 'UNCERTAIN');--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"recipient_line_user_id" varchar(255) NOT NULL,
	"reply_token" text,
	"messages" jsonb NOT NULL,
	"status" "outbound_status" DEFAULT 'READY' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(100),
	"line_request_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
DROP INDEX "webhook_events_status_received_idx";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "claim_policy" varchar(32) DEFAULT 'SINGLE_CLAIM' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "outbound_messages_status_created_idx" ON "outbound_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_status_received_idx" ON "webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_claim_policy_supported_ck" CHECK ("campaigns"."claim_policy" = 'SINGLE_CLAIM');