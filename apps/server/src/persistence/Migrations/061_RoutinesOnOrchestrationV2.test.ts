import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@kata-sh/code-shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import Migration0061, { UPGRADE_IN_FLIGHT_DETAIL } from "./061_RoutinesOnOrchestrationV2.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("061_RoutinesOnOrchestrationV2", (it) => {
  it.effect("settles runs the previous orchestrator started and keeps unclaimed runs queued", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      yield* sql`INSERT INTO routines (id, environment_id, revision, state, next_due_at, record)
        VALUES ('routine-a', 'environment-a', 1, 'enabled', '2026-10-04T09:00:00.000Z', '{}')`;
      // [name, stage, submission_consumed, claim generation, intent_event, status]
      const runs = [
        ["admitted", "admitted", 0, 0, null, "queued"],
        // A worker claimed it, so the previous dispatcher may have created the
        // routine branch and worktree, or the thread, before recording a stage.
        ["admitted-claimed", "admitted", 0, 1, null, "queued"],
        ["admitted-set-up", "admitted", 0, 2, "setup-complete", "starting"],
        ["thread-created", "thread-created", 0, 1, null, "starting"],
        ["prompt-accepted", "prompt-accepted", 0, 1, null, "starting"],
        ["submitting", "submitting", 1, 1, null, "starting"],
        ["provider-bound", "provider-bound", 1, 1, null, "waiting-for-approval"],
      ] as const;
      for (const [name, stage, consumed, generation, intentEvent, status] of runs) {
        // Each run stands for its own routine slot, so active runs never collide.
        yield* sql`INSERT INTO routines (id, environment_id, revision, state, next_due_at, record)
          VALUES (${`routine-${name}`}, 'environment-a', 1, 'enabled', '2026-10-04T09:00:00.000Z', '{}')`;
        yield* sql`INSERT INTO routine_runs (id, routine_id, occurrence_key, admitted_at, stage, active,
            owner, generation, submission_consumed, intent_event, thread_id, message_id, command_id, record)
          VALUES (${`run-${name}`}, ${`routine-${name}`}, 'test:1', 1, ${stage}, 1,
            ${generation === 0 ? null : "worker-v1"}, ${generation}, ${consumed}, ${intentEvent},
            ${`thread-${name}`}, ${`message-${name}`}, ${`command-${name}`},
            ${`{"id":"run-${name}","stage":"${stage}","status":"${status}","detail":null}`})`;
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
          [
            "run-admitted-claimed",
            "terminal",
            0,
            "terminal",
            "needs-attention",
            UPGRADE_IN_FLIGHT_DETAIL,
          ],
          [
            "run-admitted-set-up",
            "terminal",
            0,
            "terminal",
            "needs-attention",
            UPGRADE_IN_FLIGHT_DETAIL,
          ],
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
