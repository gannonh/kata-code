// @effect-diagnostics deterministicKeys:off - FORK.md retains internal upstream service identifiers.
import type { ThreadId } from "@kata-sh/code-contracts";
import * as KeyedLock from "@kata-sh/code-shared/KeyedLock";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/** Shared by thread commands and project deletion so both plan against current thread state. */
export class ThreadCommandExecutor extends Context.Service<
  ThreadCommandExecutor,
  KeyedLock.KeyedLock<ThreadId>
>()("t3/orchestration-v2/ThreadCommandExecutor") {}

export const layer = Layer.effect(ThreadCommandExecutor, KeyedLock.make<ThreadId>());
