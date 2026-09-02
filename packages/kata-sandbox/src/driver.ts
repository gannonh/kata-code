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
  SandboxOperationProgress,
  SandboxProfile,
  SandboxProviderDescriptor,
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

export interface SandboxBootstrapFacts {
  readonly kataVersion: string;
  readonly serverVersion: string;
  readonly serverArtifactSha256: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
}

export interface SandboxValidatedProfile extends SandboxBootstrapFacts {
  readonly daemonVersion: string;
  readonly imageDigest: string;
}

export type SandboxValidationProgressReporter = (
  progress: Extract<
    SandboxOperationProgress,
    { readonly stage: "pulling-image" | "validating-image" }
  >,
) => Effect.Effect<void>;

export interface SandboxValidationOptions {
  readonly pullIfMissing?: boolean;
}

export interface SandboxAllocationInput {
  readonly profile: SandboxProfile;
  readonly intent: SandboxDeploymentIntent;
  readonly manifest: SandboxBootstrapManifest;
  readonly codexAuthJson: Uint8Array;
  readonly modelSelection?: ModelSelection;
  readonly bootstrapToken?: string;
}

/**
 * A short-lived capability for checkout code that needs the host GitHub
 * credential. The token only exists for the callback's lifetime and is never
 * part of a sandbox allocation input or persisted deployment state.
 */
export interface SandboxGitHubCheckoutCredential {
  readonly withToken: <A, E, R>(
    use: (token: Uint8Array) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SandboxDriverError, R>;
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
  readonly descriptor: SandboxProviderDescriptor;
  readonly validateProfile: (
    profile: SandboxProfile,
    reportProgress?: SandboxValidationProgressReporter,
    options?: SandboxValidationOptions,
  ) => Effect.Effect<SandboxValidatedProfile, SandboxDriverError>;
  readonly probeHost?: () => Effect.Effect<
    { readonly daemonVersion: string },
    SandboxDriverError
  >;
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
