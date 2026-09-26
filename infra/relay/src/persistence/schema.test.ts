// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api-postgres";

import * as relaySchema from "./schema.ts";
import {
  relayLinearOAuthStates,
  relayLinearOAuthTokens,
  relayManagedTunnelLimits,
  relayMobileDevices,
} from "./schema.ts";

const postgresMigrationsDir = new URL("../../migrations/postgres/", import.meta.url);

const reconciliationMigration = NodeFS.readFileSync(
  new URL("20260821120000_kata_connect_state_reconciliation/migration.sql", postgresMigrationsDir),
  "utf8",
);

const linearOAuthMigration = NodeFS.readFileSync(
  new URL("20260918165546_eager_shinobi_shaw/migration.sql", postgresMigrationsDir),
  "utf8",
);

const linearOAuthTokenKeysMigration = NodeFS.readFileSync(
  new URL("20260919144745_linear_oauth_token_keys/migration.sql", postgresMigrationsDir),
  "utf8",
);

const linearOAuthActiveStateMigration = NodeFS.readFileSync(
  new URL("20260920023350_linear_oauth_active_state/migration.sql", postgresMigrationsDir),
  "utf8",
);

const linearOAuthTokenEncryptionMigration = NodeFS.readFileSync(
  new URL("20260926004121_linear_oauth_token_encryption/migration.sql", postgresMigrationsDir),
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

  it("creates the Linear OAuth state and token tables in the latest migration", () => {
    expect("codeVerifier" in relayLinearOAuthStates).toBe(true);
    expect("consumedAt" in relayLinearOAuthStates).toBe(true);
    expect("stateHash" in relayLinearOAuthStates).toBe(true);
    expect(linearOAuthMigration).toContain('CREATE TABLE "relay_linear_oauth_states"');
    expect(linearOAuthMigration).toContain('"code_verifier" text NOT NULL');
    expect(linearOAuthMigration).toContain('"consumed_at" varchar(64)');
    expect(linearOAuthMigration).toContain('CREATE TABLE "relay_linear_oauth_tokens"');
    expect(linearOAuthMigration).toContain('"access_token" text NOT NULL');
    expect(linearOAuthMigration).toContain('"refresh_token" text NOT NULL');
  });

  it("stores Linear OAuth tokens only as ciphertext, dropping existing plaintext rows first", () => {
    expect("tokenCiphertext" in relayLinearOAuthTokens).toBe(true);
    expect("tokenNonce" in relayLinearOAuthTokens).toBe(true);
    expect("keyVersion" in relayLinearOAuthTokens).toBe(true);
    expect("accessToken" in relayLinearOAuthTokens).toBe(false);
    expect("refreshToken" in relayLinearOAuthTokens).toBe(false);

    const statements = linearOAuthTokenEncryptionMigration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim());
    expect(statements).toEqual([
      'DELETE FROM "relay_linear_oauth_tokens";',
      'ALTER TABLE "relay_linear_oauth_tokens" ADD COLUMN "token_ciphertext" text NOT NULL;',
      'ALTER TABLE "relay_linear_oauth_tokens" ADD COLUMN "token_nonce" varchar(16) NOT NULL;',
      'ALTER TABLE "relay_linear_oauth_tokens" ADD COLUMN "key_version" integer NOT NULL;',
      'ALTER TABLE "relay_linear_oauth_tokens" DROP COLUMN "access_token";',
      'ALTER TABLE "relay_linear_oauth_tokens" DROP COLUMN "refresh_token";',
    ]);
  });

  it("stores Linear OAuth expiries as epoch milliseconds, which overflow a 32-bit integer", () => {
    expect(relayLinearOAuthStates.expiresAt.getSQLType()).toBe("bigint");
    expect(relayLinearOAuthTokens.expiresAt.getSQLType()).toBe("bigint");
    for (const table of ["relay_linear_oauth_states", "relay_linear_oauth_tokens"]) {
      expect(linearOAuthTokenKeysMigration).toContain(
        `ALTER TABLE "${table}" ALTER COLUMN "expires_at" SET DATA TYPE bigint`,
      );
    }
  });

  it("keys Linear OAuth tokens by environment and connection", () => {
    expect(linearOAuthTokenKeysMigration).toContain(
      'ALTER TABLE "relay_linear_oauth_tokens" ADD PRIMARY KEY ("environment_id","connection_id")',
    );
  });

  it("allows only one active Linear OAuth state per connection", () => {
    expect(linearOAuthActiveStateMigration).toContain(
      'CREATE UNIQUE INDEX "idx_relay_linear_oauth_states_active_connection"',
    );
    expect(linearOAuthActiveStateMigration).toMatch(/WHERE "consumed_at" is null/iu);
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

describe("relay migration snapshot chain", () => {
  type Snapshot = Parameters<typeof generateMigration>[0];

  const snapshots = NodeFS.readdirSync(postgresMigrationsDir)
    .filter((name) => /^\d{14}_/.test(name))
    .map((dir) => ({ dir, path: new URL(`${dir}/snapshot.json`, postgresMigrationsDir) }))
    .filter(({ path }) => NodeFS.existsSync(path))
    .map(({ dir, path }) => ({
      dir,
      snapshot: JSON.parse(NodeFS.readFileSync(path, "utf8")) as Snapshot,
    }));
  const referenced = new Set(snapshots.flatMap(({ snapshot }) => snapshot.prevIds));
  const heads = snapshots.filter(({ snapshot }) => !referenced.has(snapshot.id));

  it("has exactly one snapshot head", () => {
    expect(heads.map(({ dir }) => dir)).toEqual(["20260926004121_linear_oauth_token_encryption"]);
  });

  it("includes both the Linear OAuth tables and managed endpoint recovery in the head", () => {
    const ddl = heads[0]?.snapshot.ddl ?? [];
    const tables = ddl.filter((entity) => entity.entityType === "tables").map(({ name }) => name);
    expect(tables).toContain("relay_linear_oauth_states");
    expect(tables).toContain("relay_linear_oauth_tokens");
    expect(
      ddl.some(
        (entity) =>
          entity.entityType === "columns" &&
          entity.table === "relay_managed_endpoint_allocations" &&
          entity.name === "recovery_enabled_at",
      ),
    ).toBe(true);
  });

  it("matches the schema source with no drift, as Alchemy's deploy check computes it", async () => {
    const head = heads[0]?.snapshot;
    expect(head).toBeDefined();
    if (head === undefined) return;
    const statements = await generateMigration(
      head,
      await generateDrizzleJson(relaySchema, head.id),
    );
    expect(statements).toEqual([]);
  });
});
