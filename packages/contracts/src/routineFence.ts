import * as Schema from "effect/Schema";

import {
  CommandId,
  MessageId,
  ThreadId,
  TrimmedNonEmptyString,
  PositiveInt,
} from "./baseSchemas.ts";

export const RoutineRunId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineRunId"));
export type RoutineRunId = typeof RoutineRunId.Type;
export const RoutineOwnerGeneration = PositiveInt.pipe(Schema.brand("RoutineOwnerGeneration"));
export type RoutineOwnerGeneration = typeof RoutineOwnerGeneration.Type;

/** Exact durable ownership proof carried through orchestration into a provider adapter. */
export const RoutineProviderSubmission = Schema.Struct({
  runId: RoutineRunId,
  owner: TrimmedNonEmptyString,
  generation: RoutineOwnerGeneration,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
});
export type RoutineProviderSubmission = typeof RoutineProviderSubmission.Type;
