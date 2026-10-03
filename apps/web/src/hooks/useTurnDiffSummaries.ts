import { useMemo } from "react";
import { deriveThreadCheckpointSummaries } from "@kata-sh/code-client-runtime/state/thread-checkpoints";
import type { OrchestrationV2ThreadProjection } from "@kata-sh/code-contracts";
import { inferCheckpointTurnCountByRunId } from "../session-logic";
import type { TurnDiffSummary } from "../types";

export function useTurnDiffSummaries(projection: OrchestrationV2ThreadProjection | null) {
  const turnDiffSummaries = useMemo<ReadonlyArray<TurnDiffSummary>>(() => {
    if (projection === null) {
      return [];
    }
    return deriveThreadCheckpointSummaries(projection);
  }, [projection]);

  const inferredCheckpointTurnCountByRunId = useMemo(
    () => inferCheckpointTurnCountByRunId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  return { turnDiffSummaries, inferredCheckpointTurnCountByRunId };
}
