DROP INDEX IF EXISTS "idx_relay_environment_links_lease";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_relay_mobile_devices_user";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_relay_live_activities_user";
--> statement-breakpoint
UPDATE "relay_environment_links"
SET "endpoint_provider_kind" = 'kata_relay'
WHERE "endpoint_provider_kind" = 't3_relay';
--> statement-breakpoint
ALTER TABLE "relay_environment_links"
  DROP COLUMN IF EXISTS "lease_expires_at",
  DROP COLUMN IF EXISTS "cleanup_claimed_at",
  DROP COLUMN IF EXISTS "cleanup_attempt_token",
  DROP COLUMN IF EXISTS "cleanup_attempt_expires_at",
  DROP COLUMN IF EXISTS "managed_endpoint_allocation_id";
--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations"
  DROP COLUMN IF EXISTS "allocation_id";
--> statement-breakpoint
ALTER TABLE "relay_mobile_devices"
  ADD COLUMN IF NOT EXISTS "bundle_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "aps_environment" varchar(16);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relay_managed_tunnel_limits" (
  "user_id" varchar(191) PRIMARY KEY,
  "max_tunnels" integer NOT NULL,
  "created_at" varchar(64) NOT NULL,
  "updated_at" varchar(64) NOT NULL
);
