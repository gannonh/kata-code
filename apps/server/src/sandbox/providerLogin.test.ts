/* eslint-disable kata-code/no-manual-effect-runtime-in-tests -- provider-login leak tests use Effect.runPromise / Stream.runCollect. */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";
import { SandboxProviderError } from "@kata-sh/code-sandbox/driver";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";

import {
  cancelProviderLogin,
  extractProviderLoginUrl,
  hasActiveProviderLogin,
  PROVIDER_LOGIN_SPECS,
  startProviderLogin,
  submitProviderLoginCode,
} from "./providerLogin.ts";

const claudeSpec = PROVIDER_LOGIN_SPECS.find((spec) => spec.providerId === "claude");

if (!claudeSpec) {
  throw new Error("Claude provider login spec missing.");
}

const FAKE_KIND = SandboxProviderDriverKind.make("fake-login");

const either = <A, E>(
  eff: Effect.Effect<A, E>,
): Effect.Effect<{ _tag: "Left"; left: E } | { _tag: "Right"; right: A }, never> =>
  Effect.matchEffect(eff, {
    onFailure: (left) => Effect.succeed<{ _tag: "Left"; left: E }>({ _tag: "Left", left }),
    onSuccess: (right) => Effect.succeed<{ _tag: "Right"; right: A }>({ _tag: "Right", right }),
  });

function makeFakeDriver(opts?: { readonly scriptPresent?: boolean; readonly outputLog?: string }): {
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
} {
  const handle: SandboxHandle = {
    driverKind: FAKE_KIND,
    instanceId: "docker_login_01",
    handle: { fake: true },
  };
  const driver: SandboxProvider = {
    kind: FAKE_KIND,
    validate: () => Effect.void,
    provision: (req) =>
      Effect.succeed({
        driverKind: FAKE_KIND,
        instanceId: req.instanceId,
        handle: { fake: true },
      }),
    exec: (_handle, command) => {
      if (command.includes("command -v script")) {
        return Effect.succeed({
          exitCode: 0,
          stdout: opts?.scriptPresent === false ? "" : "ok",
          stderr: "",
        });
      }
      if (command.includes("cat ") && command.includes("output.log")) {
        return Effect.succeed({
          exitCode: 0,
          stdout: opts?.outputLog ?? "",
          stderr: "",
        });
      }
      return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
    },
    reachability: () =>
      Effect.succeed({
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        httpBaseUrl: "http://localhost:1",
        wsBaseUrl: "ws://localhost:1",
      }),
    dispose: () => Effect.void,
    describe: () =>
      Effect.succeed({
        kind: FAKE_KIND,
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsCopyInto: false,
        supportsLifecycle: false,
        supportsProjectSource: false,
      }),
  };
  return { driver, handle };
}

const stubSecretStore = {
  get: () => Effect.succeed(null),
  set: () => Effect.void,
  create: () => Effect.void,
  getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
  remove: () => Effect.void,
} as const;

describe("extractProviderLoginUrl", () => {
  it("prefers Claude OSC-8 hyperlink URLs over truncated visible terminal text", () => {
    const fullUrl =
      "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz";
    const output = [
      "Browser didn't open? Use the url below to sign in",
      `\x1b]8;id=abc;${fullUrl}\x07https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88\x1b]8;;\x07`,
    ].join("\n");

    expect(extractProviderLoginUrl(output, claudeSpec.urlPattern)).toBe(fullUrl);
  });

  it("falls back to plain text provider URLs", () => {
    const url =
      "https://claude.com/cai/oauth/authorize?code=true&client_id=client&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz";

    expect(extractProviderLoginUrl(`Open ${url}`, claudeSpec.urlPattern)).toBe(url);
  });
});

describe("providerLogin lifecycle cleanup", () => {
  it("cleans up the active login entry when the OAuth URL poll times out", async () => {
    const { driver, handle } = makeFakeDriver({ outputLog: "" });
    const events = await Effect.runPromise(
      Stream.runCollect(
        startProviderLogin({
          driver,
          handle,
          providerId: "claude",
          urlPollAttempts: 1,
        }),
      ).pipe(Effect.map((chunk) => [...chunk])),
    );
    expect(events.some((e) => e.stage === "error")).toBe(true);
    const error = events.find((e) => e.stage === "error");
    expect(error?.stage === "error" ? error.loginSessionId : undefined).toBeTruthy();
    if (error?.stage === "error") {
      expect(hasActiveProviderLogin(error.loginSessionId)).toBe(false);
    }
  });

  it("rejects code submission when instanceId does not match the active login", async () => {
    const { driver, handle } = makeFakeDriver({
      outputLog:
        "Open https://claude.com/cai/oauth/authorize?code=true&client_id=c&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=a&code_challenge_method=S256&state=z",
    });
    const events = await Effect.runPromise(
      Stream.runCollect(
        startProviderLogin({
          driver,
          handle,
          providerId: "claude",
          urlPollAttempts: 2,
        }),
      ).pipe(Effect.map((chunk) => [...chunk])),
    );
    const started = events.find((e) => e.stage === "started");
    expect(started?.stage === "started" ? started.loginSessionId : undefined).toBeTruthy();
    if (started?.stage !== "started") return;
    const loginSessionId = started.loginSessionId;
    expect(hasActiveProviderLogin(loginSessionId)).toBe(true);

    const result = await Effect.runPromise(
      either(
        submitProviderLoginCode({
          loginSessionId,
          instanceId: "other_instance",
          code: "abcd",
        }).pipe(Effect.provideService(ServerSecretStore, stubSecretStore)),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("does not belong");
    }
    // Mismatch must not tear down the real session.
    expect(hasActiveProviderLogin(loginSessionId)).toBe(true);
    cancelProviderLogin({ loginSessionId, instanceId: handle.instanceId });
    expect(hasActiveProviderLogin(loginSessionId)).toBe(false);
  });

  it("cleans up the active login when submit exec fails after validation", async () => {
    let execCount = 0;
    const { driver, handle } = makeFakeDriver({
      outputLog:
        "Open https://claude.com/cai/oauth/authorize?code=true&client_id=c&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=a&code_challenge_method=S256&state=z",
    });
    const failingDriver: SandboxProvider = {
      ...driver,
      exec: (h, command) => {
        execCount += 1;
        // After URL discovery, fail the FIFO write on submit.
        if (command.includes("stdin.fifo") && command.includes("printf")) {
          return Effect.fail(
            new SandboxProviderError({
              reason: "exec-failed",
              message: "fifo write failed",
            }),
          );
        }
        return driver.exec(h, command);
      },
    };
    const events = await Effect.runPromise(
      Stream.runCollect(
        startProviderLogin({
          driver: failingDriver,
          handle,
          providerId: "claude",
          urlPollAttempts: 2,
        }),
      ).pipe(Effect.map((chunk) => [...chunk])),
    );
    const started = events.find((e) => e.stage === "started");
    expect(started?.stage === "started" ? started.loginSessionId : undefined).toBeTruthy();
    if (started?.stage !== "started") return;
    const loginSessionId = started.loginSessionId;
    expect(hasActiveProviderLogin(loginSessionId)).toBe(true);

    const result = await Effect.runPromise(
      either(
        submitProviderLoginCode({
          loginSessionId,
          instanceId: handle.instanceId,
          code: "abcd",
        }).pipe(Effect.provideService(ServerSecretStore, stubSecretStore)),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(hasActiveProviderLogin(loginSessionId)).toBe(false);
    expect(execCount).toBeGreaterThan(0);
  });

  it("cancelProviderLogin is a no-op for a mismatched instanceId", async () => {
    const { driver, handle } = makeFakeDriver({
      outputLog:
        "Open https://claude.com/cai/oauth/authorize?code=true&client_id=c&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=a&code_challenge_method=S256&state=z",
    });
    const events = await Effect.runPromise(
      Stream.runCollect(
        startProviderLogin({
          driver,
          handle,
          providerId: "claude",
          urlPollAttempts: 2,
        }),
      ).pipe(Effect.map((chunk) => [...chunk])),
    );
    const started = events.find((e) => e.stage === "started");
    if (started?.stage !== "started") throw new Error("expected started event");
    const loginSessionId = started.loginSessionId;
    cancelProviderLogin({ loginSessionId, instanceId: "wrong" });
    expect(hasActiveProviderLogin(loginSessionId)).toBe(true);
    cancelProviderLogin({ loginSessionId, instanceId: handle.instanceId });
    expect(hasActiveProviderLogin(loginSessionId)).toBe(false);
  });
});
