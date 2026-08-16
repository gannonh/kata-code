/**
 * `providerLogin` — interactive "Sign in <provider>" flow for sandbox sessions.
 *
 * No host PTY is possible against a Vercel sandbox, so the provider login
 * command runs inside the sandbox under `script(1)` with a FIFO for stdin.
 * `script(1)` allocates the PTY the CLI needs; `tail -f` on the FIFO keeps
 * stdin open across the URL-then-code sequence. The host polls the sandbox
 * output log for the OAuth URL, relays it to the UI, accepts the code via the
 * FIFO, and captures the resulting credential file into `ServerSecretStore`.
 *
 * V1 targets Claude (AC-3b.11 requires "at least one OAuth-based provider").
 * `PROVIDER_LOGIN_SPECS` isolates every affected detail (login command, URL
 * pattern, credential path, secret name) so the spike UAT findings adjust
 * data, not architecture.
 *
 * Spike deferral: the `claude setup-token` under `script(1)` behavior is
 * maintainer-local UAT (plan M5 mandatory first task). The spec table below
 * holds the assumed command/path; record findings and adjust the data before
 * relying on this flow in production.
 *
 * @module providerLogin
 */
// @effect-diagnostics nodeBuiltinImport:off - randomBytes for login session ids and FIFO path uniqueness.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";

import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import {
  type SandboxProviderLoginEvent,
  SandboxRpcError,
} from "@kata-sh/code-contracts/sandboxRpc";

/** Provider login command + extraction details. */
export interface ProviderLoginSpec {
  readonly providerId: string;
  /** Command run under `script(1)` inside the sandbox. */
  readonly loginCommand: string;
  /** Matches the OAuth URL in the sandbox output log. */
  readonly urlPattern: RegExp;
  /** Matches invalid-code messages in the sandbox output log. */
  readonly invalidCodePattern: RegExp;
  /** Absolute in-sandbox path of the resulting auth file. */
  readonly credentialPath: string;
  /** `ServerSecretStore` key the captured credential is stored under. */
  readonly secretName: string;
}

/**
 * V1 provider login specs. Claude is the required OAuth-based provider
 * (AC-3b.11). The login command and credential path are the assumed values
 * pending the maintainer-local spike UAT; adjust the data per findings.
 */
export const PROVIDER_LOGIN_SPECS: ReadonlyArray<ProviderLoginSpec> = [
  {
    providerId: "claude",
    loginCommand: "env HOME=/home/katacode claude setup-token",
    urlPattern:
      /https:\/\/(?:claude\.ai|claude\.com|console\.anthropic\.com)\/[^\s"'<>)\]]*oauth[^\s"'<>)\]]*/iu,
    invalidCodePattern: /invalid|incorrect|expired|try again|rejected/iu,
    credentialPath: "/home/katacode/.claude/.credentials.json",
    secretName: "sandbox-credential-claude",
  },
];

interface ActiveLogin {
  readonly instanceId: string;
  readonly spec: ProviderLoginSpec;
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly dir: string;
}

const activeLogins = new Map<string, ActiveLogin>();

// eslint-disable-next-line no-control-regex -- OSC 8 hyperlink control sequences are intentional terminal output.
const OSC8_HYPERLINK_PATTERN = /\x1b\]8;[^\x07\x1b;]*;(https?:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/gu;

/** Strip ANSI escape sequences and OSC hyperlinks from terminal output. */
function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, "");
}

/** Extract the provider OAuth URL from PTY output.
 *
 * Claude renders the full sign-in URL as an OSC-8 terminal hyperlink and then
 * prints a visually wrapped copy. The visible copy can be line-truncated by
 * `script(1)`, so prefer the OSC-8 URI before falling back to stripped text.
 */
export function extractProviderLoginUrl(input: string, urlPattern: RegExp): string | null {
  for (const match of input.matchAll(OSC8_HYPERLINK_PATTERN)) {
    const uri = match[1];
    if (!uri) continue;
    const urlMatch = uri.match(urlPattern);
    if (urlMatch !== null) return urlMatch[0];
  }
  const text = stripAnsi(input);
  const urlMatch = text.match(urlPattern);
  return urlMatch?.[0] ?? null;
}

/** Injection guard for OAuth codes written into the FIFO. */
const CODE_PATTERN = /^[A-Za-z0-9#_-]{4,256}$/u;

/**
 * Start a provider sign-in flow. Returns a stream of `SandboxProviderLoginEvent`.
 * The flow: mkfifo + detached `tail -f fifo | script -qec <login> log`, poll
 * the log for the OAuth URL, emit `url` then `awaiting-code`. The code is
 * submitted via `submitProviderLoginCode`.
 */
export function startProviderLogin(input: {
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly providerId: string;
  /** Override the URL-poll budget (default 180 × 1s). Tests pass 1–2. */
  readonly urlPollAttempts?: number;
}): Stream.Stream<SandboxProviderLoginEvent, SandboxRpcError> {
  const spec = PROVIDER_LOGIN_SPECS.find((s) => s.providerId === input.providerId);
  if (spec === undefined) {
    return Stream.fail(
      new SandboxRpcError({
        reason: "invalid-config",
        message: `No sign-in spec for provider '${input.providerId}'.`,
      }),
    );
  }
  // @effect-diagnostics-next-line effect(globalDateInEffect):off - random id; no Effect Clock.
  const loginSessionId = NodeCrypto.randomBytes(8).toString("hex");
  const dir = `/tmp/kata-login/${loginSessionId}`;

  // Tracks whether URL polling completed with a live login awaiting a code.
  // Stream interruption / failure before that point must clean up; success
  // leaves the session active for submit/cancel.
  let awaitingCode = false;

  return Stream.fromEffect(
    Effect.gen(function* () {
      // Fail loud when the sandbox image is missing `script(1)`. Without it
      // the launch pipeline below silently produces no output.log and the UI
      // hangs on "Starting sign-in…". Alpine ships `script` in the
      // `util-linux-misc` package; the katacode image installs it.
      const scriptCheck = yield* input.driver
        .exec(input.handle, "command -v script >/dev/null 2>&1 && echo ok")
        .pipe(
          Effect.mapError(
            (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
          ),
        );
      if (scriptCheck.stdout.trim() !== "ok") {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message:
            "Provider sign-in needs `script(1)` inside the sandbox, but the image does not ship it. Rebuild the katacode image (adds `util-linux-misc`), or install `util-linux-misc` in your custom image.",
        });
      }
      yield* input.driver
        .exec(input.handle, `mkdir -p ${dir} && mkfifo ${dir}/stdin.fifo`)
        .pipe(
          Effect.mapError(
            (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
          ),
        );
      const launch = `setsid sh -c 'tail -f ${dir}/stdin.fifo | script -qec "${spec.loginCommand}" ${dir}/output.log' &`;
      yield* input.driver
        .exec(input.handle, launch)
        .pipe(
          Effect.mapError(
            (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
          ),
        );
      activeLogins.set(loginSessionId, {
        instanceId: input.handle.instanceId,
        spec,
        driver: input.driver,
        handle: input.handle,
        dir,
      });
      return loginSessionId;
    }),
  ).pipe(
    Stream.flatMap((id) =>
      Stream.fromEffect(
        Effect.gen(function* () {
          // Poll the output log for the OAuth URL (default 180s budget).
          const attempts = input.urlPollAttempts ?? 180;
          for (let i = 0; i < attempts; i++) {
            const result = yield* input.driver
              .exec(input.handle, `cat ${dir}/output.log 2>/dev/null || true`)
              .pipe(
                Effect.mapError(
                  (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
                ),
              );
            const url = extractProviderLoginUrl(result.stdout, spec.urlPattern);
            if (url !== null) {
              awaitingCode = true;
              return [
                { stage: "started", loginSessionId: id },
                { stage: "url", loginSessionId: id, url },
                { stage: "awaiting-code", loginSessionId: id },
              ] as ReadonlyArray<SandboxProviderLoginEvent>;
            }
            yield* Effect.sleep("1 seconds");
          }
          // URL timeout: tear down the FIFO/process and drop the active entry
          // so a cancelled/abandoned dialog cannot leak sandbox resources.
          cleanupLogin(id);
          return [
            {
              stage: "error",
              loginSessionId: id,
              message: "Sign-in timed out waiting for the OAuth URL.",
            },
          ] as ReadonlyArray<SandboxProviderLoginEvent>;
        }),
      ).pipe(Stream.flatMap(Stream.fromIterable)),
    ),
    Stream.ensuring(
      Effect.sync(() => {
        if (!awaitingCode) cleanupLogin(loginSessionId);
      }),
    ),
  );
}

/**
 * Submit an OAuth code into a running sign-in flow. Writes the code to the
 * FIFO, polls for the credential file (success) or an invalid-code message.
 * On success, captures the credential into `ServerSecretStore`.
 */
export function submitProviderLoginCode(input: {
  readonly instanceId?: string;
  readonly loginSessionId: string;
  readonly code: string;
}): Effect.Effect<
  { readonly loginSessionId: string; readonly accepted: boolean },
  SandboxRpcError,
  ServerSecretStore
> {
  return Effect.gen(function* () {
    const active = activeLogins.get(input.loginSessionId);
    if (active === undefined) {
      return yield* new SandboxRpcError({
        reason: "not-running",
        message: "No active sign-in session for that id.",
      });
    }
    if (input.instanceId !== undefined && active.instanceId !== input.instanceId) {
      return yield* new SandboxRpcError({
        reason: "invalid-config",
        message: "Sign-in session does not belong to this sandbox instance.",
      });
    }
    if (!CODE_PATTERN.test(input.code)) {
      return yield* new SandboxRpcError({
        reason: "invalid-config",
        message: "Invalid code format.",
      });
    }
    // After validation, exec/store failures must not leave FIFO/processes behind.
    // Invalid-code returns Success(accepted:false) and must keep the session.
    return yield* Effect.gen(function* () {
      // Write the code into the FIFO.
      const escapedCode = input.code.replace(/'/g, "'\\''");
      yield* active.driver
        .exec(active.handle, `printf '%s\\n' '${escapedCode}' > ${active.dir}/stdin.fifo`)
        .pipe(
          Effect.mapError(
            (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
          ),
        );

      const store = yield* ServerSecretStore;
      // Poll for success (credential file appears) or invalid code (90s budget).
      for (let i = 0; i < 90; i++) {
        const existsResult = yield* active.driver
          .exec(active.handle, `test -f ${active.spec.credentialPath}`)
          .pipe(
            Effect.mapError(
              (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
            ),
          );
        if (existsResult.exitCode === 0) {
          const catResult = yield* active.driver
            .exec(active.handle, `cat ${active.spec.credentialPath}`)
            .pipe(
              Effect.mapError(
                (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
              ),
            );
          yield* store
            .set(active.spec.secretName, Buffer.from(catResult.stdout, "utf8"))
            .pipe(
              Effect.mapError(
                (e) => new SandboxRpcError({ reason: "internal", message: e.message }),
              ),
            );
          cleanupLogin(input.loginSessionId);
          return { loginSessionId: input.loginSessionId, accepted: true };
        }
        const logResult = yield* active.driver
          .exec(active.handle, `cat ${active.dir}/output.log 2>/dev/null || true`)
          .pipe(
            Effect.mapError(
              (e) => new SandboxRpcError({ reason: "provision-failed", message: e.message }),
            ),
          );
        const text = stripAnsi(logResult.stdout);
        if (active.spec.invalidCodePattern.test(text)) {
          // Keep the session alive so the user can retry with a new code; the
          // dialog close / cancel path calls cancelProviderLogin.
          return { loginSessionId: input.loginSessionId, accepted: false };
        }
        yield* Effect.sleep("1 seconds");
      }
      cleanupLogin(input.loginSessionId);
      return yield* new SandboxRpcError({
        reason: "unreachable",
        message: "Sign-in timed out waiting for the credential file.",
      });
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Effect.sync(() => cleanupLogin(input.loginSessionId)) : Effect.void,
      ),
    );
  });
}

/** Cancel an in-flight sign-in (dialog close / stream abort). Idempotent.
 *  When `instanceId` is provided, only cancels if the active session belongs
 *  to that instance (cross-instance cancel is a no-op). */
export function cancelProviderLogin(input: {
  readonly loginSessionId: string;
  readonly instanceId?: string;
}): void {
  const active = activeLogins.get(input.loginSessionId);
  if (active === undefined) return;
  if (input.instanceId !== undefined && active.instanceId !== input.instanceId) return;
  cleanupLogin(input.loginSessionId);
}

/** Best-effort cleanup of a login session's FIFO/log + active-login entry. */
function cleanupLogin(loginSessionId: string): void {
  const active = activeLogins.get(loginSessionId);
  if (active === undefined) return;
  active.driver
    .exec(active.handle, `pkill -f '${active.dir}' ; rm -rf ${active.dir}`)
    .pipe(Effect.ignore, Effect.runFork);
  activeLogins.delete(loginSessionId);
}

/** Test-only: whether a login session is still tracked (leak detection). */
export function hasActiveProviderLogin(loginSessionId: string): boolean {
  return activeLogins.has(loginSessionId);
}
