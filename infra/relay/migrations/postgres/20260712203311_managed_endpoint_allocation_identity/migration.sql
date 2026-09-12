ALTER TABLE "relay_environment_links" ADD COLUMN "managed_endpoint_allocation_id" varchar(64);--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations" ADD COLUMN "allocation_id" varchar(64);--> statement-breakpoint
UPDATE "relay_managed_endpoint_allocations"
SET "allocation_id" = md5("user_id" || ':' || "environment_id" || ':' || "created_at")
WHERE "allocation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "relay_managed_endpoint_allocations" ALTER COLUMN "allocation_id" SET NOT NULL;--> statement-breakpoint
UPDATE "relay_environment_links" AS links
SET "managed_endpoint_allocation_id" = allocations."allocation_id"
FROM "relay_managed_endpoint_allocations" AS allocations
WHERE links."user_id" = allocations."user_id"
  AND links."environment_id" = allocations."environment_id"
  AND links."revoked_at" IS NULL;
