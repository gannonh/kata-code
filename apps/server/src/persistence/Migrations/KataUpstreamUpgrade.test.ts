import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@kata-sh/code-shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("Kata upstream upgrade", (it) => {
  it.effect("runs every incoming migration after the shipped Kata repairs exactly once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 42 });

      const executed = yield* runMigrations();
      assert.deepEqual(
        executed.map(([id]) => id),
        [43, 44, 45, 46, 47, 48, 49, 50, 51, 52],
      );

      const authColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
      assert.ok(authColumns.some(({ name }) => name === "client_surface"));
      assert.ok(authColumns.some(({ name }) => name === "client_app_version"));
      const threadColumns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(projection_threads)`;
      assert.ok(threadColumns.some(({ name }) => name === "linked_pull_request_json"));
      assert.deepEqual(yield* runMigrations(), []);
    }),
  );
});
