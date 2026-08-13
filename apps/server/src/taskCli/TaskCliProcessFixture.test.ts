// @effect-diagnostics nodeBuiltinImport:off - this test launches the built CLI as a real child process.
// @effect-diagnostics preferSchemaOverJson:off - the acceptance proof decodes the CLI's JSON line.
// @effect-diagnostics missingEffectContext:off
// @effect-diagnostics missingLayerContext:off
// @effect-diagnostics anyUnknownInErrorContext:off
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TaskCliContextEnvelope } from "@kata-sh/code-contracts";
import { makeTaskCliProcessFixture } from "./TaskCliProcessFixture.ts";

const decodeSingleEnvelope = (stdout: string) => {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return Schema.decodeUnknownSync(TaskCliContextEnvelope)(JSON.parse(lines[0]!));
};

describe("built Task CLI process", () => {
  it.effect("prints exactly one authoritative context envelope from a real Task authority", () =>
    Effect.gen(function* () {
      const fixture = yield* makeTaskCliProcessFixture();
      const result = yield* fixture.runCli();

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(fixture.token);
      expect(result.stderr).not.toContain(fixture.token);
      expect(decodeSingleEnvelope(result.stdout)).toEqual({
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
      expect(decodeSingleEnvelope(result.stdout)).toMatchObject({
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
      expect(decodeSingleEnvelope(result.stdout)).toMatchObject({
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
      expect(decodeSingleEnvelope(result.stdout)).toMatchObject({
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
      expect(decodeSingleEnvelope(result.stdout)).toMatchObject({
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
      expect(decodeSingleEnvelope(result.stdout)).toMatchObject({
        protocol: "task-cli@1",
        ok: false,
        operation: "context",
        error: { code: "stale_lease" },
      });
    }).pipe(Effect.scoped as never),
  );
});
