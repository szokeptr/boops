CREATE TABLE "relay_environment_invites" (
	"environment_id" varchar(191),
	"member_id" varchar(191),
	"environment_public_key" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"member_label" text NOT NULL,
	"environment_label" text NOT NULL,
	"created_at" varchar(64) NOT NULL,
	"updated_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_environment_invites_pkey" PRIMARY KEY("environment_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "relay_environment_links" ADD COLUMN "role" varchar(16) DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_environment_links" ADD COLUMN "member_id" varchar(191);--> statement-breakpoint
ALTER TABLE "relay_environment_links" ADD COLUMN "shared_by_user_id" varchar(191);--> statement-breakpoint
CREATE INDEX "idx_relay_environment_invites_email" ON "relay_environment_invites" ("email");