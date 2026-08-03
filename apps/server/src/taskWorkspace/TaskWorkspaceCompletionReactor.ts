import type { ProviderRuntimeEvent } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProviderService } from "../provider/Services/ProviderService.ts";
import { TaskWorkspaceService } from "./TaskWorkspaceService.ts";

function terminalOutcome(
  event: ProviderRuntimeEvent,
): "completed" | "aborted" | "failed" | undefined {
  switch (event.type) {
    case "turn.completed":
      return event.payload.state === "completed" ? "completed" : "failed";
    case "turn.aborted":
      return "aborted";
    default:
      return undefined;
  }
}

export const TaskWorkspaceCompletionReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const provider = yield* ProviderService;
    const taskWorkspaces = yield* TaskWorkspaceService;
    yield* taskWorkspaces.reconcilePendingProposals;
    yield* Effect.forkScoped(
      Stream.runForEach(provider.streamEvents, (event) => {
        const outcome = terminalOutcome(event);
        if (!outcome || event.turnId === undefined) return Effect.void;
        return taskWorkspaces
          .settleProviderTurn({
            threadId: event.threadId,
            providerTurnId: event.turnId,
            outcome,
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("task workspace completion settlement failed", {
                taskId: event.threadId,
                turnId: event.turnId,
                eventType: event.type,
                cause: cause.message,
              }),
            ),
          );
      }),
    );
  }),
);
