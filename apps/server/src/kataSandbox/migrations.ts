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
          connector_origin_json TEXT,
          attachment TEXT,
          identified_at TEXT,
          deleted_at TEXT
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS kata_sandbox_observations (
          deployment_id TEXT PRIMARY KEY REFERENCES kata_sandbox_deployments(deployment_id),
          observation_json TEXT NOT NULL,
          deployment_revision INTEGER NOT NULL DEFAULT 0
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
          attachment TEXT,
          expected_revision INTEGER,
          execution_token TEXT,
          claimed_at TEXT,
          result_json TEXT,
          error TEXT,
          accepted_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (actor, request_id)
        )
      `;

      const deploymentColumns = yield* sql`
        PRAGMA table_info(kata_sandbox_deployments)
      `;
      const deploymentColumnNames = new Set(deploymentColumns.map((column) => String(column.name)));
      if (!deploymentColumnNames.has("connector_origin_json")) {
        yield* sql`ALTER TABLE kata_sandbox_deployments ADD COLUMN connector_origin_json TEXT`;
      }
      if (!deploymentColumnNames.has("attachment")) {
        yield* sql`ALTER TABLE kata_sandbox_deployments ADD COLUMN attachment TEXT`;
      }

      const observationColumns = yield* sql`
        PRAGMA table_info(kata_sandbox_observations)
      `;
      if (!observationColumns.some((column) => String(column.name) === "deployment_revision")) {
        yield* sql`ALTER TABLE kata_sandbox_observations ADD COLUMN deployment_revision INTEGER NOT NULL DEFAULT 0`;
      }

      const operationColumns = yield* sql`
        PRAGMA table_info(kata_sandbox_operation_receipts)
      `;
      if (!operationColumns.some((column) => String(column.name) === "attachment")) {
        yield* sql`ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN attachment TEXT`;
      }
      if (!operationColumns.some((column) => String(column.name) === "expected_revision")) {
        yield* sql`ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN expected_revision INTEGER`;
      }
      if (!operationColumns.some((column) => String(column.name) === "execution_token")) {
        yield* sql`ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN execution_token TEXT`;
      }
      if (!operationColumns.some((column) => String(column.name) === "claimed_at")) {
        yield* sql`ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN claimed_at TEXT`;
      }

      yield* sql`
        CREATE INDEX IF NOT EXISTS kata_sandbox_deployments_state_idx
        ON kata_sandbox_deployments (state)
      `;

      yield* sql`
        CREATE INDEX IF NOT EXISTS kata_sandbox_operations_status_idx
        ON kata_sandbox_operation_receipts (status)
      `;

      if (applied.length === 0) {
        yield* sql`
          INSERT INTO kata_schema_migrations (id, applied_at)
          VALUES (${KATA_SANDBOX_MIGRATION_ID}, CURRENT_TIMESTAMP)
        `;
      }
    }),
  );
});
