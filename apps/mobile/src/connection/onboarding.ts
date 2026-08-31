import { ConnectionOnboarding } from "@kata-sh/code-client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@kata-sh/code-client-runtime/state/runtime";
import { EnvironmentId } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();

export const connectPairingUrl = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-pairing-url",
  scheduler: onboardingScheduler,
  concurrency: { mode: "singleFlight", key: (pairingUrl: string) => pairingUrl },
  execute: (pairingUrl: string) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing({ pairingUrl })),
    ),
});

export const connectRelayEnvironment = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-relay",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly environmentId: string }) => input.environmentId,
  },
  execute: (input: { readonly environmentId: string; readonly label: string }) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) =>
        onboarding.registerRelay({
          environmentId: EnvironmentId.make(input.environmentId),
          label: input.label,
        }),
      ),
    ),
});

export const updateBearerConnection = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:update-bearer",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
  },
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly httpBaseUrl: string;
  }) => ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.updateBearer(input))),
});
