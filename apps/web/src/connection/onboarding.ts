import { ConnectionOnboarding } from "@kata-sh/code-client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@kata-sh/code-client-runtime/state/runtime";
import { EnvironmentId } from "@kata-sh/code-contracts";
import type { DesktopSshEnvironmentTarget } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();

export const connectPairing = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:connection:connect-pairing",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { pairingUrl?: string; host?: string; pairingCode?: string }) =>
      JSON.stringify(input),
  },
  execute: (input: {
    readonly pairingUrl?: string;
    readonly host?: string;
    readonly pairingCode?: string;
  }) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerPairing(input))),
});

export const connectRelayEnvironment = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:connection:connect-relay",
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

export const connectSshEnvironment = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:connection:connect-ssh",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: { readonly target: DesktopSshEnvironmentTarget }) => JSON.stringify(input.target),
  },
  execute: (input: { readonly target: DesktopSshEnvironmentTarget; readonly label?: string }) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerSsh(input))),
});
