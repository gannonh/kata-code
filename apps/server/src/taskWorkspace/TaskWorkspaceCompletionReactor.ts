import type { OrchestrationEvent, ProviderRuntimeEvent } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { TaskWorkspaceService } from "./TaskWorkspaceService.ts";

type ActivityAppendedEvent = Extract<
  OrchestrationEvent,
  { readonly type: "thread.activity-appended" }
>;

function terminalOutcome(
  event: ActivityAppendedEvent,
): "completed" | "aborted" | "failed" | undefined {
  if (event.payload.activity.kind !== "provider-turn-terminal") return undefined;
  const outcome = (event.payload.activity.payload as { readonly outcome?: unknown }).outcome;
  return outcome === "completed" || outcome === "aborted" || outcome === "failed"
    ? outcome
    : undefined;
}

function runtimeTerminalOutcome(
  event: ProviderRuntimeEvent,
): "completed" | "aborted" | "failed" | undefined {
  if (event.type === "turn.aborted") return "aborted";
  if (event.type !== "turn.completed") return undefined;
  return event.payload.state === "failed" ? "failed" : "completed";
}

export const TaskWorkspaceCompletionReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const provider = yield* ProviderService;
    const taskWorkspaces = yield* TaskWorkspaceService;
    const settle = (
      threadId: ProviderRuntimeEvent["threadId"],
      providerTurnId: string,
      outcome: "completed" | "aborted" | "failed",
      eventType: string,
    ) =>
      taskWorkspaces.settleProviderTurn({ threadId, providerTurnId, outcome }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("task workspace completion settlement failed", {
            taskId: threadId,
            turnId: providerTurnId,
            eventType,
            cause: cause.message,
          }),
        ),
        Effect.ignore,
      );
    yield* taskWorkspaces.reconcilePendingProposals;
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        const settleTerminal =
          event.type === "thread.activity-appended"
            ? (() => {
                const outcome = terminalOutcome(event);
                const providerTurnId = event.payload.activity.turnId;
                if (!outcome || providerTurnId === null) return Effect.void;
                return settle(event.payload.threadId, providerTurnId, outcome, event.type);
              })()
            : Effect.void;
        // A completion proposal and its durable terminal activity can be
        // observed in either order. Reconcile after every domain event so the
        // event that makes both records visible closes the proposal without a
        // timing-based retry.
        return settleTerminal.pipe(
          Effect.andThen(
            taskWorkspaces.reconcilePendingProposals.pipe(
              Effect.tapError((cause) =>
                Effect.logWarning("task workspace completion reconciliation failed", {
                  cause: cause.message,
                }),
              ),
              Effect.ignore,
            ),
          ),
        );
      }),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(provider.streamEvents, (event) => {
        const outcome = runtimeTerminalOutcome(event);
        const settlement =
          outcome && event.turnId !== undefined
            ? Effect.logWarning("task workspace completion reactor observed provider terminal", {
                threadId: event.threadId,
                providerTurnId: event.turnId,
                outcome,
                eventType: event.type,
              }).pipe(Effect.andThen(settle(event.threadId, event.turnId, outcome, event.type)))
            : Effect.void;
        return settlement.pipe(
          Effect.andThen(
            taskWorkspaces.reconcilePendingProposals.pipe(
              Effect.tapError((cause) =>
                Effect.logWarning("task workspace completion reconciliation failed", {
                  cause: cause.message,
                }),
              ),
              Effect.ignore,
            ),
          ),
        );
      }),
    );
    // Reconcile persisted proposals after a provider/runtime event can be
    // lost at a process boundary. This only settles proposals against durable
    // terminal activities; it never reruns checks or other external commands.
    yield* Effect.forkScoped(
      Effect.forever(
        taskWorkspaces.reconcilePendingProposals.pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("task workspace completion reconciliation failed", {
              cause: cause.message,
            }),
          ),
          Effect.ignore,
          Effect.andThen(Effect.sleep("1 second")),
        ),
      ),
    );
  }),
);
