import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_import_meta (
      id TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL,
      imported_environment_id TEXT NOT NULL,
      event_count INTEGER NOT NULL
    )
  `;
});
