// @effect-diagnostics nodeBuiltinImport:off - this test launches the built CLI as a real child process.
// @effect-diagnostics preferSchemaOverJson:off - the acceptance proof decodes the CLI's JSON line.
// @effect-diagnostics missingEffectContext:off
// @effect-diagnostics missingLayerContext:off
// @effect-diagnostics anyUnknownInErrorContext:off
import { existsSync, writeFileSync } from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  TASK_CLI_PLANNING_COMMANDS,
  TaskCliCompleteEnvelope,
  TaskCliContextEnvelope,
  TaskCliProgressEnvelope,
} from "@kata-sh/code-contracts";
import {
  ensureTaskCliBundle,
  makeTaskCliProcessFixture,
  TASK_CLI_BUNDLE_PATH,
} from "./TaskCliProcessFixture.ts";

const parseSingleEnvelope = (stdout: string) => {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!) as unknown;
};

const decodeContextEnvelope = (stdout: string) =>
  Schema.decodeUnknownSync(TaskCliContextEnvelope)(parseSingleEnvelope(stdout));

const decodeCompleteEnvelope = (stdout: string) =>
  Schema.decodeUnknownSync(TaskCliCompleteEnvelope)(parseSingleEnvelope(stdout));

const decodeProgressEnvelope = (stdout: string) =>
  Schema.decodeUnknownSync(TaskCliProgressEnvelope)(parseSingleEnvelope(stdout));

describe("built Task CLI process", () => {
  it("materializes the packaged CLI bundle before process proofs run", () => {
    ensureTaskCliBundle();
    expect(existsSync(TASK_CLI_BUNDLE_PATH)).toBe(true);
  });

  it.effect("prints exactly one authoritative context envelope from a real Task authority", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli();

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(result.stderr).not.toContain(fixture.token);
      expect(decodeContextEnvelope(result.stdout)).toEqual({
        protocol: "task-cli@1",
        ok: true,
        operation: "context",
        context: {
          stage: "questions",
          occurrence: 0,
          brief: "Prove the built Task CLI against real authority.",
          feedback: null,
          artifacts: [],
        },
        commands: TASK_CLI_PLANNING_COMMANDS,
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("fails in a fresh process when the endpoint is missing", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({ KATACODE_TASK_CLI_ENDPOINT: undefined });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("fails in a fresh process when the invocation token is missing", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({ KATACODE_TASK_INVOCATION_TOKEN: undefined });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "unauthorized" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("fails in a fresh process when the invocation token is invalid", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({
        KATACODE_TASK_INVOCATION_TOKEN: "not-the-issued-token",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "unauthorized" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("fails in a fresh process after the native turn reaches terminal state", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      yield* fixture.invocationService.revokeTurn({
        threadId: fixture.threadId,
        providerTurnId: fixture.providerTurnId,
      });
      const result = yield* fixture.runCli();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "terminal_lease" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("fails in a fresh process after the invocation is revoked as stale", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      yield* fixture.invocationService.revokeAll;
      const result = yield* fixture.runCli();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "stale_lease" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects a bare task command with one invalid_request envelope", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({}, ["task"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects an unknown Task verb with one invalid_request envelope", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({}, ["task", "frobnicate"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects a bare task progress command with one invalid_request envelope", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({}, ["task", "progress"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(decodeProgressEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "progress",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("proposes planning completion from a Markdown file and replays the same digest", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const artifactPath = NodePath.join(fixture.root, "clarify.md");
      writeFileSync(artifactPath, "# Clarify\n\nThe scope is clear.\n");
      const argv = [
        "task",
        "complete",
        "--summary",
        "Clarify complete.",
        "--artifact-file",
        artifactPath,
      ];
      const first = yield* fixture.runCli({}, argv);
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe("");
      const firstEnvelope = decodeCompleteEnvelope(first.stdout);
      expect(firstEnvelope).toMatchObject({
        protocol: "task-cli@1",
        ok: true,
        operation: "complete",
        completion: {
          accepted: true,
          stage: "questions",
          occurrence: 0,
        },
      });

      const replay = yield* fixture.runCli({}, argv);
      expect(replay.exitCode).toBe(0);
      const replayEnvelope = decodeCompleteEnvelope(replay.stdout);
      expect(replayEnvelope).toMatchObject({
        ok: true,
        operation: "complete",
        completion: {
          proposalId:
            firstEnvelope.ok === true ? firstEnvelope.completion.proposalId : "missing-proposal",
        },
      });

      writeFileSync(artifactPath, "# Clarify\n\nChanged after proposal.\n");
      const changed = yield* fixture.runCli({}, argv);
      expect(changed.exitCode).toBe(1);
      expect(decodeCompleteEnvelope(changed.stdout)).toMatchObject({
        ok: false,
        operation: "complete",
        error: { code: "conflict" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects complete identity flags and missing complete flags", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const missing = yield* fixture.runCli({}, ["task", "complete"]);
      expect(missing.exitCode).toBe(1);
      expect(decodeCompleteEnvelope(missing.stdout)).toMatchObject({
        ok: false,
        operation: "complete",
        error: { code: "invalid_request" },
      });

      const forged = yield* fixture.runCli({}, [
        "task",
        "complete",
        "--summary",
        "Done.",
        "--artifact-file",
        "-",
        "--task-id",
        "forged-task",
      ]);
      expect(forged.exitCode).toBe(1);
      expect(decodeCompleteEnvelope(forged.stdout)).toMatchObject({
        ok: false,
        operation: "complete",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects identity flags with one invalid_request envelope", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({}, [
        "task",
        "context",
        "--task-id",
        "forged-task",
        "--thread-id",
        "forged-thread",
        "--occurrence",
        "9",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(decodeContextEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );
});
