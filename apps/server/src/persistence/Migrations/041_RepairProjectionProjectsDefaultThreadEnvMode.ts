import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Migration ID 039 was previously used by a different schema history, so some
// existing databases have recorded it without this column.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!columns.some((column) => column.name === "default_thread_env_mode")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN default_thread_env_mode TEXT
    `;
  }
});
