import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("039_RepairTaskWorkspaceTables", (it) => {
  it.effect("repairs task tables when earlier migration records outlive their schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* sql`DROP TABLE task_workspace_events`;
      yield* sql`DROP TABLE task_workspace_command_receipts`;
      yield* sql`DROP TABLE task_workspace_operation_receipts`;
      yield* sql`DROP TABLE task_workspace_completion_proposals`;
      yield* sql`DROP TABLE task_workspace_outbox`;
      yield* sql`DROP TABLE task_workspace_import_meta`;

      yield* runMigrations({ toMigrationInclusive: 39 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'task_workspace_%'
        ORDER BY name
      `;

      assert.deepStrictEqual(
        tables.map(({ name }) => name),
        [
          "task_workspace_command_receipts",
          "task_workspace_completion_proposals",
          "task_workspace_events",
          "task_workspace_import_meta",
          "task_workspace_operation_receipts",
          "task_workspace_outbox",
        ],
      );
    }),
  );
});
