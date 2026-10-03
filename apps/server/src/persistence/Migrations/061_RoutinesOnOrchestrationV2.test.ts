import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@kata-sh/code-shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import Migration0061, { UPGRADE_IN_FLIGHT_DETAIL } from "./061_RoutinesOnOrchestrationV2.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("061_RoutinesOnOrchestrationV2", (it) => {
  it.effect("settles runs the previous orchestrator started and keeps admitted runs queued", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      yield* sql`INSERT INTO routines (id, environment_id, revision, state, next_due_at, record)
        VALUES ('routine-a', 'environment-a', 1, 'enabled', '2026-10-04T09:00:00.000Z', '{}')`;
      const runs = [
        ["admitted", 0, "queued"],
        ["thread-created", 0, "starting"],
        ["prompt-accepted", 0, "starting"],
        ["submitting", 1, "starting"],
        ["provider-bound", 1, "waiting-for-approval"],
      ] as const;
      for (const [stage, consumed, status] of runs) {
        // Each stage stands for its own routine slot, so active runs never collide.
        yield* sql`INSERT INTO routines (id, environment_id, revision, state, next_due_at, record)
          VALUES (${`routine-${stage}`}, 'environment-a', 1, 'enabled', '2026-10-04T09:00:00.000Z', '{}')`;
        yield* sql`INSERT INTO routine_runs (id, routine_id, occurrence_key, admitted_at, stage, active,
            submission_consumed, thread_id, message_id, command_id, record)
          VALUES (${`run-${stage}`}, ${`routine-${stage}`}, 'test:1', 1, ${stage}, 1, ${consumed},
            ${`thread-${stage}`}, ${`message-${stage}`}, ${`command-${stage}`},
            ${`{"id":"run-${stage}","stage":"${stage}","status":"${status}","detail":null}`})`;
      }
      yield* sql`INSERT INTO routine_runs (id, routine_id, occurrence_key, admitted_at, stage, active,
          submission_consumed, thread_id, message_id, command_id, record)
        VALUES ('run-done', 'routine-a', 'test:0', 0, 'terminal', 0, 1, 'thread-done', 'message-done',
          'command-done', ${'{"id":"run-done","stage":"terminal","status":"succeeded","detail":null}'})`;
      const changesBefore = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM routine_changes`;

      yield* Migration0061;

      const rows = yield* sql<{
        id: string;
        stage: string;
        active: number;
        recordStage: string;
        recordStatus: string;
        recordDetail: string | null;
      }>`SELECT id, stage, active, json_extract(record, '$.stage') AS recordStage,
          json_extract(record, '$.status') AS recordStatus,
          json_extract(record, '$.detail') AS recordDetail
        FROM routine_runs ORDER BY id`;
      assert.deepEqual(
        rows.map((row) => [
          row.id,
          row.stage,
          row.active,
          row.recordStage,
          row.recordStatus,
          row.recordDetail,
        ]),
        [
          ["run-admitted", "admitted", 1, "admitted", "queued", null],
          ["run-done", "terminal", 0, "terminal", "succeeded", null],
          [
            "run-prompt-accepted",
            "terminal",
            0,
            "terminal",
            "needs-attention",
            UPGRADE_IN_FLIGHT_DETAIL,
          ],
          [
            "run-provider-bound",
            "terminal",
            0,
            "terminal",
            "needs-attention",
            UPGRADE_IN_FLIGHT_DETAIL,
          ],
          [
            "run-submitting",
            "terminal",
            0,
            "terminal",
            "needs-attention",
            UPGRADE_IN_FLIGHT_DETAIL,
          ],
          [
            "run-thread-created",
            "terminal",
            0,
            "terminal",
            "needs-attention",
            UPGRADE_IN_FLIGHT_DETAIL,
          ],
        ],
      );
      const changesAfter = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM routine_changes`;
      assert.equal(changesAfter[0]!.count - changesBefore[0]!.count, 1);
      const tables = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'routine_provider_events'
      `;
      assert.deepEqual(tables, []);
    }),
  );
});
