import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_RepairProjectionProjectsDefaultThreadEnvMode", (it) => {
  it.effect("repairs databases with a conflicting migration 039 history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (39, 'RepairTaskWorkspaceTables'), (40, 'ProjectionProjectFaviconPath')
      `;
      yield* runMigrations({ toMigrationInclusive: 41 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(columns.some((column) => column.name === "default_thread_env_mode"));
    }),
  );
});
