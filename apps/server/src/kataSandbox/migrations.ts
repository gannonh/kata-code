import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const KATA_SANDBOX_MIGRATION_ID = "kata-sandbox/001-initial";

export const runKataSandboxMigrations = Effect.fn("kataSandbox.runMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Create the lock table outside the migration transaction. The claim below must be the
  // transaction's first write so concurrent WAL readers do not upgrade a stale snapshot.
  yield* sql`
    CREATE TABLE IF NOT EXISTS kata_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        INSERT OR IGNORE INTO kata_schema_migrations (id, applied_at)
          VALUES (${KATA_SANDBOX_MIGRATION_ID}, CURRENT_TIMESTAMP)
        `;
      const claim = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;
      if (claim[0]?.changed === 1) {
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
            resolved_image_digest TEXT,
            execution_token TEXT,
            claimed_at TEXT,
            result_json TEXT,
            error TEXT,
            progress_json TEXT,
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
      } else {
        const deploymentColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(kata_sandbox_deployments)
        `;
        if (!deploymentColumns.some((column) => column.name === "connector_origin_json")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_deployments ADD COLUMN connector_origin_json TEXT",
          );
        }
        if (!deploymentColumns.some((column) => column.name === "attachment")) {
          yield* sql.unsafe("ALTER TABLE kata_sandbox_deployments ADD COLUMN attachment TEXT");
        }

        const observationColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(kata_sandbox_observations)
        `;
        if (!observationColumns.some((column) => column.name === "deployment_revision")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_observations ADD COLUMN deployment_revision INTEGER NOT NULL DEFAULT 0",
          );
        }

        const operationColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(kata_sandbox_operation_receipts)
        `;
        if (!operationColumns.some((column) => column.name === "attachment")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN attachment TEXT",
          );
        }
        if (!operationColumns.some((column) => column.name === "expected_revision")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN expected_revision INTEGER",
          );
        }
        if (!operationColumns.some((column) => column.name === "resolved_image_digest")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN resolved_image_digest TEXT",
          );
        }
        if (!operationColumns.some((column) => column.name === "execution_token")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN execution_token TEXT",
          );
        }
        if (!operationColumns.some((column) => column.name === "claimed_at")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN claimed_at TEXT",
          );
        }
        if (!operationColumns.some((column) => column.name === "progress_json")) {
          yield* sql.unsafe(
            "ALTER TABLE kata_sandbox_operation_receipts ADD COLUMN progress_json TEXT",
          );
        }
        // Profile operations from the original Docker contract stored imageDigest directly.
        // Convert those receipts before the repository decodes them as the current input shape.
        yield* sql`
          UPDATE kata_sandbox_operation_receipts
          SET profile_input_json = json_remove(
                json_set(
                  profile_input_json,
                  '$.image',
                  json_object(
                    'kind', 'custom',
                    'digest', json_extract(profile_input_json, '$.imageDigest')
                  )
                ),
                '$.imageDigest'
              ),
              resolved_image_digest = COALESCE(
                resolved_image_digest,
                json_extract(profile_input_json, '$.imageDigest')
              )
          WHERE command = 'profile-upsert'
            AND profile_input_json IS NOT NULL
            AND json_extract(profile_input_json, '$.image') IS NULL
            AND json_extract(profile_input_json, '$.imageDigest') IS NOT NULL
        `;
      }
    }),
  );
});
