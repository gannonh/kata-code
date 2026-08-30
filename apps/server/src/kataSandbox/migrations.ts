import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const KATA_SANDBOX_MIGRATION_ID = "kata-sandbox/001-initial";
export const runKataSandboxMigrations = Effect.fn("kataSandbox.runMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS kata_schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `;

      const applied = yield* sql`
        SELECT id
        FROM kata_schema_migrations
        WHERE id = ${KATA_SANDBOX_MIGRATION_ID}
      `;
      if (applied.length > 0) return;

      yield* sql`
        CREATE TABLE IF NOT EXISTS kata_sandbox_profiles (
          profile_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          driver_kind TEXT NOT NULL,
          socket_path TEXT NOT NULL,
          image_digest TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS kata_sandbox_deployments (
          deployment_id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          revision INTEGER NOT NULL,
          intent_json TEXT,
          resource_json TEXT,
          profile_id TEXT,
          environment_id TEXT,
          endpoint TEXT,
          workspace_root TEXT,
          kata_home TEXT,
          identified_at TEXT,
          deleted_at TEXT
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS kata_sandbox_observations (
          deployment_id TEXT PRIMARY KEY REFERENCES kata_sandbox_deployments(deployment_id),
          observation_json TEXT NOT NULL
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS kata_sandbox_operation_receipts (
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
        CREATE INDEX IF NOT EXISTS kata_sandbox_deployments_state_idx
        ON kata_sandbox_deployments (state)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS kata_sandbox_operations_status_idx
        ON kata_sandbox_operation_receipts (status)
      `;

      yield* sql`
        INSERT INTO kata_schema_migrations (id, applied_at)
        VALUES (${KATA_SANDBOX_MIGRATION_ID}, CURRENT_TIMESTAMP)
      `;
    }),
  );
});
