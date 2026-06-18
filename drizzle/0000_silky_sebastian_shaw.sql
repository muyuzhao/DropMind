CREATE TYPE "public"."item_status" AS ENUM('processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) DEFAULT 'local-user' NOT NULL,
	"raw_content" text NOT NULL,
	"status" "item_status" DEFAULT 'ready' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
