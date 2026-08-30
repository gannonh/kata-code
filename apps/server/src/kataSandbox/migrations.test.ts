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
