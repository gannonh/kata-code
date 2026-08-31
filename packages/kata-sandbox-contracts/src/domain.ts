import {
  EnvironmentId,
  IsoDateTime,
  PositiveInt,
  ProviderInstanceId,
  TrimmedNonEmptyString,
} from "@kata-sh/code-contracts";
import * as Schema from "effect/Schema";

const makeId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const SandboxProviderProfileId = makeId("SandboxProviderProfileId");
export type SandboxProviderProfileId = typeof SandboxProviderProfileId.Type;

export const SandboxDeploymentId = makeId("SandboxDeploymentId");
export type SandboxDeploymentId = typeof SandboxDeploymentId.Type;

export const SandboxOperationId = makeId("SandboxOperationId");
export type SandboxOperationId = typeof SandboxOperationId.Type;

export const SandboxRequestId = makeId("SandboxRequestId");
export type SandboxRequestId = typeof SandboxRequestId.Type;

export const SandboxContainerId = makeId("SandboxContainerId");
export type SandboxContainerId = typeof SandboxContainerId.Type;

export const SandboxContainerName = makeId("SandboxContainerName");
export type SandboxContainerName = typeof SandboxContainerName.Type;

export const SandboxDiagnostic = TrimmedNonEmptyString;
export type SandboxDiagnostic = typeof SandboxDiagnostic.Type;

export const GitHubRepository = TrimmedNonEmptyString.check(
  Schema.isPattern(
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
  ),
);
export type GitHubRepository = typeof GitHubRepository.Type;

export const GitHubRef = TrimmedNonEmptyString;
export type GitHubRef = typeof GitHubRef.Type;

export const CommitSha = TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{40}$/i));
export type CommitSha = typeof CommitSha.Type;

export const UnixSocketPath = TrimmedNonEmptyString.check(Schema.isPattern(/^\/.+/));
export type UnixSocketPath = typeof UnixSocketPath.Type;

export const OciImageDigest = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(?:[a-z0-9][a-z0-9._:/-]*@)?sha256:[0-9a-f]{64}$/),
);
export type OciImageDigest = typeof OciImageDigest.Type;

export const SandboxImageChannel = Schema.Literals(["stable", "nightly"]);
export type SandboxImageChannel = typeof SandboxImageChannel.Type;

export const Sha256Digest = TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{64}$/i));
export type Sha256Digest = typeof Sha256Digest.Type;

export const SandboxProfileName = TrimmedNonEmptyString;
export type SandboxProfileName = typeof SandboxProfileName.Type;

export const SandboxImageVersion = TrimmedNonEmptyString.check(
  Schema.isPattern(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
);
export type SandboxImageVersion = typeof SandboxImageVersion.Type;

export const SandboxDeploymentLabel = TrimmedNonEmptyString;
export type SandboxDeploymentLabel = typeof SandboxDeploymentLabel.Type;

export const SandboxWorkspaceRoot = TrimmedNonEmptyString.check(Schema.isPattern(/^\/.+/));
export type SandboxWorkspaceRoot = typeof SandboxWorkspaceRoot.Type;

export const SandboxEndpoint = Schema.String.check(Schema.isPattern(/^https?:\/\//));
export type SandboxEndpoint = typeof SandboxEndpoint.Type;

export const SandboxProviderDriverKind = Schema.Literals(["docker"]);
export type SandboxProviderDriverKind = typeof SandboxProviderDriverKind.Type;

export const SandboxProviderCategory = Schema.Literals(["local-container", "cloud-provider"]);
export type SandboxProviderCategory = typeof SandboxProviderCategory.Type;

export const SandboxProviderProfileForm = Schema.Literals(["docker", "none"]);
export type SandboxProviderProfileForm = typeof SandboxProviderProfileForm.Type;

export const SandboxProviderDescriptor = Schema.Struct({
  driverKind: SandboxProviderDriverKind,
  category: SandboxProviderCategory,
  displayName: TrimmedNonEmptyString,
  profileForm: SandboxProviderProfileForm,
  availabilityDiagnostic: Schema.optional(SandboxDiagnostic),
});
export type SandboxProviderDescriptor = typeof SandboxProviderDescriptor.Type;

export const SandboxManagedImageInput = Schema.Struct({
  kind: Schema.Literal("managed"),
  channel: SandboxImageChannel,
  version: SandboxImageVersion,
});
export type SandboxManagedImageInput = typeof SandboxManagedImageInput.Type;

export const SandboxCustomImageInput = Schema.Struct({
  kind: Schema.Literal("custom"),
  digest: OciImageDigest,
});
export type SandboxCustomImageInput = typeof SandboxCustomImageInput.Type;

export const SandboxImageInput = Schema.Union([SandboxManagedImageInput, SandboxCustomImageInput]);
export type SandboxImageInput = typeof SandboxImageInput.Type;

export const SandboxProfile = Schema.Struct({
  profileId: SandboxProviderProfileId,
  name: SandboxProfileName,
  driverKind: SandboxProviderDriverKind,
  socketPath: UnixSocketPath,
  /** The only image value persisted by a profile is this resolved immutable reference. */
  imageDigest: OciImageDigest,
  enabled: Schema.Boolean,
  revision: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SandboxProfile = typeof SandboxProfile.Type;

export const SandboxBootstrapManifest = Schema.Struct({
  version: Schema.Literal(1),
  imageDigest: OciImageDigest,
  kataVersion: TrimmedNonEmptyString,
  serverVersion: TrimmedNonEmptyString,
  serverArtifactSha256: Sha256Digest,
  codexVersion: TrimmedNonEmptyString,
  codexArtifactSha256: Sha256Digest,
});
export type SandboxBootstrapManifest = typeof SandboxBootstrapManifest.Type;

export const SandboxProfileInput = Schema.Struct({
  profileId: Schema.optional(SandboxProviderProfileId),
  name: SandboxProfileName,
  driverKind: SandboxProviderDriverKind,
  socketPath: Schema.optional(UnixSocketPath),
  /** Requests select a managed channel/version or a custom immutable digest. */
  image: SandboxImageInput,
  enabled: Schema.Boolean,
  expectedRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SandboxProfileInput = typeof SandboxProfileInput.Type;

export const SandboxProfileAvailabilityReason = Schema.Literals([
  "disabled",
  "daemon-unavailable",
  "image-unavailable",
  "invalid-config",
]);
export type SandboxProfileAvailabilityReason = typeof SandboxProfileAvailabilityReason.Type;

export const SandboxProfileSummary = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("available"),
    profile: SandboxProfile,
    daemonVersion: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    profile: SandboxProfile,
    reason: SandboxProfileAvailabilityReason,
    diagnostic: SandboxDiagnostic,
  }),
]);
export type SandboxProfileSummary = typeof SandboxProfileSummary.Type;

export const ResolvedGitHubSource = Schema.Struct({
  repository: GitHubRepository,
  ref: GitHubRef,
  resolvedCommitSha: CommitSha,
});
export type ResolvedGitHubSource = typeof ResolvedGitHubSource.Type;

export const SandboxOwnership = Schema.Struct({
  controlEnvironmentId: EnvironmentId,
  deploymentId: SandboxDeploymentId,
  profileId: SandboxProviderProfileId,
  profileRevision: PositiveInt,
  schemaVersion: Schema.Literal("v1"),
});
export type SandboxOwnership = typeof SandboxOwnership.Type;

export const DockerResourceHandle = Schema.Struct({
  containerId: SandboxContainerId,
  containerName: SandboxContainerName,
  /** Docker assigns an ephemeral host port when the container starts. */
  hostPort: Schema.optionalKey(PositiveInt),
  containerPort: PositiveInt,
  ownership: SandboxOwnership,
});
export type DockerResourceHandle = typeof DockerResourceHandle.Type;

export const SandboxDeploymentIntent = Schema.Struct({
  deploymentId: SandboxDeploymentId,
  controlEnvironmentId: EnvironmentId,
  profileId: SandboxProviderProfileId,
  profileRevision: PositiveInt,
  profileSnapshot: SandboxProfile,
  providerInstanceId: ProviderInstanceId,
  label: SandboxDeploymentLabel,
  source: ResolvedGitHubSource,
  bootstrapManifest: SandboxBootstrapManifest,
  workspaceRoot: SandboxWorkspaceRoot,
  kataHome: SandboxWorkspaceRoot,
  requestedAt: IsoDateTime,
});
export type SandboxDeploymentIntent = typeof SandboxDeploymentIntent.Type;

export const RequestedDeployment = Schema.Struct({
  state: Schema.Literal("Requested"),
  revision: PositiveInt,
  intent: SandboxDeploymentIntent,
});
export type RequestedDeployment = typeof RequestedDeployment.Type;

export const AllocatedDeployment = Schema.Struct({
  state: Schema.Literal("Allocated"),
  revision: PositiveInt,
  intent: SandboxDeploymentIntent,
  resource: DockerResourceHandle,
});
export type AllocatedDeployment = typeof AllocatedDeployment.Type;

export const IdentifiedDeployment = Schema.Struct({
  state: Schema.Literal("Identified"),
  revision: PositiveInt,
  intent: SandboxDeploymentIntent,
  resource: DockerResourceHandle,
  environmentId: EnvironmentId,
  endpoint: SandboxEndpoint,
  workspaceRoot: SandboxWorkspaceRoot,
  kataHome: SandboxWorkspaceRoot,
  identifiedAt: IsoDateTime,
});
export type IdentifiedDeployment = typeof IdentifiedDeployment.Type;

export const DeletedDeployment = Schema.Struct({
  state: Schema.Literal("Deleted"),
  revision: PositiveInt,
  deploymentId: SandboxDeploymentId,
  profileId: SandboxProviderProfileId,
  environmentId: Schema.optional(EnvironmentId),
  deletedAt: IsoDateTime,
});
export type DeletedDeployment = typeof DeletedDeployment.Type;

export const SandboxDeployment = Schema.Union([
  RequestedDeployment,
  AllocatedDeployment,
  IdentifiedDeployment,
  DeletedDeployment,
]);
export type SandboxDeployment = typeof SandboxDeployment.Type;

export const ProviderObservation = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("Running"),
    observedAt: IsoDateTime,
    environmentId: Schema.optional(EnvironmentId),
    endpoint: Schema.optional(SandboxEndpoint),
  }),
  Schema.Struct({
    state: Schema.Literal("Unknown"),
    observedAt: IsoDateTime,
    diagnostic: SandboxDiagnostic,
  }),
  Schema.Struct({
    state: Schema.Literal("Gone"),
    observedAt: IsoDateTime,
  }),
]);
export type ProviderObservation = typeof ProviderObservation.Type;

export const SandboxOperationKind = Schema.Literals([
  "profile-upsert",
  "profile-delete",
  "create",
  "delete",
  "mint-handoff",
]);
export type SandboxOperationKind = typeof SandboxOperationKind.Type;

export const SandboxOperationStatus = Schema.Literals([
  "Accepted",
  "Running",
  "Succeeded",
  "Failed",
]);
export type SandboxOperationStatus = typeof SandboxOperationStatus.Type;

export const SandboxOperationProgressStage = Schema.Literals([
  "resolving-image",
  "pulling-image",
  "validating-image",
  "ready",
  "failed",
]);
export type SandboxOperationProgressStage = typeof SandboxOperationProgressStage.Type;

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const SandboxProgressStageBeforeFailure = Schema.Literals([
  "resolving-image",
  "pulling-image",
  "validating-image",
  "ready",
]);

export const SandboxOperationProgress = Schema.Union([
  Schema.Struct({ stage: Schema.Literal("resolving-image") }),
  Schema.Struct({
    stage: Schema.Literal("pulling-image"),
    downloadedBytes: Schema.optional(NonNegativeInt),
    totalBytes: Schema.optional(Schema.NullOr(NonNegativeInt)),
    layersCompleted: Schema.optional(NonNegativeInt),
    layersTotal: Schema.optional(Schema.NullOr(NonNegativeInt)),
  }),
  Schema.Struct({ stage: Schema.Literal("validating-image") }),
  Schema.Struct({ stage: Schema.Literal("ready") }),
  Schema.Struct({
    stage: Schema.Literal("failed"),
    lastStage: SandboxProgressStageBeforeFailure,
    diagnostic: SandboxDiagnostic,
  }),
]);
export type SandboxOperationProgress = typeof SandboxOperationProgress.Type;

export const SandboxOperationResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("profile"),
    profileId: SandboxProviderProfileId,
  }),
  Schema.Struct({
    kind: Schema.Literal("deployment"),
    deploymentId: SandboxDeploymentId,
    environmentId: Schema.optional(EnvironmentId),
    endpoint: Schema.optional(SandboxEndpoint),
  }),
  Schema.Struct({
    kind: Schema.Literal("deleted"),
    deploymentId: SandboxDeploymentId,
    environmentId: Schema.optional(EnvironmentId),
  }),
]);
export type SandboxOperationResult = typeof SandboxOperationResult.Type;

export const SandboxOperationReceipt = Schema.Struct({
  operationId: SandboxOperationId,
  requestId: SandboxRequestId,
  command: SandboxOperationKind,
  payloadHash: TrimmedNonEmptyString,
  status: SandboxOperationStatus,
  deploymentId: Schema.optional(SandboxDeploymentId),
  profileId: Schema.optional(SandboxProviderProfileId),
  profileInput: Schema.optional(SandboxProfileInput),
  /** The revision observed by a create or delete command, when supplied by the client. */
  expectedRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** Resolved before profile persistence so a replay never follows a moved tag. */
  resolvedImageDigest: Schema.optional(OciImageDigest),
  progress: Schema.optionalKey(SandboxOperationProgress),
  result: Schema.optional(SandboxOperationResult),
  error: Schema.optional(SandboxDiagnostic),
  acceptedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SandboxOperationReceipt = typeof SandboxOperationReceipt.Type;

export const SandboxHandoff = Schema.Struct({
  deploymentId: SandboxDeploymentId,
  environmentId: EnvironmentId,
  endpoint: SandboxEndpoint,
  pairingUrl: Schema.String,
  workspaceRoot: SandboxWorkspaceRoot,
  expiresAt: IsoDateTime,
});
export type SandboxHandoff = typeof SandboxHandoff.Type;

export const SandboxProviderLabels = {
  controlEnvironmentId: "com.katacode.sandbox.control-environment-id",
  deploymentId: "com.katacode.sandbox.deployment-id",
  profileId: "com.katacode.sandbox.profile-id",
  profileRevision: "com.katacode.sandbox.profile-revision",
  schemaVersion: "com.katacode.sandbox.schema-version",
} as const;

export type SandboxOwnershipLabels = Readonly<{
  readonly [SandboxProviderLabels.controlEnvironmentId]: EnvironmentId;
  readonly [SandboxProviderLabels.deploymentId]: SandboxDeploymentId;
  readonly [SandboxProviderLabels.profileId]: SandboxProviderProfileId;
  readonly [SandboxProviderLabels.profileRevision]: typeof PositiveInt.Type;
  readonly [SandboxProviderLabels.schemaVersion]: "v1";
}>;

export const DEFAULT_DOCKER_SOCKET_PATH = "/var/run/docker.sock";
export const DEFAULT_SANDBOX_CONTAINER_PORT = 3773;
export const DEFAULT_SANDBOX_WORKSPACE_ROOT = "/workspace";
export const DEFAULT_SANDBOX_KATA_HOME = "/var/lib/katacode";
export const SANDBOX_HANDOFF_TTL_SECONDS = 5 * 60;
