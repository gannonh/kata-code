import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { ModelSelection } from "@kata-sh/code-contracts";

import type {
  DockerResourceHandle,
  ProviderObservation,
  SandboxBootstrapManifest,
  SandboxConnectorOrigin,
  SandboxDeploymentIntent,
  SandboxEndpoint,
  SandboxProfile,
  SandboxProviderDriverKind,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

export type SandboxDriverErrorReason =
  | "invalid-profile"
  | "daemon-unavailable"
  | "image-unavailable"
  | "allocation-failed"
  | "setup-failed"
  | "observation-failed"
  | "deletion-failed"
  | "lifecycle-failed";

export class SandboxDriverError extends Data.TaggedError("SandboxDriverError")<{
  readonly reason: SandboxDriverErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SandboxValidatedProfile {
  readonly daemonVersion: string;
  readonly imageDigest: string;
}

export interface SandboxAllocationInput {
  readonly profile: SandboxProfile;
  readonly intent: SandboxDeploymentIntent;
  readonly manifest: SandboxBootstrapManifest;
  readonly codexAuthJson: Uint8Array;
  readonly modelSelection?: ModelSelection;
  readonly bootstrapToken?: string;
}

export interface SandboxIdentifiedFacts {
  readonly environmentId: string;
  readonly endpoint: SandboxEndpoint;
  readonly connectorOrigin?: SandboxConnectorOrigin;
  readonly workspaceRoot: string;
  readonly resource: DockerResourceHandle;
}

export interface SandboxStartedFacts {
  readonly environmentId: string;
  readonly endpoint: SandboxEndpoint;
  readonly connectorOrigin?: SandboxConnectorOrigin;
  readonly resource: DockerResourceHandle;
}

export interface SandboxProviderResourceInput {
  readonly profile: SandboxProfile;
  readonly resource: DockerResourceHandle;
  readonly intent?: SandboxDeploymentIntent;
  readonly expectedEnvironmentId?: string;
}

export interface SandboxProviderPowerCapability {
  readonly inspect: (
    input: SandboxProviderResourceInput,
  ) => Effect.Effect<ProviderObservation, SandboxDriverError>;
  readonly stop: (
    input: SandboxProviderResourceInput,
  ) => Effect.Effect<ProviderObservation, SandboxDriverError>;
  readonly start: (
    input: SandboxProviderResourceInput,
  ) => Effect.Effect<SandboxStartedFacts | ProviderObservation, SandboxDriverError>;
  readonly adopt?: (
    input: SandboxProviderResourceInput,
  ) => Effect.Effect<DockerResourceHandle | ProviderObservation, SandboxDriverError>;
}

export interface SandboxProviderDriver {
  readonly kind: SandboxProviderDriverKind;
  readonly validateProfile: (
    profile: SandboxProfile,
  ) => Effect.Effect<SandboxValidatedProfile, SandboxDriverError>;
  readonly allocate: (
    input: SandboxAllocationInput,
  ) => Effect.Effect<DockerResourceHandle, SandboxDriverError>;
  readonly identify: (
    input: SandboxAllocationInput & { readonly resource: DockerResourceHandle },
  ) => Effect.Effect<SandboxIdentifiedFacts, SandboxDriverError>;
  readonly observe: (input: {
    readonly profile: SandboxProfile;
    readonly resource: DockerResourceHandle;
  }) => Effect.Effect<ProviderObservation, SandboxDriverError>;
  readonly delete: (input: {
    readonly profile: SandboxProfile;
    readonly resource: DockerResourceHandle;
  }) => Effect.Effect<ProviderObservation, SandboxDriverError>;
  readonly power?: SandboxProviderPowerCapability;
}
