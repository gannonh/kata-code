// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import { describe, expect, it } from "@effect/vitest";

import { relayManagedTunnelLimits, relayMobileDevices } from "./schema.ts";

const postgresMigrationsDir = new URL("../../migrations/postgres/", import.meta.url);

const reconciliationMigration = NodeFS.readFileSync(
  new URL("20260821120000_kata_connect_state_reconciliation/migration.sql", postgresMigrationsDir),
  "utf8",
);

const productionAppliedArchiveMigrations = [
  {
    file: "20260712150134_environment_link_leases/migration.sql",
    sha256: "a931b2dd7588ed9e6fd024cbe55d43c3f62de0aa3a1082451db445e8de696ca7",
    fragment: 'ADD COLUMN "lease_expires_at"',
  },
  {
    file: "20260712194752_workable_synch/migration.sql",
    sha256: "cd6623b265654b858e40e14e9a15c6fed82a3ece98fe6992c674b6623ed15386",
    fragment: 'ADD COLUMN "cleanup_claimed_at"',
  },
  {
    file: "20260712202051_little_luckman/migration.sql",
    sha256: "226421456d179dfd97b0486d5055c6508f83f0005e5de2bed64ef47a9540e6f3",
    fragment: 'ADD COLUMN "cleanup_attempt_token"',
  },
  {
    file: "20260712203311_managed_endpoint_allocation_identity/migration.sql",
    sha256: "87f2be9c4f1c001a9e69e7d45bdb069a79d7472423c9401d74aad31f34acf7df",
    fragment: 'ADD COLUMN "managed_endpoint_allocation_id"',
  },
] as const;

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

  it("keeps the production-applied archive migrations Alchemy already recorded", () => {
    const localDirs = new Set(
      NodeFS.readdirSync(postgresMigrationsDir).filter((name) => /^\d{14}_/.test(name)),
    );
    const unmatched = productionAppliedArchiveMigrations
      .map((migration) => migration.file)
      .filter((file) => !localDirs.has(file.replace(/\/migration\.sql$/, "")));
    expect(unmatched).toEqual([]);

    for (const migration of productionAppliedArchiveMigrations) {
      const sql = NodeFS.readFileSync(new URL(migration.file, postgresMigrationsDir), "utf8");
      expect(NodeCrypto.createHash("sha256").update(sql).digest("hex")).toBe(migration.sha256);
      expect(sql).toContain(migration.fragment);
    }
  });
});
