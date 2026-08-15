// @effect-diagnostics nodeBuiltinImport:off - this test launches the built CLI as a real child process.
// @effect-diagnostics preferSchemaOverJson:off - the acceptance proof decodes the CLI's JSON line.
// @effect-diagnostics missingEffectContext:off
// @effect-diagnostics missingLayerContext:off
// @effect-diagnostics anyUnknownInErrorContext:off
// @effect-diagnostics no-global-process-runtime:off - test-only host probe for the OS-enforced check sandbox binary.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";

import {
  EnvironmentHttpApi,
  TASK_CLI_PLANNING_COMMANDS,
  TaskCliAmendmentEnvelope,
  TaskCliCheckBeginEnvelope,
  TaskCliCheckFinalizeEnvelope,
  TaskCliCompleteEnvelope,
  TaskCliContextEnvelope,
  TaskCliProgressEnvelope,
} from "@kata-sh/code-contracts";
import {
  ensureTaskCliBundle,
  makeTaskCliBuildFixture,
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

const decodeAmendmentEnvelope = (stdout: string) =>
  Schema.decodeUnknownSync(TaskCliAmendmentEnvelope)(parseSingleEnvelope(stdout));

const decodeCheckBeginEnvelope = (stdout: string) =>
  Schema.decodeUnknownSync(TaskCliCheckBeginEnvelope)(parseSingleEnvelope(stdout));

const decodeCheckFinalizeEnvelope = (stdout: string) =>
  Schema.decodeUnknownSync(TaskCliCheckFinalizeEnvelope)(parseSingleEnvelope(stdout));

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

  it.effect("rejects planning completion without an artifact file", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli({}, ["task", "complete", "--summary", "Done."]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(decodeCompleteEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "complete",
        error: { code: "invalid_artifact" },
      });
    }).pipe(Effect.scoped as never),
  );
});

const hostHasCheckSandbox = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  if (platform === "darwin") return existsSync("/usr/bin/sandbox-exec");
  if (platform === "linux") {
    try {
      execFileSync("which", ["bwrap"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
});

describe("built Task CLI check flow", () => {
  it.effect("executes an approved check through begin, local run, and finalize", () =>
    Effect.gen(function* () {
      if (!(yield* hostHasCheckSandbox)) return;
      const fixture = yield* makeTaskCliBuildFixture();
      const result = yield* fixture.runCli({}, ["task", "check", "run", "check:pass"]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      const envelope = decodeCheckFinalizeEnvelope(result.stdout);
      expect(envelope).toMatchObject({ protocol: "task-cli@1", ok: true, operation: "check" });
      if (envelope.ok) {
        expect(envelope.status).toBe("pass");
        expect(envelope.checkId).toBe("check:pass");
      }
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects an unknown check id with a stable invalid_request envelope", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliBuildFixture();
      const result = yield* fixture.runCli({}, ["task", "check", "run", "check:missing"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(decodeCheckBeginEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "check",
        error: { code: "invalid_request" },
      });
    }).pipe(Effect.scoped as never),
  );

  it.effect("returns the stable settled-pass result without re-running a passed check", () =>
    Effect.gen(function* () {
      if (!(yield* hostHasCheckSandbox)) return;
      const fixture = yield* makeTaskCliBuildFixture();
      const first = yield* fixture.runCli({}, ["task", "check", "run", "check:pass"]);
      expect(first.exitCode).toBe(0);
      expect(decodeCheckFinalizeEnvelope(first.stdout)).toMatchObject({ ok: true });

      const second = yield* fixture.runCli({}, ["task", "check", "run", "check:pass"]);
      expect(second.exitCode).toBe(0);
      expect(second.stderr).toBe("");
      const envelope = decodeCheckBeginEnvelope(second.stdout);
      expect(envelope).toMatchObject({ ok: true, operation: "check" });
      if (envelope.ok) {
        expect(envelope.outcome).toBe("settled-pass");
        expect(envelope.finalizerToken).toBeNull();
      }
    }).pipe(Effect.scoped as never),
  );

  it.effect("settles a failing check and allocates the next attempt on rerun", () =>
    Effect.gen(function* () {
      if (!(yield* hostHasCheckSandbox)) return;
      const fixture = yield* makeTaskCliBuildFixture();
      const first = yield* fixture.runCli({}, ["task", "check", "run", "check:fail"]);
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe("");
      const firstEnvelope = decodeCheckFinalizeEnvelope(first.stdout);
      expect(firstEnvelope).toMatchObject({ ok: true });
      if (!firstEnvelope.ok || firstEnvelope.status !== "fail") return;
      expect(firstEnvelope.attemptId).toBe("check-attempt-1");

      const second = yield* fixture.runCli({}, ["task", "check", "run", "check:fail"]);
      expect(second.exitCode).toBe(0);
      const secondEnvelope = decodeCheckFinalizeEnvelope(second.stdout);
      expect(secondEnvelope).toMatchObject({ ok: true });
      if (secondEnvelope.ok) {
        expect(secondEnvelope.status).toBe("fail");
        expect(secondEnvelope.attemptId).toBe("check-attempt-2");
      }
    }).pipe(Effect.scoped as never),
  );

  it.effect("rejects a finalize with an altered starting Git state", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliBuildFixture();
      const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
        baseUrl: fixture.endpoint,
      });
      const begin = yield* client.taskCli.checkBegin({
        headers: { authorization: `Bearer ${fixture.token}` },
        payload: { checkId: "check:pass" },
      });
      expect(begin).toMatchObject({ ok: true, outcome: "spawn" });
      const token = begin.ok ? begin.finalizerToken : null;
      const startingCommitSha = begin.ok ? begin.startingCommitSha : null;
      expect(token).toBeTruthy();
      expect(startingCommitSha).toBeTruthy();

      const tampered = yield* client.taskCli.checkFinalize({
        headers: {},
        payload: {
          finalizerToken: token!,
          exitCode: 0,
          status: "pass",
          output: "ok",
          timedOut: false,
          startingCommitSha: "tampered-sha",
          endingCommitSha: startingCommitSha,
          startingStatus: "",
          endingStatus: "",
        },
      });
      expect(tampered).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "check",
        error: { code: "conflict" },
      });
    })
      .pipe(Effect.provide(FetchHttpClient.layer))
      .pipe(Effect.scoped as never),
  );

  it.effect("proposes an amendment through the CLI and opens the review gate", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliBuildFixture();
      const diffPath = NodePath.join(fixture.root, "plan-diff.md");
      writeFileSync(diffPath, "# Plan\n\nUpdated check command.\n");
      const result = yield* fixture.runCli({}, [
        "task",
        "amendment",
        "propose",
        "--phase",
        "phase:foundation",
        "--work-item",
        "work:implement",
        "--expected",
        "The approved check passes.",
        "--found",
        "The check command needs to change.",
        "--impact",
        "The Plan must update the check command.",
        "--input",
        diffPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(decodeAmendmentEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: true,
        operation: "amendment",
        accepted: true,
        amendmentId: "amendment-1",
      });
      const task = yield* fixture.taskService.getTask(fixture.taskId);
      expect(task?.build.amendmentGateId).toBe("amendment-1");
      expect(task?.build.amendments[0]?.proposedPlanMarkdown).toBe(
        "# Plan\n\nUpdated check command.\n",
      );
    }).pipe(Effect.scoped as never),
  );

  it.effect("proposes Build completion without an artifact file and binds the worktree HEAD", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliBuildFixture();
      const result = yield* fixture.runCli({}, [
        "task",
        "complete",
        "--summary",
        "Build complete.",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(decodeCompleteEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: true,
        operation: "complete",
        completion: {
          accepted: true,
          stage: "build",
        },
      });
      const task = yield* fixture.taskService.getTask(fixture.taskId);
      const buildOccurrence = task?.occurrences.find((candidate) => candidate.stage === "build");
      expect(buildOccurrence?.status).toBe("finalizing");
      expect(buildOccurrence?.completionProposalId).toBeTruthy();
    }).pipe(Effect.scoped as never),
  );
});
