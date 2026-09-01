import type {
  ProviderSession,
  TerminalMetadataStreamEvent,
  TerminalSummary,
} from "@kata-sh/code-contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as BackgroundPolicy from "./background/BackgroundPolicy.ts";
import * as ProcessRunner from "./processRunner.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as TerminalManager from "./terminal/Manager.ts";

const SPRITE_API_SOCKET = "/.sprite/api.sock";
const TASK_NAME = "kata-session";
const TASK_TTL = "5m";
export const SPRITE_IDLE_GRACE_MS = 10 * 60_000;
export const SPRITE_TASK_REFRESH_MS = 60_000;
const ACTIVITY_POLL_INTERVAL = "15 seconds";

export interface SpriteLeaseState {
  readonly held: boolean;
  readonly lastDemandAt: number | null;
  readonly lastRefreshAt: number | null;
}

export type SpriteLeaseAction = "none" | "refresh" | "release";

export function hasSpriteActivity(input: {
  readonly connectedClientCount: number;
  readonly providerSessions: ReadonlyArray<Pick<ProviderSession, "activeTurnId" | "status">>;
  readonly terminals: ReadonlyArray<Pick<TerminalSummary, "hasRunningSubprocess">>;
}): boolean {
  return (
    input.connectedClientCount > 0 ||
    input.providerSessions.some(
      (session) =>
        session.activeTurnId !== undefined ||
        session.status === "connecting" ||
        session.status === "running",
    ) ||
    input.terminals.some((terminal) => terminal.hasRunningSubprocess)
  );
}

export function nextSpriteLeaseState(input: {
  readonly current: SpriteLeaseState;
  readonly demand: boolean;
  readonly now: number;
}): { readonly action: SpriteLeaseAction; readonly next: SpriteLeaseState } {
  const lastDemandAt = input.demand ? input.now : input.current.lastDemandAt;
  const withinIdleGrace = lastDemandAt !== null && input.now - lastDemandAt < SPRITE_IDLE_GRACE_MS;
  const shouldHold = input.demand || withinIdleGrace;

  if (!shouldHold) {
    return {
      action: input.current.held ? "release" : "none",
      next: { held: false, lastDemandAt, lastRefreshAt: null },
    };
  }

  const refreshDue =
    input.current.lastRefreshAt === null ||
    input.now - input.current.lastRefreshAt >= SPRITE_TASK_REFRESH_MS;
  return {
    action: refreshDue ? "refresh" : "none",
    next: {
      held: true,
      lastDemandAt,
      lastRefreshAt: refreshDue ? input.now : input.current.lastRefreshAt,
    },
  };
}

function terminalKey(terminal: Pick<TerminalSummary, "threadId" | "terminalId">): string {
  return JSON.stringify([terminal.threadId, terminal.terminalId]);
}

export function updateTerminalActivity(
  terminals: ReadonlyMap<string, TerminalSummary>,
  event: TerminalMetadataStreamEvent,
): Map<string, TerminalSummary> {
  if (event.type === "snapshot") {
    return new Map(event.terminals.map((terminal) => [terminalKey(terminal), terminal]));
  }
  const next = new Map(terminals);
  if (event.type === "upsert") {
    next.set(terminalKey(event.terminal), event.terminal);
  } else {
    next.delete(JSON.stringify([event.threadId, event.terminalId]));
  }
  return next;
}

export function spriteTaskArgs(action: "refresh" | "release"): ReadonlyArray<string> {
  return action === "refresh"
    ? [
        "curl",
        "--fail-with-body",
        "--silent",
        "--show-error",
        "-X",
        "PUT",
        `/v1/tasks/${TASK_NAME}`,
        "-H",
        "Content-Type: application/json",
        "-d",
        `{"expire":"${TASK_TTL}"}`,
      ]
    : [
        "curl",
        "-sS",
        "-w",
        "\n%{http_code}",
        "-X",
        "DELETE",
        `/v1/tasks/${TASK_NAME}`,
      ];
}

export function spriteTaskHttpCode(stdout: string): string {
  const trimmed = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  const separator = trimmed.lastIndexOf("\n");
  return (separator === -1 ? trimmed : trimmed.slice(separator + 1)).trim();
}

export function runSpriteTaskCommand(
  runner: Pick<ProcessRunner.ProcessRunner["Service"], "run">,
  args: ReadonlyArray<string>,
  options?: { readonly acceptNotFound?: boolean },
) {
  return runner.run({ command: "sprite-env", args, timeout: "15 seconds" }).pipe(
    Effect.flatMap((result) => {
      if (result.code !== 0) {
        return Effect.fail(`sprite-env exited with code ${result.code}`);
      }
      const code = spriteTaskHttpCode(result.stdout);
      if (options?.acceptNotFound && code !== "404" && !/^2\d\d$/.test(code)) {
        return Effect.fail(`Sprite task API returned HTTP ${code}`);
      }
      return Effect.void;
    }),
  );
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(SPRITE_API_SOCKET).pipe(Effect.orElseSucceed(() => false)))) {
    return;
  }

  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const providers = yield* ProviderService.ProviderService;
  const terminals = yield* TerminalManager.TerminalManager;
  const runner = yield* ProcessRunner.ProcessRunner;
  const terminalState = yield* Ref.make(new Map<string, TerminalSummary>());
  const leaseState = yield* Ref.make<SpriteLeaseState>({
    held: false,
    lastDemandAt: null,
    lastRefreshAt: null,
  });

  const unsubscribe = yield* terminals.subscribeMetadata((event) =>
    Ref.update(terminalState, (current) => updateTerminalActivity(current, event)),
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

  const refreshTask = runSpriteTaskCommand(runner, spriteTaskArgs("refresh"));
  const releaseTask = runSpriteTaskCommand(runner, spriteTaskArgs("release"), {
    acceptNotFound: true,
  });

  const tick = Effect.gen(function* () {
    const [connectedClientCount, sessions, terminalSessions, current, now] = yield* Effect.all([
      backgroundPolicy.connectedClientCount,
      providers.listSessions(),
      Ref.get(terminalState),
      Ref.get(leaseState),
      Clock.currentTimeMillis,
    ]);
    const demand = hasSpriteActivity({
      connectedClientCount,
      providerSessions: sessions,
      terminals: [...terminalSessions.values()],
    });
    const decision = nextSpriteLeaseState({ current, demand, now });

    if (decision.action === "none") {
      yield* Ref.set(leaseState, decision.next);
      return;
    }

    const command = decision.action === "refresh" ? refreshTask : releaseTask;
    yield* command.pipe(
      Effect.tap(() => Ref.set(leaseState, decision.next)),
      Effect.catch((cause) =>
        Ref.set(leaseState, {
          ...current,
          lastDemandAt: decision.next.lastDemandAt,
        }).pipe(
          Effect.andThen(
            Effect.logWarning(`Failed to ${decision.action} Sprite activity task`, { cause }),
          ),
        ),
      ),
    );
  });

  yield* Effect.logInfo("Sprite activity lease enabled", {
    idleGraceMs: SPRITE_IDLE_GRACE_MS,
    refreshMs: SPRITE_TASK_REFRESH_MS,
    taskTtl: TASK_TTL,
  });
  yield* Effect.forever(tick.pipe(Effect.andThen(Effect.sleep(ACTIVITY_POLL_INTERVAL)))).pipe(
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(make).pipe(Layer.provide(ProcessRunner.layer));
