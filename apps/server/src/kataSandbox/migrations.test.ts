// @effect-diagnostics preferSchemaOverJson:off - migration tests inspect JSON columns.

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { KATA_SANDBOX_MIGRATION_ID, runKataSandboxMigrations } from "./migrations.ts";

it.effect("applies the sandbox namespace idempotently beside upstream migrations", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const before = yield* sql<{
      readonly migrationId: number;
      readonly name: string;
    }>`
      SELECT migration_id AS "migrationId", name
      FROM effect_sql_migrations
      ORDER BY migration_id DESC
      LIMIT 1
    `;

    yield* runKataSandboxMigrations();
    yield* runKataSandboxMigrations();

    const sandboxRows = yield* sql<{
      readonly id: string;
    }>`
      SELECT id
      FROM kata_schema_migrations
    `;
    const after = yield* sql<{
      readonly migrationId: number;
      readonly name: string;
    }>`
      SELECT migration_id AS "migrationId", name
      FROM effect_sql_migrations
      ORDER BY migration_id DESC
      LIMIT 1
    `;

    assert.deepEqual(sandboxRows, [{ id: KATA_SANDBOX_MIGRATION_ID }]);
    assert.deepEqual(after, before);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect("migrates in-flight profile inputs to immutable image selections", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const imageDigest = `sha256:${"a".repeat(64)}`;
    yield* sql`DROP TABLE IF EXISTS kata_sandbox_operation_receipts`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS kata_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `;
    yield* sql`DELETE FROM kata_schema_migrations WHERE id = ${KATA_SANDBOX_MIGRATION_ID}`;
    const profileInput = JSON.stringify({
      profileId: "profile-1",
      name: "Local Docker",
      driverKind: "docker",
      socketPath: "/var/run/docker.sock",
      imageDigest,
      enabled: true,
    });

    yield* sql`
      CREATE TABLE IF NOT EXISTS kata_schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)
    `;
    yield* sql`
      INSERT INTO kata_schema_migrations (id, applied_at)
      VALUES (${KATA_SANDBOX_MIGRATION_ID}, CURRENT_TIMESTAMP)
    `;
    yield* sql`
      CREATE TABLE kata_sandbox_operation_receipts (
        operation_id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        request_id TEXT NOT NULL,
        command TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        deployment_id TEXT,
        profile_id TEXT,
        profile_input_json TEXT,
        result_json TEXT,
        error TEXT,
        accepted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (actor, request_id)
      )
    `;
    yield* sql`
      INSERT INTO kata_sandbox_operation_receipts (
        operation_id, actor, request_id, command, payload_hash, status,
        profile_id, profile_input_json, accepted_at, updated_at
      ) VALUES (
        'operation-1', 'actor', 'request-1', 'profile-upsert', 'hash', 'Accepted',
        'profile-1', ${profileInput}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    yield* runKataSandboxMigrations();

    const rows = yield* sql<{
      readonly profileInputJson: string;
      readonly resolvedImageDigest: string;
    }>`
      SELECT
        profile_input_json AS "profileInputJson",
        resolved_image_digest AS "resolvedImageDigest"
      FROM kata_sandbox_operation_receipts
    `;
    const migrated = JSON.parse(rows[0]!.profileInputJson) as Record<string, unknown>;
    assert.deepEqual(migrated.image, { kind: "custom", digest: imageDigest });
    assert.isUndefined(migrated.imageDigest);
    assert.equal(rows[0]!.resolvedImageDigest, imageDigest);
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
