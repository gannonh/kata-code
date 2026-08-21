// @effect-diagnostics nodeBuiltinImport:off - The test reads the checked-in migration text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";

import {
  relayManagedEndpointAllocations,
  relayManagedTunnelLimits,
  relayMobileDevices,
} from "./schema.ts";

const reconciliationMigration = readFileSync(
  new URL(
    "../../migrations/postgres/20260821120000_kata_connect_state_reconciliation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("relay persisted schema reconciliation", () => {
  it("keeps current APNs and managed tunnel columns in the schema source", () => {
    expect("bundleId" in relayMobileDevices).toBe(true);
    expect("apsEnvironment" in relayMobileDevices).toBe(true);
    expect("maxTunnels" in relayManagedTunnelLimits).toBe(true);
  });

  it("reconciles archive-shaped state idempotently without row replacement", () => {
    expect(reconciliationMigration).toContain(`SET "endpoint_provider_kind" = 'kata_relay'`);
    expect(reconciliationMigration).toContain('DROP COLUMN IF EXISTS "lease_expires_at"');
    expect(reconciliationMigration).toContain(
      'DROP COLUMN IF EXISTS "managed_endpoint_allocation_id"',
    );
    expect(reconciliationMigration).toContain('DROP COLUMN IF EXISTS "allocation_id"');
    expect(reconciliationMigration).toContain('ADD COLUMN IF NOT EXISTS "bundle_id" varchar(255)');
    expect(reconciliationMigration).toContain(
      'ADD COLUMN IF NOT EXISTS "aps_environment" varchar(16)',
    );
    expect(reconciliationMigration).toContain(
      'CREATE TABLE IF NOT EXISTS "relay_managed_tunnel_limits"',
    );
    expect(reconciliationMigration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/iu);
  });
});
