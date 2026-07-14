ALTER TABLE "relay_environment_links" ADD COLUMN "lease_expires_at" varchar(64);--> statement-breakpoint
UPDATE "relay_environment_links"
SET "lease_expires_at" = to_char(
  (CURRENT_TIMESTAMP + INTERVAL '15 minutes') AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
);--> statement-breakpoint
ALTER TABLE "relay_environment_links" ALTER COLUMN "lease_expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_relay_environment_links_lease" ON "relay_environment_links" ("lease_expires_at","revoked_at");
