import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The lease owner is a durable SQLite fence. A restarted runtime claims the
 * singleton generation; every lease mutation must prove that its in-memory
 * generation still owns this row before it can write.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_invocation_lease_owner (
      owner_id INTEGER PRIMARY KEY CHECK (owner_id = 1),
      owner_generation TEXT NOT NULL,
      claimed_at TEXT NOT NULL
    )
  `;
});
