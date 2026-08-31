import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { ModelSelection } from "@kata-sh/code-contracts";

import type {
  DockerResourceHandle,
  ProviderObservation,
  SandboxBootstrapManifest,
  SandboxDeploymentIntent,
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
  | "deletion-failed";

export class SandboxDriverError extends Data.TaggedError("SandboxDriverError")<{
  readonly reason: SandboxDriverErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SandboxValidatedProfile {
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

export interface SandboxIdentifiedFacts {
  readonly environmentId: string;
  readonly endpoint: string;
  readonly workspaceRoot: string;
  readonly resource: DockerResourceHandle;
}

export interface SandboxProviderDriver {
  readonly kind: SandboxProviderDriverKind;
  readonly descriptor: SandboxProviderDescriptor;
  readonly validateProfile: (
    profile: SandboxProfile,
    reportProgress?: SandboxValidationProgressReporter,
    options?: SandboxValidationOptions,
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
}
