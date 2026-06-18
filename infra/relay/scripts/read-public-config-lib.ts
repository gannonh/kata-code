import * as State from "alchemy/State/State";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { publicConfigFromOutput } from "./relay-public-config.ts";

const ALCHEMY_STACK = "T3CodeRelay";

export class RelayPublicConfigReadError extends Data.TaggedError("RelayPublicConfigReadError")<{
  readonly message: string;
}> {}

export const readRelayPublicConfigFromAlchemyState = Effect.fn(
  "relay.readPublicConfig.fromAlchemyState",
)(function* (stage: string) {
  const state = yield* State.State;
  const service = yield* state;
  const output = yield* service.getOutput({ stack: ALCHEMY_STACK, stage });
  const publicConfig = publicConfigFromOutput(output);
  if (publicConfig === null) {
    return yield* new RelayPublicConfigReadError({
      message: `Alchemy relay state for stage ${stage} did not include complete public client config`,
    });
  }
  return publicConfig;
});
