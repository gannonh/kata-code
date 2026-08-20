import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_RepairProjectionSchemaMigrationIdCollision", (it) => {
  it.effect("repairs databases with conflicting migration history", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (33, 'TaskWorkspaceEvents'),
          (34, 'TaskWorkspaceCommandReceipts'),
          (35, 'TaskWorkspaceOperationReceipts'),
          (36, 'TaskWorkspaceCompletionProposals'),
          (37, 'TaskWorkspaceOutbox'),
          (38, 'TaskWorkspaceImportMeta'),
          (39, 'RepairTaskWorkspaceTables'),
          (40, 'ProjectionProjectFaviconPath')
      `;
      yield* runMigrations({ toMigrationInclusive: 41 });

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const threadNames = new Set(threadColumns.map((column) => column.name));
      for (const name of [
        "settled_override",
        "settled_at",
        "snoozed_until",
        "snoozed_at",
        "title_regeneration_request_id",
        "title_regeneration_started_at",
        "pinned_at",
        "pin_order_key",
      ]) {
        assert.ok(threadNames.has(name));
      }

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      const projectNames = new Set(projectColumns.map((column) => column.name));
      assert.ok(projectNames.has("default_thread_env_mode"));
      assert.ok(projectNames.has("favicon_path"));

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_projection_turns_thread_keyset'
      `;
      assert.equal(indexes.length, 1);
    }),
  );
});
