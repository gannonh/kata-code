import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Event-triggered routines keep a sentinel next_due_at so the NOT NULL column
  // is unchanged; the scheduler selects due work by trigger kind instead.
  yield* sql`ALTER TABLE routines ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'schedule'`;
  yield* sql`DROP INDEX routines_due`;
  yield* sql`CREATE INDEX routines_due ON routines(state, trigger_kind, next_due_at)`;
  yield* sql`CREATE TABLE routine_connections (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    status TEXT NOT NULL,
    record TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX routine_connections_environment ON routine_connections(environment_id, id)`;
  // A delivery id is unique per connection so provider redelivery is idempotent.
  // The signed-content digest is unique per connection inside a pruned window so
  // a replayed body under a fresh delivery header admits nothing new.
  yield* sql`CREATE TABLE routine_deliveries (
    connection_id TEXT NOT NULL REFERENCES routine_connections(id),
    delivery_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    status TEXT NOT NULL,
    run_id TEXT,
    received_at INTEGER NOT NULL,
    record TEXT NOT NULL,
    PRIMARY KEY(connection_id, delivery_id)
  )`;
  yield* sql`CREATE UNIQUE INDEX routine_deliveries_digest ON routine_deliveries(connection_id, digest)`;
  yield* sql`CREATE INDEX routine_deliveries_received ON routine_deliveries(connection_id, received_at)`;
});
