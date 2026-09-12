import type { EnvironmentId } from "@kata-sh/code-contracts";
import { WS_METHODS } from "@kata-sh/code-contracts";
import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  type AtomCommandConcurrency,
} from "./runtime.ts";

/**
 * Client state for scheduled routines.
 *
 * Every operation keeps the environment in its key. The browser can aggregate
 * these atoms for its library view, but the server that owns the environment
 * remains the only place where a routine is read or changed.
 */
export function createRoutineEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const changes = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:routines:changes",
    tag: WS_METHODS.routinesSubscribe,
    idleTtlMs: 0,
  });

  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:routines:list",
    tag: WS_METHODS.routinesList,
    staleTimeMs: 0,
    refreshTrigger: ({ environmentId }) => changes({ environmentId, input: {} }),
  });

  const get = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:routines:get",
    tag: WS_METHODS.routinesGet,
    staleTimeMs: 0,
  });

  const history = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:routines:history",
    tag: WS_METHODS.routinesHistory,
    staleTimeMs: 0,
    refreshTrigger: ({ environmentId }) => changes({ environmentId, input: {} }),
  });

  const preview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:routines:preview",
    tag: WS_METHODS.routinesPreview,
    staleTimeMs: 0,
  });

  const mutationConcurrency = {
    mode: "serial",
    key: ({ environmentId, input }: { environmentId: EnvironmentId; input: { id: string } }) =>
      JSON.stringify([environmentId, input.id]),
  } satisfies AtomCommandConcurrency<{ environmentId: EnvironmentId; input: { id: string } }>;

  const save = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:routines:save",
    tag: WS_METHODS.routinesSave,
    concurrency: mutationConcurrency,
  });

  const change = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:routines:change",
    tag: WS_METHODS.routinesChange,
    concurrency: mutationConcurrency,
  });

  const test = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:routines:test",
    tag: WS_METHODS.routinesTest,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId, input }) => JSON.stringify([environmentId, input.id, input.requestId]),
    },
  });

  return { changes, list, get, history, preview, save, change, test };
}
