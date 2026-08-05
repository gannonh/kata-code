import type { OrchestrationEvent } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
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

export const TaskWorkspaceCompletionReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const taskWorkspaces = yield* TaskWorkspaceService;
    yield* taskWorkspaces.reconcilePendingProposals;
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.activity-appended") return Effect.void;
        const outcome = terminalOutcome(event);
        const providerTurnId = event.payload.activity.turnId;
        if (!outcome || providerTurnId === null) return Effect.void;
        return taskWorkspaces
          .settleProviderTurn({
            threadId: event.payload.threadId,
            providerTurnId,
            outcome,
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("task workspace completion settlement failed", {
                taskId: event.payload.threadId,
                turnId: providerTurnId,
                eventType: event.type,
                cause: cause.message,
              }),
            ),
          );
      }),
    );
  }),
);
