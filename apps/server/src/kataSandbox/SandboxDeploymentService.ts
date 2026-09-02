// @effect-diagnostics globalDate:off - operation timestamps use the injectable service clock.
// @effect-diagnostics nodeBuiltinImport:off - bootstrap tokens and request hashes use Node primitives.
// @effect-diagnostics preferSchemaOverJson:off - request hashes and private target HTTP bodies are JSON.
import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";

import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthPairingCredentialResult,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthTokenExchangeGrantType,
  EnvironmentId,
} from "@kata-sh/code-contracts";
import {
  DEFAULT_DOCKER_SOCKET_PATH,
  DEFAULT_SANDBOX_CONTAINER_PORT,
  DEFAULT_SANDBOX_KATA_HOME,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  type DockerResourceHandle,
  type SandboxDeployment,
  type SandboxDeploymentIntent,
  SandboxDeploymentId,
  SandboxEndpoint,
  SandboxOperationId,
  type SandboxConnectorOrigin,
  type SandboxOperationReceipt,
  type SandboxProfile,
  type SandboxImageInput,
  type SandboxOperationProgress,
  type SandboxProfileInput,
  SandboxProviderProfileId,
  type AllocatedDeployment,
  type IdentifiedDeployment,
  type ProviderObservation,
  type RequestedDeployment,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  type SandboxCreateRequest,
  type SandboxDeleteRequest,
  type SandboxListResponse,
  type SandboxStartRequest,
  type SandboxStopRequest,
  type SandboxProfileDeleteRequest,
  type SandboxProfileUpsertRequest,
  type SandboxAccepted,
} from "@kata-sh/code-kata-sandbox-contracts/http";
import type {
  SandboxAttachment,
  SandboxHandoff,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  allocateDeployment,
  deleteDeployment,
  identifyDeployment,
  redactDiagnostic,
  requestDeployment,
  resolveManagedImage,
  makeOciRegistry,
  DEFAULT_MANAGED_IMAGE_REPOSITORY,
  SandboxDriverError,
  type SandboxBootstrapFacts,
  type ManagedImageRegistry,
  type SandboxProviderDriver,
} from "@kata-sh/code-kata-sandbox";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import {
  RelayEnvironmentLinkChallengeResponse,
  RelayEnvironmentLinkResponse,
} from "@kata-sh/code-contracts/relay";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { relayUrlConfig } from "../cloud/publicConfig.ts";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { resolveHeadlessConnectionHost } from "../startupAccess.ts";
import { makeDockerSandboxDriver, publishHostForBind } from "@kata-sh/code-kata-sandbox-docker";
import packageJson from "../../package.json" with { type: "json" };
import { SandboxProviderRegistry } from "@kata-sh/code-kata-sandbox";
import {
  SandboxDeploymentRepository,
  type SandboxAcceptedOperation,
  type SandboxDeploymentRepositoryShape,
  SandboxRepositoryConflictError,
} from "./SandboxDeploymentRepository.ts";
import { layer as sandboxDeploymentRepositoryLayer } from "./SandboxDeploymentRepository.ts";
import {
  SandboxCredentialSeed,
  type SandboxCredentialSeedValue,
  type SandboxCredentialSeedShape,
} from "./SandboxCredentialSeed.ts";
import { layer as sandboxCredentialSeedLayer } from "./SandboxCredentialSeed.ts";
import { buildSandboxBootstrapManifest } from "./SandboxBootstrapManifest.ts";
import { SandboxGitHubAccess, type SandboxGitHubAccessShape } from "./SandboxGitHubAccess.ts";
import { layer as sandboxGitHubAccessLayer } from "./SandboxGitHubAccess.ts";

export type SandboxDeploymentServiceErrorKind = "conflict" | "not-found" | "command";

export class SandboxDeploymentServiceError extends Data.TaggedError(
  "SandboxDeploymentServiceError",
)<{
  readonly kind: SandboxDeploymentServiceErrorKind;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SandboxPairingCredential {
  readonly credential: string;
  readonly expiresAt: string;
}

export interface SandboxPairingCredentialInput {
  readonly endpoint: string;
  readonly bootstrapToken: string;
  readonly label: string;
  readonly scopes?: ReadonlyArray<"relay:read" | "relay:write">;
}

export interface SandboxDeploymentServiceDependencies {
  readonly repository: SandboxDeploymentRepositoryShape;
  readonly environment: Pick<ServerEnvironment.ServerEnvironment["Service"], "getEnvironmentId">;
  readonly cloudCliTokenManager?: CliTokenManager.CloudCliTokenManager["Service"];
  readonly githubAccess: Pick<SandboxGitHubAccessShape, "resolve" | "checkoutCredential">;
  readonly credentialSeed: SandboxCredentialSeedShape;
  readonly secretStore: ServerSecretStore.ServerSecretStore["Service"];
  readonly crypto: Crypto.Crypto;
  readonly httpClient?: HttpClient.HttpClient;
  readonly managedImageRegistry?: ManagedImageRegistry;
  readonly providerRegistry?: SandboxProviderRegistry;
}

export interface SandboxDeploymentServiceOptions {
  readonly driverFor?: (profile: SandboxProfile) => SandboxProviderDriver;
  readonly endpointHost?: string;
  readonly publishHost?: string;
  readonly sandboxImageRepository?: string;
  readonly hostAvailability?: () => Effect.Effect<string | undefined>;
  readonly relayUrl?: string;
  readonly bootstrapManifestFor?: (
    profile: SandboxProfile,
    facts?: SandboxBootstrapFacts,
  ) => SandboxDeploymentIntent["bootstrapManifest"];
  readonly now?: () => string;
  readonly schedule?: (effect: Effect.Effect<void, never>) => Effect.Effect<void, never>;
  readonly operationScope?: Scope.Scope;
  readonly bootstrapTokenFor?: (
    deploymentId: SandboxDeploymentId,
  ) => Effect.Effect<string, SandboxDeploymentServiceError>;
  readonly issuePairingCredential?: (
    input: SandboxPairingCredentialInput,
  ) => Effect.Effect<SandboxPairingCredential, SandboxDeploymentServiceError>;
  readonly managedImageRegistry?: ManagedImageRegistry;
  readonly providerRegistry?: SandboxProviderRegistry;
}

export interface SandboxDeploymentServiceShape {
  readonly list: () => Effect.Effect<SandboxListResponse, SandboxDeploymentServiceError>;
  readonly upsertProfile: (
    actor: string,
    input: SandboxProfileUpsertRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly deleteProfile: (
    actor: string,
    input: SandboxProfileDeleteRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly create: (
    actor: string,
    input: SandboxCreateRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly start: (
    actor: string,
    input: SandboxStartRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly stop: (
    actor: string,
    input: SandboxStopRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly delete: (
    actor: string,
    input: SandboxDeleteRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly getOperation: (
    operationId: SandboxOperationId,
  ) => Effect.Effect<SandboxOperationReceipt, SandboxDeploymentServiceError>;
  readonly mintHandoff: (
    deploymentId: SandboxDeploymentId,
    attachment?: SandboxAttachment,
  ) => Effect.Effect<SandboxHandoff, SandboxDeploymentServiceError>;
  readonly reconcile: () => Effect.Effect<void, SandboxDeploymentServiceError>;
  readonly recover: () => Effect.Effect<void, SandboxDeploymentServiceError>;
}

const BOOTSTRAP_SECRET_PREFIX = "kata-sandbox-bootstrap-";
const decodeAuthPairingCredentialResult = Schema.decodeUnknownEffect(AuthPairingCredentialResult);

const asServiceError = (cause: unknown): SandboxDeploymentServiceError => {
  if (cause instanceof SandboxDeploymentServiceError) return cause;
  if (cause instanceof SandboxRepositoryConflictError) {
    return new SandboxDeploymentServiceError({
      kind: "conflict",
      message: cause.message,
      cause,
    });
  }
  if (cause instanceof SandboxDriverError) {
    return new SandboxDeploymentServiceError({
      kind: "command",
      message: cause.message,
      cause,
    });
  }
  return new SandboxDeploymentServiceError({
    kind: "command",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
};

const failConflict = (message: string): Effect.Effect<never, SandboxDeploymentServiceError> =>
  Effect.fail(new SandboxDeploymentServiceError({ kind: "conflict", message }));

const failNotFound = (message: string): Effect.Effect<never, SandboxDeploymentServiceError> =>
  Effect.fail(new SandboxDeploymentServiceError({ kind: "not-found", message }));

const failCommand = (
  message: string,
  cause?: unknown,
): Effect.Effect<never, SandboxDeploymentServiceError> =>
  Effect.fail(
    new SandboxDeploymentServiceError({ kind: "command", message, ...(cause ? { cause } : {}) }),
  );

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function operationResultForDeleted(deployment: SandboxDeployment) {
  return {
    kind: "deleted" as const,
    deploymentId:
      deployment.state === "Deleted" ? deployment.deploymentId : deployment.intent.deploymentId,
    ...(deployment.state === "Deleted" && deployment.environmentId
      ? { environmentId: deployment.environmentId }
      : {}),
  };
}

export function probeSandboxHostAvailability(input: {
  readonly driver: SandboxProviderDriver;
  readonly registry: ManagedImageRegistry;
  readonly serverVersion: string;
}): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    if (input.driver.probeHost !== undefined) {
      const daemon = yield* input.driver.probeHost().pipe(Effect.result);
      if (daemon._tag === "Failure") return diagnostic(daemon.failure);
    }
    const resolved = yield* resolveManagedImage(
      { serverVersion: input.serverVersion, channel: "stable" },
      input.registry,
    ).pipe(Effect.result);
    if (resolved._tag === "Failure") {
      return `Managed image for version ${input.serverVersion} was not found.`;
    }
    return undefined;
  }).pipe(Effect.catchDefect((defect) => Effect.succeed(diagnostic(defect))));
}

function driverAvailabilityReason(
  error: SandboxDriverError,
): "daemon-unavailable" | "image-unavailable" | "invalid-config" {
  switch (error.reason) {
    case "invalid-profile":
      return "invalid-config";
    case "image-unavailable":
      return "image-unavailable";
    default:
      return "daemon-unavailable";
  }
}

function diagnostic(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : redactDiagnostic(cause);
  return message.trim().slice(0, 500) || "The sandbox operation failed.";
}

function resourceIdentityMatches(left: DockerResourceHandle, right: DockerResourceHandle): boolean {
  return (
    left.containerId === right.containerId &&
    left.containerName === right.containerName &&
    left.containerPort === right.containerPort &&
    left.ownership.controlEnvironmentId === right.ownership.controlEnvironmentId &&
    left.ownership.deploymentId === right.ownership.deploymentId &&
    left.ownership.profileId === right.ownership.profileId &&
    left.ownership.profileRevision === right.ownership.profileRevision &&
    left.ownership.schemaVersion === right.ownership.schemaVersion
  );
}

function resourceMatches(left: DockerResourceHandle, right: DockerResourceHandle): boolean {
  return resourceIdentityMatches(left, right) && left.hostPort === right.hostPort;
}

function connectorOriginMatches(
  left: SandboxConnectorOrigin | undefined,
  right: SandboxConnectorOrigin | undefined,
): boolean {
  return (
    left?.localHttpHost === right?.localHttpHost && left?.localHttpPort === right?.localHttpPort
  );
}

function endpointPairingUrl(endpoint: string, credential: string): string {
  const url = new URL(endpoint);
  url.pathname = "/pair";
  url.search = "";
  url.hash = new URLSearchParams([["token", credential]]).toString();
  return url.toString();
}

function localDockerEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.hostname = url.hostname.includes(":") ? "[::1]" : "127.0.0.1";
  return url.origin;
}

function targetPairingLabel(deploymentId: SandboxDeploymentId): string {
  return `Kata Code sandbox ${deploymentId}`;
}

function imageSelection(input: SandboxProfileInput): SandboxImageInput {
  return input.image;
}

function profileMatchesInput(
  profile: SandboxProfile,
  input: SandboxProfileInput,
  resolvedImageDigest?: string,
): boolean {
  return (
    profile.name === input.name &&
    profile.driverKind === input.driverKind &&
    profile.socketPath === (input.socketPath ?? DEFAULT_DOCKER_SOCKET_PATH) &&
    profile.enabled === input.enabled &&
    (input.image.kind === "custom"
      ? profile.imageDigest === input.image.digest
      : resolvedImageDigest === undefined || profile.imageDigest === resolvedImageDigest)
  );
}

const decodeTargetPairing = (value: unknown) =>
  decodeAuthPairingCredentialResult(value).pipe(
    Effect.map((decoded) => ({
      credential: decoded.credential,
      expiresAt: DateTime.formatIso(decoded.expiresAt),
    })),
  );

function issueTargetPairingCredential(
  input: SandboxPairingCredentialInput,
): Effect.Effect<SandboxPairingCredential, SandboxDeploymentServiceError> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* Effect.gen(function* () {
      const response = yield* client.execute(
        HttpClientRequest.post(
          new URL("/api/kata-sandbox/bootstrap-pairing-token", input.endpoint),
        ).pipe(
          HttpClientRequest.bearerToken(input.bootstrapToken),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJsonUnsafe({
            label: input.label,
            ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
          }),
        ),
      );
      if (response.status < 200 || response.status >= 300) {
        return yield* new SandboxDeploymentServiceError({
          kind: "command",
          message: `Sandbox pairing credential request returned HTTP ${response.status}.`,
        });
      }
      return yield* decodeTargetPairing(yield* response.json);
    }).pipe(Effect.timeout("30 seconds"));
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof SandboxDeploymentServiceError
        ? cause
        : new SandboxDeploymentServiceError({
            kind: "command",
            message: diagnostic(cause),
            cause,
          }),
    ),
    Effect.provide(FetchHttpClient.layer),
  );
}

export function makeSandboxDeploymentService(
  dependencies: SandboxDeploymentServiceDependencies,
  options: SandboxDeploymentServiceOptions = {},
): SandboxDeploymentServiceShape {
  const repository = dependencies.repository;
  const endpointHost = options.endpointHost ?? "127.0.0.1";
  const defaultDriver = makeDockerSandboxDriver({
    endpointHost,
    publishHost: options.publishHost ?? "127.0.0.1",
    checkoutCredential: dependencies.githubAccess.checkoutCredential,
  });
  const driverFor = options.driverFor ?? (() => defaultDriver);
  const providerRegistry =
    options.providerRegistry ??
    dependencies.providerRegistry ??
    new SandboxProviderRegistry([defaultDriver]);
  const managedImageRegistry =
    options.managedImageRegistry ??
    dependencies.managedImageRegistry ??
    makeOciRegistry({
      repository: options.sandboxImageRepository?.trim() || DEFAULT_MANAGED_IMAGE_REPOSITORY,
      ...(dependencies.httpClient === undefined ? {} : { httpClient: dependencies.httpClient }),
    });
  const bootstrapManifestFor =
    options.bootstrapManifestFor ??
    ((profile, facts) => {
      if (facts === undefined) {
        throw new Error("Sandbox bootstrap facts are required to build a manifest.");
      }
      return buildSandboxBootstrapManifest(profile, facts);
    });
  const hostAvailability = options.hostAvailability ?? (() => Effect.succeed(undefined));
  const now = options.now ?? (() => new Date().toISOString());
  const operationScope = options.operationScope;
  const schedule: (effect: Effect.Effect<void, never>) => Effect.Effect<void, never> =
    options.schedule ??
    ((effect) =>
      operationScope === undefined
        ? Effect.die("Sandbox deployment service requires an operation scope.")
        : Effect.forkIn(effect, operationScope).pipe(Effect.asVoid));

  const bootstrapTokenFor =
    options.bootstrapTokenFor ??
    ((deploymentId: SandboxDeploymentId) =>
      Effect.gen(function* () {
        const name = BOOTSTRAP_SECRET_PREFIX + deploymentId;
        const bytes = yield* dependencies.secretStore
          .getOrCreateRandom(name, 32)
          .pipe(Effect.mapError((cause) => asServiceError(cause)));
        return NodeBuffer.Buffer.from(bytes).toString("base64url");
      }));

  const issuePairingCredential = options.issuePairingCredential ?? issueTargetPairingCredential;
  const workerId = NodeCrypto.randomUUID();
  const deploymentLocks = new Map<string, Semaphore.Semaphore>();
  const lockFor = (deploymentId: SandboxDeploymentId) => {
    const key = String(deploymentId);
    const existing = deploymentLocks.get(key);
    if (existing !== undefined) return existing;
    const created = Semaphore.makeUnsafe(1);
    deploymentLocks.set(key, created);
    return created;
  };
  const withDeploymentLock = <A>(
    deploymentId: SandboxDeploymentId,
    effect: Effect.Effect<A, SandboxDeploymentServiceError>,
  ) => lockFor(deploymentId).withPermits(1)(effect);

  const getProfile = (profileId: SandboxProviderProfileId) =>
    repository.getProfile(profileId).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((profile) =>
        Option.isSome(profile)
          ? Effect.succeed(profile.value)
          : failNotFound(`Sandbox profile '${profileId}' was not found.`),
      ),
    );

  const getDeployment = (deploymentId: SandboxDeploymentId) =>
    repository.getDeployment(deploymentId).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((deployment) =>
        Option.isSome(deployment)
          ? Effect.succeed(deployment.value)
          : failNotFound(`Sandbox deployment '${deploymentId}' was not found.`),
      ),
    );

  const saveClaimedOperation = (receipt: SandboxOperationReceipt, claimId: string) =>
    repository.saveClaimedOperation(receipt, claimId).pipe(Effect.mapError(asServiceError));

  const createReceipt = (
    operationId: SandboxOperationId,
    requestId:
      | SandboxCreateRequest["requestId"]
      | SandboxStartRequest["requestId"]
      | SandboxStopRequest["requestId"]
      | SandboxDeleteRequest["requestId"]
      | SandboxProfileDeleteRequest["requestId"]
      | SandboxProfileUpsertRequest["requestId"],
    command: SandboxOperationReceipt["command"],
    hash: string,
    deploymentId?: SandboxDeploymentId,
    attachment?: SandboxAttachment,
    expectedRevision?: number,
  ): SandboxOperationReceipt => ({
    operationId,
    requestId,
    command,
    payloadHash: hash,
    status: "Accepted",
    ...(deploymentId ? { deploymentId } : {}),
    ...(attachment ? { attachment } : {}),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    acceptedAt: now(),
    updatedAt: now(),
  });

  const acceptOperation = (input: {
    readonly actor: string;
    readonly receipt: SandboxOperationReceipt;
    readonly deployment?: RequestedDeployment;
  }) =>
    repository.accept(input satisfies SandboxAcceptedOperation).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((accepted) =>
        accepted.payloadHash !== input.receipt.payloadHash
          ? failConflict("The request id was already used for a different sandbox command.")
          : Effect.succeed({
              receipt: accepted,
              created: accepted.operationId === input.receipt.operationId,
            }),
      ),
    );

  const existingOperation = (
    actor: string,
    requestId:
      | SandboxCreateRequest["requestId"]
      | SandboxStartRequest["requestId"]
      | SandboxStopRequest["requestId"]
      | SandboxDeleteRequest["requestId"]
      | SandboxProfileDeleteRequest["requestId"]
      | SandboxProfileUpsertRequest["requestId"],
    hash: string,
  ) =>
    repository.getOperationByRequest(actor, requestId).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((existing) => {
        if (Option.isNone(existing)) return Effect.succeed(Option.none<SandboxOperationReceipt>());
        if (existing.value.payloadHash !== hash) {
          return failConflict("The request id was already used for a different sandbox command.");
        }
        return Effect.succeed(Option.some(existing.value));
      }),
    );

  const updateOperation = (
    receipt: SandboxOperationReceipt,
    claimId: string,
    update: Pick<SandboxOperationReceipt, "status"> &
      Partial<
        Pick<
          SandboxOperationReceipt,
          "result" | "error" | "deploymentId" | "progress" | "resolvedImageDigest"
        >
      >,
  ) =>
    saveClaimedOperation(
      {
        ...receipt,
        ...update,
        updatedAt: now(),
      },
      claimId,
    );

  const markFailed = (receipt: SandboxOperationReceipt, claimId: string, cause: unknown) =>
    repository.getOperation(receipt.operationId).pipe(
      Effect.mapError(asServiceError),
      Effect.catch(() => Effect.succeed(Option.none<SandboxOperationReceipt>())),
      Effect.flatMap((current) => {
        const latest = Option.isSome(current) ? current.value : receipt;
        const lastStage =
          latest.progress?.stage === "failed"
            ? latest.progress.lastStage
            : (latest.progress?.stage ?? "resolving-image");
        const message = diagnostic(cause);
        return updateOperation(latest, claimId, {
          status: "Failed",
          progress: { stage: "failed", lastStage, diagnostic: message },
          error: message,
        });
      }),
      Effect.catch((saveError) =>
        Effect.logError("Failed to persist sandbox operation failure", { cause: saveError }).pipe(
          Effect.asVoid,
        ),
      ),
    );

  const saveDeployment = (deployment: SandboxDeployment, expectedRevision?: number) =>
    repository.saveDeployment(deployment, expectedRevision).pipe(Effect.mapError(asServiceError));

  const saveObservation = (
    deploymentId: SandboxDeploymentId,
    observation: ProviderObservation,
    expectedRevision?: number,
  ) =>
    repository
      .saveObservation(deploymentId, observation, expectedRevision)
      .pipe(Effect.mapError(asServiceError));

  const assertOperationClaimed = (operationId: SandboxOperationId, claimId: string) =>
    repository.ownsOperation(operationId, claimId).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((owned) =>
        owned ? Effect.void : failConflict("Sandbox operation is no longer claimed."),
      ),
    );

  const validateProfileUpsert = (input: SandboxProfileInput) =>
    Effect.gen(function* () {
      if (input.profileId === undefined) {
        return yield* failCommand("Profile upsert operation has no profile id.");
      }
      const current = yield* repository
        .getProfile(input.profileId)
        .pipe(Effect.mapError(asServiceError));
      const existing = Option.isSome(current) ? current.value : undefined;
      if (existing !== undefined && input.expectedRevision === undefined) {
        return yield* failConflict("Replacing a sandbox profile requires its expected revision.");
      }
      if (
        existing !== undefined &&
        input.expectedRevision !== undefined &&
        input.expectedRevision !== existing.revision
      ) {
        return yield* failConflict(`Profile revision ${input.expectedRevision} is stale.`);
      }
      if (
        existing === undefined &&
        input.expectedRevision !== undefined &&
        input.expectedRevision !== 0
      ) {
        return yield* failConflict("A new sandbox profile must use revision zero.");
      }
      return existing;
    });

  const applyProfileUpsert = (
    input: SandboxProfileInput,
    receipt?: SandboxOperationReceipt,
    claimId?: string,
  ) =>
    Effect.gen(function* () {
      if (input.profileId === undefined) {
        return yield* failCommand("Profile upsert operation has no profile id.");
      }
      const selected = imageSelection(input);
      const current = yield* repository
        .getProfile(input.profileId)
        .pipe(Effect.mapError(asServiceError));
      const currentProfile = Option.isSome(current) ? current.value : undefined;
      const targetRevision = (input.expectedRevision ?? 0) + 1;
      const recoveredProfile =
        receipt !== undefined &&
        currentProfile !== undefined &&
        currentProfile.revision === targetRevision &&
        profileMatchesInput(currentProfile, input, receipt.resolvedImageDigest)
          ? currentProfile
          : undefined;
      const existing = recoveredProfile ?? (yield* validateProfileUpsert(input));
      const report = (progress: SandboxOperationProgress) =>
        receipt === undefined || claimId === undefined
          ? Effect.void
          : updateOperation(receipt, claimId, { status: "Running", progress }).pipe(
              Effect.catch(() => Effect.void),
            );
      const imageDigest =
        receipt?.resolvedImageDigest ??
        recoveredProfile?.imageDigest ??
        (selected.kind === "managed"
          ? yield* report({ stage: "resolving-image" }).pipe(
              Effect.andThen(
                resolveManagedImage(
                  { serverVersion: selected.version, channel: selected.channel },
                  managedImageRegistry,
                ).pipe(
                  Effect.map((resolved) => resolved.immutableReference),
                  Effect.mapError(asServiceError),
                ),
              ),
            )
          : selected.digest);
      if (receipt !== undefined && claimId !== undefined) {
        yield* updateOperation(receipt, claimId, {
          status: "Running",
          resolvedImageDigest: imageDigest,
        });
      }
      const timestamp = now();
      const profile: SandboxProfile = recoveredProfile ?? {
        profileId: input.profileId,
        name: input.name,
        driverKind: input.driverKind,
        socketPath: input.socketPath ?? DEFAULT_DOCKER_SOCKET_PATH,
        imageDigest,
        enabled: input.enabled,
        revision: existing === undefined ? 1 : existing.revision + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      // Persist the resolved reference before any engine work so failures leave a visible profile.
      yield* repository
        .saveProfile(profile, existing?.revision)
        .pipe(Effect.mapError(asServiceError));
      if (profile.enabled) {
        if (selected.kind === "custom") {
          yield* report({ stage: "validating-image" });
        }
        yield* driverFor(profile)
          .validateProfile(profile, (progress) => report(progress))
          .pipe(Effect.mapError(asServiceError));
      }
      return profile;
    });

  const observeDeployment = (
    deployment: AllocatedDeployment | IdentifiedDeployment,
  ): Effect.Effect<ProviderObservation, SandboxDeploymentServiceError> =>
    Effect.gen(function* () {
      const driver = driverFor(deployment.intent.profileSnapshot);
      const observation = yield* (
        driver.power?.inspect
          ? driver.power.inspect({
              profile: deployment.intent.profileSnapshot,
              resource: deployment.resource,
            })
          : driver.observe({
              profile: deployment.intent.profileSnapshot,
              resource: deployment.resource,
            })
      ).pipe(
        Effect.mapError(asServiceError),
        Effect.catch((cause) =>
          Effect.succeed<ProviderObservation>({
            state: "Unknown",
            observedAt: now(),
            diagnostic: diagnostic(cause),
          }),
        ),
      );
      yield* saveObservation(deployment.intent.deploymentId, observation, deployment.revision).pipe(
        Effect.catchIf(
          (cause) => cause.kind === "conflict",
          () =>
            repository.getObservation(deployment.intent.deploymentId).pipe(
              Effect.mapError(asServiceError),
              Effect.flatMap(() => Effect.void),
            ),
        ),
      );
      return observation;
    });

  const observationFor = (
    deployment: AllocatedDeployment | IdentifiedDeployment,
  ): Effect.Effect<ProviderObservation, SandboxDeploymentServiceError> =>
    withDeploymentLock(deployment.intent.deploymentId, observeDeployment(deployment));

  const relayOkResponse = Schema.Struct({ ok: Schema.Boolean });

  const unlinkRelayEnvironment = (
    client: HttpClient.HttpClient,
    relayUrl: string,
    token: string,
    environmentId: EnvironmentId,
  ) =>
    Effect.gen(function* () {
      const response = yield* client.execute(
        HttpClientRequest.delete(
          `${relayUrl}/v1/client/environment-links/${encodeURIComponent(environmentId)}`,
        ).pipe(HttpClientRequest.bearerToken(token)),
      );
      if (response.status === 404) return;
      if (response.status < 200 || response.status >= 300) {
        return yield* failCommand(`Relay environment unlink returned HTTP ${response.status}.`);
      }
      const body = yield* HttpClientResponse.schemaBodyJson(relayOkResponse)(response);
      if (!body.ok) {
        return yield* failCommand("Relay refused to remove the sandbox environment link.");
      }
    });

  const unlinkSandboxRelayConfiguration = (
    client: HttpClient.HttpClient,
    endpoint: string,
    token: string,
  ) =>
    Effect.gen(function* () {
      const response = yield* client.execute(
        HttpClientRequest.post(new URL("/api/connect/unlink", endpoint)).pipe(
          HttpClientRequest.bearerToken(token),
        ),
      );
      if (response.status === 404) return;
      if (response.status < 200 || response.status >= 300) {
        return yield* failCommand(`Sandbox relay unlink returned HTTP ${response.status}.`);
      }
      const body = yield* HttpClientResponse.schemaBodyJson(relayOkResponse)(response);
      if (!body.ok) return yield* failCommand("Sandbox refused to remove relay configuration.");
    });

  const exchangePairingCredential = (
    client: HttpClient.HttpClient,
    input: {
      readonly endpoint: string;
      readonly credential: string;
      readonly scopes: ReadonlyArray<"relay:read" | "relay:write">;
    },
  ) =>
    Effect.gen(function* () {
      const response = yield* client.execute(
        HttpClientRequest.post(new URL("/oauth/token", input.endpoint)).pipe(
          HttpClientRequest.bodyUrlParams({
            grant_type: AuthTokenExchangeGrantType,
            subject_token: input.credential,
            subject_token_type: AuthEnvironmentBootstrapTokenType,
            requested_token_type: AuthAccessTokenType,
            scope: input.scopes.join(" "),
            client_label: "Kata Code sandbox relay",
            client_device_type: "bot",
          }),
        ),
      );
      if (response.status < 200 || response.status >= 300) {
        return yield* failCommand(
          `Sandbox relay credential exchange returned HTTP ${response.status}.`,
        );
      }
      return yield* HttpClientResponse.schemaBodyJson(AuthAccessTokenResult)(response).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDeploymentServiceError({
              kind: "command",
              message: diagnostic(cause),
              cause,
            }),
        ),
      );
    });

  const issueRelayHandoff = (
    deployment: IdentifiedDeployment,
  ): Effect.Effect<SandboxHandoff, SandboxDeploymentServiceError> =>
    Effect.gen(function* () {
      const relayUrl = options.relayUrl;
      const cloudCliTokenManager = dependencies.cloudCliTokenManager;
      if (relayUrl === undefined || cloudCliTokenManager === undefined) {
        return yield* failConflict("Relay attachment is not configured for this server.");
      }
      const controlToken = yield* cloudCliTokenManager.getExisting.pipe(
        Effect.mapError(asServiceError),
        Effect.flatMap((token) =>
          Option.isSome(token)
            ? Effect.succeed(token.value.accessToken)
            : failConflict("Authorize Kata Code Connect before using relay attachment."),
        ),
      );
      const client = dependencies.httpClient;
      if (client === undefined) {
        return yield* failConflict("Relay attachment is not configured for this server.");
      }
      if (deployment.resource.hostPort === undefined) {
        return yield* failConflict("The sandbox has no local host port for relay attachment.");
      }
      const localEndpoint = localDockerEndpoint(deployment.endpoint);
      const connectorOrigin =
        deployment.connectorOrigin ??
        ({
          localHttpHost: "127.0.0.1",
          localHttpPort: DEFAULT_SANDBOX_CONTAINER_PORT,
        } satisfies SandboxConnectorOrigin);
      const challengeResponse = yield* client.execute(
        HttpClientRequest.post(`${relayUrl}/v1/client/environment-link-challenges`).pipe(
          HttpClientRequest.bearerToken(controlToken),
          HttpClientRequest.bodyJsonUnsafe({
            notificationsEnabled: true,
            liveActivitiesEnabled: true,
            managedTunnelsEnabled: true,
          }),
        ),
      );
      if (challengeResponse.status < 200 || challengeResponse.status >= 300) {
        return yield* failCommand(
          `Relay environment-link challenge returned HTTP ${challengeResponse.status}.`,
        );
      }
      const challenge = yield* HttpClientResponse.schemaBodyJson(
        RelayEnvironmentLinkChallengeResponse,
      )(challengeResponse);
      const bootstrapToken = yield* bootstrapTokenFor(deployment.intent.deploymentId);
      const relayPairing = yield* issuePairingCredential({
        endpoint: localEndpoint,
        bootstrapToken,
        label: targetPairingLabel(deployment.intent.deploymentId),
        scopes: [AuthRelayReadScope, AuthRelayWriteScope],
      });
      const sandboxToken = yield* exchangePairingCredential(client, {
        endpoint: localEndpoint,
        credential: relayPairing.credential,
        scopes: [AuthRelayReadScope, AuthRelayWriteScope],
      });
      const endpoint = {
        httpBaseUrl: deployment.endpoint,
        wsBaseUrl: deployment.endpoint.replace(/^http/u, "ws"),
        providerKind: "cloudflare_tunnel" as const,
      };
      const proofResponse = yield* client.execute(
        HttpClientRequest.post(new URL("/api/connect/link-proof", localEndpoint)).pipe(
          HttpClientRequest.bearerToken(sandboxToken.access_token),
          HttpClientRequest.bodyJsonUnsafe({
            challenge: challenge.challenge,
            relayIssuer: relayUrl,
            endpoint,
            origin: connectorOrigin,
          }),
        ),
      );
      if (proofResponse.status < 200 || proofResponse.status >= 300) {
        return yield* failCommand(
          `Sandbox relay link proof returned HTTP ${proofResponse.status}.`,
        );
      }
      const proof = yield* HttpClientResponse.schemaBodyJson(Schema.String)(proofResponse);
      const failAfterRelayLink = (
        cause: unknown,
      ): Effect.Effect<never, SandboxDeploymentServiceError> =>
        Effect.gen(function* () {
          yield* unlinkSandboxRelayConfiguration(
            client,
            localEndpoint,
            sandboxToken.access_token,
          ).pipe(
            Effect.catch((cleanupCause) =>
              Effect.logError("Failed to compensate sandbox relay configuration", {
                deploymentId: deployment.intent.deploymentId,
                environmentId: deployment.environmentId,
                cause: cleanupCause,
              }).pipe(Effect.asVoid),
            ),
          );
          yield* unlinkRelayEnvironment(
            client,
            relayUrl,
            controlToken,
            deployment.environmentId,
          ).pipe(
            Effect.catch((cleanupCause) =>
              Effect.logError("Failed to compensate sandbox relay attachment", {
                deploymentId: deployment.intent.deploymentId,
                environmentId: deployment.environmentId,
                cause: cleanupCause,
              }).pipe(Effect.asVoid),
            ),
          );
          return yield* asServiceError(cause);
        });
      const attached = yield* Effect.gen(function* () {
        const linkResponse = yield* client.execute(
          HttpClientRequest.post(`${relayUrl}/v1/client/environment-links`).pipe(
            HttpClientRequest.bearerToken(controlToken),
            HttpClientRequest.bodyJsonUnsafe({
              proof,
              notificationsEnabled: true,
              liveActivitiesEnabled: true,
              managedTunnelsEnabled: true,
            }),
          ),
        );
        if (linkResponse.status < 200 || linkResponse.status >= 300) {
          return yield* failCommand(`Relay environment link returned HTTP ${linkResponse.status}.`);
        }
        const link = yield* HttpClientResponse.schemaBodyJson(RelayEnvironmentLinkResponse)(
          linkResponse,
        );
        if (
          link.environmentId !== deployment.environmentId ||
          link.endpoint.providerKind !== "cloudflare_tunnel"
        ) {
          return yield* failCommand("Relay returned credentials for a different sandbox.");
        }
        const configResponse = yield* client.execute(
          HttpClientRequest.post(new URL("/api/connect/relay-config", localEndpoint)).pipe(
            HttpClientRequest.bearerToken(sandboxToken.access_token),
            HttpClientRequest.bodyJsonUnsafe({
              relayUrl,
              relayIssuer: link.relayIssuer,
              cloudUserId: link.cloudUserId,
              environmentCredential: link.environmentCredential,
              cloudMintPublicKey: link.cloudMintPublicKey,
              endpointRuntime: link.endpointRuntime,
            }),
          ),
        );
        if (configResponse.status < 200 || configResponse.status >= 300) {
          return yield* failCommand(
            `Sandbox relay configuration returned HTTP ${configResponse.status}.`,
          );
        }
        return link;
      }).pipe(Effect.timeout("30 seconds"), Effect.catch(failAfterRelayLink));
      const handoff = {
        deploymentId: deployment.intent.deploymentId,
        environmentId: deployment.environmentId,
        endpoint: attached.endpoint.httpBaseUrl,
        attachment: "relay" as const,
        relayEnvironmentId: attached.environmentId,
        label: deployment.intent.label,
        workspaceRoot: deployment.workspaceRoot,
        expiresAt: relayPairing.expiresAt,
      } satisfies SandboxHandoff;
      if (deployment.attachment !== "relay") {
        yield* saveDeployment(
          { ...deployment, revision: deployment.revision + 1, attachment: "relay" },
          deployment.revision,
        ).pipe(Effect.catch(failAfterRelayLink));
      }
      return handoff;
    }).pipe(Effect.timeout("60 seconds"), Effect.mapError(asServiceError));

  const makeHandoff = (
    deployment: IdentifiedDeployment,
    attachment: SandboxAttachment = "direct",
  ): Effect.Effect<SandboxHandoff, SandboxDeploymentServiceError> =>
    Effect.gen(function* () {
      const observation = yield* observeDeployment(deployment);
      if (observation.state !== "Running") {
        return yield* failConflict(
          observation.state === "Unknown"
            ? observation.diagnostic
            : "The sandbox container is not running.",
        );
      }
      if (attachment === "relay") return yield* issueRelayHandoff(deployment);
      const bootstrapToken = yield* bootstrapTokenFor(deployment.intent.deploymentId);
      if (deployment.resource.hostPort === undefined) {
        return yield* failConflict("The sandbox has no local host port for direct attachment.");
      }
      const issued = yield* issuePairingCredential({
        endpoint: localDockerEndpoint(deployment.endpoint),
        bootstrapToken,
        label: targetPairingLabel(deployment.intent.deploymentId),
      });
      return {
        deploymentId: deployment.intent.deploymentId,
        environmentId: deployment.environmentId,
        endpoint: deployment.endpoint,
        attachment: "direct",
        pairingUrl: endpointPairingUrl(deployment.endpoint, issued.credential),
        workspaceRoot: deployment.workspaceRoot,
        expiresAt: issued.expiresAt,
      } satisfies SandboxHandoff;
    });

  const compensateAllocation = (
    deployment: AllocatedDeployment | IdentifiedDeployment,
    original: unknown,
    operationId: SandboxOperationId,
    claimId: string,
  ): Effect.Effect<never, SandboxDeploymentServiceError> =>
    Effect.gen(function* () {
      yield* assertOperationClaimed(operationId, claimId);
      const driver = driverFor(deployment.intent.profileSnapshot);
      const observation = yield* driver
        .delete({ profile: deployment.intent.profileSnapshot, resource: deployment.resource })
        .pipe(
          Effect.mapError(asServiceError),
          Effect.catch((cause) =>
            Effect.succeed<ProviderObservation>({
              state: "Unknown",
              observedAt: now(),
              diagnostic: diagnostic(cause),
            }),
          ),
        );
      yield* saveObservation(deployment.intent.deploymentId, observation);
      if (observation.state === "Gone") {
        const deleted = deleteDeployment(deployment, now());
        yield* saveDeployment(deleted, deployment.revision);
        yield* dependencies.secretStore
          .remove(BOOTSTRAP_SECRET_PREFIX + deployment.intent.deploymentId)
          .pipe(Effect.catch(() => Effect.void));
      }
      return yield* new SandboxDeploymentServiceError({
        kind: "command",
        message: diagnostic(original),
        cause: original,
      });
    });

  const processCreateUnlocked = (receipt: SandboxOperationReceipt, claimId: string) =>
    Effect.gen(function* () {
      if (receipt.deploymentId === undefined) {
        return yield* failCommand("Create operation has no deployment id.");
      }
      const deploymentId = SandboxDeploymentId.make(receipt.deploymentId);
      let deployment = yield* getDeployment(deploymentId);
      if (deployment.state === "Deleted") {
        return yield* failConflict("The sandbox deployment was deleted before creation finished.");
      }

      const intent = deployment.intent;
      const profile = intent.profileSnapshot;
      const driver = driverFor(profile);
      let bootstrapToken = "";
      let authJson: Uint8Array<ArrayBufferLike> = new Uint8Array();
      let credentialSeed: SandboxCredentialSeedValue | undefined;
      if (deployment.state !== "Identified") {
        bootstrapToken = yield* bootstrapTokenFor(deploymentId);
        credentialSeed = yield* dependencies.credentialSeed
          .resolve(intent.providerInstanceId)
          .pipe(Effect.mapError((cause) => asServiceError(cause)));
        authJson = credentialSeed.authJson;
      }

      if (deployment.state === "Requested") {
        yield* assertOperationClaimed(receipt.operationId, claimId);
        yield* Effect.logInfo("sandbox.create.validateProfile");
        yield* driver
          .validateProfile(
            profile,
            (progress) =>
              updateOperation(receipt, claimId, { status: "Running", progress }).pipe(
                Effect.catch(() => Effect.void),
              ),
            { pullIfMissing: false },
          )
          .pipe(Effect.mapError(asServiceError));
        yield* Effect.logInfo("sandbox.create.allocate");
        const resource = yield* driver
          .allocate({
            profile,
            intent,
            manifest: intent.bootstrapManifest,
            codexAuthJson: authJson,
            ...(credentialSeed === undefined
              ? {}
              : { modelSelection: credentialSeed.modelSelection }),
            bootstrapToken,
          })
          .pipe(Effect.mapError(asServiceError));
        const allocated = allocateDeployment(deployment, resource, now());
        yield* assertOperationClaimed(receipt.operationId, claimId).pipe(
          Effect.catch((cause) =>
            compensateAllocation(allocated, cause, receipt.operationId, claimId),
          ),
        );
        yield* saveDeployment(allocated, deployment.revision).pipe(
          Effect.catch((cause) =>
            compensateAllocation(allocated, cause, receipt.operationId, claimId),
          ),
        );
        deployment = allocated;
      }

      if (deployment.state === "Allocated") {
        yield* assertOperationClaimed(receipt.operationId, claimId);
        yield* Effect.logInfo("sandbox.create.identify");
        const identified = yield* driver
          .identify({
            profile,
            intent,
            manifest: intent.bootstrapManifest,
            codexAuthJson: authJson,
            ...(credentialSeed === undefined
              ? {}
              : { modelSelection: credentialSeed.modelSelection }),
            bootstrapToken,
            resource: deployment.resource,
          })
          .pipe(
            Effect.mapError(asServiceError),
            Effect.catch((cause) =>
              compensateAllocation(
                deployment as AllocatedDeployment,
                cause,
                receipt.operationId,
                claimId,
              ),
            ),
          );
        yield* assertOperationClaimed(receipt.operationId, claimId).pipe(
          Effect.catch((cause) =>
            compensateAllocation(
              deployment as AllocatedDeployment,
              cause,
              receipt.operationId,
              claimId,
            ),
          ),
        );
        const next = identifyDeployment(
          deployment,
          EnvironmentId.make(identified.environmentId),
          SandboxEndpoint.make(identified.endpoint),
          identified.resource,
          now(),
          identified.connectorOrigin,
        );
        yield* saveDeployment(next, deployment.revision);
        yield* Effect.logInfo("sandbox.create.identified");
        deployment = next;
        yield* saveObservation(
          deploymentId,
          {
            state: "Running",
            observedAt: now(),
            environmentId: next.environmentId,
            endpoint: next.endpoint,
          },
          next.revision,
        );
      } else if (deployment.state === "Identified") {
        const observation = yield* observeDeployment(deployment);
        if (observation.state !== "Running") {
          return yield* failCommand(
            observation.state === "Unknown"
              ? observation.diagnostic
              : "The sandbox disappeared before creation completed.",
          );
        }
      }

      const identified: IdentifiedDeployment | undefined =
        deployment.state === "Identified" ? deployment : undefined;
      yield* updateOperation(receipt, claimId, {
        status: "Succeeded",
        progress: { stage: "ready" },
        result: {
          kind: "deployment",
          deploymentId,
          ...(identified
            ? { environmentId: identified.environmentId, endpoint: identified.endpoint }
            : {}),
        },
      });
    });

  const processDeleteUnlocked = (receipt: SandboxOperationReceipt, claimId: string) =>
    Effect.gen(function* () {
      if (receipt.deploymentId === undefined) {
        return yield* failCommand("Delete operation has no deployment id.");
      }
      const deploymentId = SandboxDeploymentId.make(receipt.deploymentId);
      const deployment = yield* getDeployment(deploymentId);
      const inFlight = yield* repository
        .listInFlightOperations()
        .pipe(Effect.mapError(asServiceError));
      if (
        inFlight.some(
          (operation) =>
            operation.operationId !== receipt.operationId &&
            operation.command === "create" &&
            operation.deploymentId === deploymentId,
        )
      ) {
        return yield* failConflict("The sandbox deployment is still being created.");
      }
      if (
        deployment.state !== "Deleted" &&
        receipt.expectedRevision !== undefined &&
        receipt.expectedRevision !== deployment.revision
      ) {
        return yield* failConflict(`Deployment revision ${receipt.expectedRevision} is stale.`);
      }
      if (deployment.state === "Deleted") {
        yield* updateOperation(receipt, claimId, {
          status: "Succeeded",
          result: operationResultForDeleted(deployment),
        });
        return;
      }
      if (
        receipt.expectedRevision !== undefined &&
        deployment.revision !== receipt.expectedRevision
      ) {
        return yield* failConflict(`Deployment revision ${receipt.expectedRevision} is stale.`);
      }
      if (deployment.state === "Requested") {
        yield* assertOperationClaimed(receipt.operationId, claimId);
        const deleted = deleteDeployment(deployment, now());
        yield* saveDeployment(deleted, deployment.revision);
        yield* updateOperation(receipt, claimId, {
          status: "Succeeded",
          result: operationResultForDeleted(deleted),
        });
        return;
      }

      let relayUnlink:
        | {
            readonly client: HttpClient.HttpClient;
            readonly relayUrl: string;
            readonly accessToken: string;
          }
        | undefined;
      if (deployment.state === "Identified") {
        const requiresRelayCleanup = deployment.attachment === "relay";
        const relayUrl = options.relayUrl;
        const tokenManager = dependencies.cloudCliTokenManager;
        const client = dependencies.httpClient;
        const canAttemptRelayCleanup =
          relayUrl !== undefined && tokenManager !== undefined && client !== undefined;
        if (requiresRelayCleanup && !canAttemptRelayCleanup) {
          return yield* failConflict("Relay attachment cleanup is not configured for this server.");
        }
        if (canAttemptRelayCleanup) {
          const tokenResult = tokenManager.getExisting.pipe(Effect.mapError(asServiceError));
          const tokenOption = requiresRelayCleanup
            ? yield* tokenResult
            : yield* tokenResult.pipe(Effect.catch(() => Effect.succeed(Option.none())));
          if (Option.isNone(tokenOption)) {
            if (requiresRelayCleanup) {
              return yield* failConflict(
                "Authorize Kata Code Connect before deleting this sandbox.",
              );
            }
          } else {
            relayUnlink = {
              client,
              relayUrl,
              accessToken: tokenOption.value.accessToken,
            };
          }
        }
      }

      yield* assertOperationClaimed(receipt.operationId, claimId);
      const observation = yield* driverFor(deployment.intent.profileSnapshot)
        .delete({ profile: deployment.intent.profileSnapshot, resource: deployment.resource })
        .pipe(
          Effect.mapError(asServiceError),
          Effect.catch((cause) =>
            Effect.succeed<ProviderObservation>({
              state: "Unknown",
              observedAt: now(),
              diagnostic: diagnostic(cause),
            }),
          ),
        );
      yield* assertOperationClaimed(receipt.operationId, claimId);
      yield* saveObservation(deploymentId, observation, deployment.revision);
      if (observation.state !== "Gone") {
        return yield* failCommand(
          observation.state === "Unknown"
            ? observation.diagnostic
            : "Docker reported the sandbox is still running after deletion.",
        );
      }
      if (deployment.state === "Identified" && relayUnlink !== undefined) {
        yield* assertOperationClaimed(receipt.operationId, claimId);
        yield* unlinkRelayEnvironment(
          relayUnlink.client,
          relayUnlink.relayUrl,
          relayUnlink.accessToken,
          deployment.environmentId,
        ).pipe(Effect.mapError(asServiceError));
      }

      const deleted = deleteDeployment(deployment, now());
      yield* saveDeployment(deleted, deployment.revision);
      yield* dependencies.secretStore
        .remove(BOOTSTRAP_SECRET_PREFIX + deploymentId)
        .pipe(Effect.catch(() => Effect.void));
      yield* updateOperation(receipt, claimId, {
        status: "Succeeded",
        result: operationResultForDeleted(deleted),
      });
    });

  const processStartUnlocked = (receipt: SandboxOperationReceipt, claimId: string) =>
    Effect.gen(function* () {
      if (receipt.deploymentId === undefined || receipt.attachment === undefined) {
        return yield* failCommand("Start operation is missing its deployment and attachment.");
      }
      const deploymentId = SandboxDeploymentId.make(receipt.deploymentId);
      const loaded = yield* getDeployment(deploymentId);
      const startedProgress = receipt.result?.kind === "started" ? receipt.result : undefined;
      if (loaded.state !== "Identified") {
        return yield* failConflict("Only an identified sandbox can be started.");
      }
      const startedResultFor = (endpoint: SandboxEndpoint) => ({
        kind: "started" as const,
        deploymentId,
        environmentId: loaded.environmentId,
        endpoint,
      });
      let deployment = loaded;
      if (receipt.expectedRevision !== undefined && startedProgress !== undefined) {
        const expectedRevision = receipt.expectedRevision;
        if (loaded.revision < expectedRevision || loaded.revision > expectedRevision + 1) {
          return yield* failConflict(`Deployment revision ${expectedRevision} is stale.`);
        }
        if (
          startedProgress.environmentId !== loaded.environmentId ||
          (startedProgress.resource !== undefined &&
            !resourceIdentityMatches(loaded.resource, startedProgress.resource))
        ) {
          return yield* failConflict(`Deployment revision ${expectedRevision} is stale.`);
        }
        if (loaded.revision === expectedRevision) {
          const endpointChanged = startedProgress.endpoint !== loaded.endpoint;
          const resourceChanged =
            startedProgress.resource !== undefined &&
            !resourceMatches(loaded.resource, startedProgress.resource);
          const connectorOriginChanged =
            startedProgress.connectorOrigin !== undefined &&
            !connectorOriginMatches(loaded.connectorOrigin, startedProgress.connectorOrigin);
          if (startedProgress.resource === undefined && endpointChanged) {
            return yield* failConflict(`Deployment revision ${expectedRevision} is stale.`);
          }
          if (endpointChanged || resourceChanged || connectorOriginChanged) {
            deployment = {
              ...loaded,
              revision: loaded.revision + 1,
              endpoint: startedProgress.endpoint,
              resource: startedProgress.resource ?? loaded.resource,
              ...(startedProgress.connectorOrigin === undefined
                ? {}
                : { connectorOrigin: startedProgress.connectorOrigin }),
            };
            yield* saveDeployment(deployment, loaded.revision);
          }
        } else if (
          startedProgress.endpoint !== loaded.endpoint ||
          (startedProgress.resource !== undefined &&
            !resourceMatches(loaded.resource, startedProgress.resource)) ||
          (startedProgress.connectorOrigin !== undefined &&
            !connectorOriginMatches(loaded.connectorOrigin, startedProgress.connectorOrigin))
        ) {
          return yield* failConflict(`Deployment revision ${expectedRevision} is stale.`);
        }
        const observation = yield* observeDeployment(deployment);
        if (observation.state !== "Running") {
          return yield* failCommand(
            observation.state === "Unknown"
              ? observation.diagnostic
              : "The sandbox was not running after start recovery.",
          );
        }
        yield* updateOperation(receipt, claimId, {
          status: "Succeeded",
          result: startedResultFor(deployment.endpoint),
        });
        return;
      }
      if (receipt.expectedRevision !== undefined && receipt.expectedRevision !== loaded.revision) {
        return yield* failConflict(`Deployment revision ${receipt.expectedRevision} is stale.`);
      }
      const power = driverFor(loaded.intent.profileSnapshot).power;
      if (power === undefined) {
        return yield* failConflict("The sandbox provider does not support start and stop.");
      }
      yield* assertOperationClaimed(receipt.operationId, claimId);
      const started = yield* power
        .start({
          profile: loaded.intent.profileSnapshot,
          resource: loaded.resource,
          intent: loaded.intent,
          expectedEnvironmentId: loaded.environmentId,
        })
        .pipe(Effect.mapError(asServiceError));
      yield* assertOperationClaimed(receipt.operationId, claimId);
      if ("state" in started) {
        yield* saveObservation(deploymentId, started, loaded.revision);
        if (started.state !== "Running") {
          return yield* failCommand(
            started.state === "Unknown"
              ? started.diagnostic
              : started.state === "Gone"
                ? "The sandbox container is gone."
                : "The sandbox container remained stopped after start.",
          );
        }
        yield* updateOperation(receipt, claimId, {
          status: "Succeeded",
          result: startedResultFor(loaded.endpoint),
        });
        return;
      }
      if (
        started.environmentId !== loaded.environmentId ||
        !resourceIdentityMatches(started.resource, loaded.resource)
      ) {
        const unknown: ProviderObservation = {
          state: "Unknown",
          observedAt: now(),
          diagnostic: "Sandbox start returned a different environment or resource identity.",
        };
        yield* saveObservation(deploymentId, unknown, loaded.revision);
        return yield* failCommand(unknown.diagnostic);
      }
      const startedResult = {
        kind: "started" as const,
        deploymentId,
        environmentId: loaded.environmentId,
        endpoint: started.endpoint,
      };
      const startedProgressResult = {
        ...startedResult,
        resource: started.resource,
        ...(started.connectorOrigin === undefined
          ? {}
          : { connectorOrigin: started.connectorOrigin }),
      };
      const connectorOriginChanged =
        started.connectorOrigin !== undefined &&
        (loaded.connectorOrigin?.localHttpHost !== started.connectorOrigin.localHttpHost ||
          loaded.connectorOrigin?.localHttpPort !== started.connectorOrigin.localHttpPort);
      const resourceChanged =
        started.resource.hostPort !== loaded.resource.hostPort ||
        started.endpoint !== loaded.endpoint;
      if (connectorOriginChanged || resourceChanged) {
        deployment = {
          ...loaded,
          revision: loaded.revision + 1,
          endpoint: started.endpoint,
          resource: started.resource,
          ...(started.connectorOrigin === undefined
            ? {}
            : { connectorOrigin: started.connectorOrigin }),
        };
        yield* updateOperation(receipt, claimId, {
          status: "Running",
          result: startedProgressResult,
        });
        yield* saveDeployment(deployment, loaded.revision);
      }
      yield* saveObservation(
        deploymentId,
        {
          state: "Running",
          observedAt: now(),
          environmentId: deployment.environmentId,
          endpoint: deployment.endpoint,
        },
        deployment.revision,
      );
      yield* updateOperation(receipt, claimId, {
        status: "Succeeded",
        result: startedResultFor(deployment.endpoint),
      });
    });

  const processStopUnlocked = (receipt: SandboxOperationReceipt, claimId: string) =>
    Effect.gen(function* () {
      if (receipt.deploymentId === undefined) {
        return yield* failCommand("Stop operation has no deployment id.");
      }
      const deploymentId = SandboxDeploymentId.make(receipt.deploymentId);
      const deployment = yield* getDeployment(deploymentId);
      if (deployment.state !== "Identified") {
        return yield* failConflict("Only an identified sandbox can be stopped.");
      }
      if (
        receipt.expectedRevision !== undefined &&
        receipt.expectedRevision !== deployment.revision
      ) {
        return yield* failConflict(`Deployment revision ${receipt.expectedRevision} is stale.`);
      }
      const power = driverFor(deployment.intent.profileSnapshot).power;
      if (power === undefined) {
        return yield* failConflict("The sandbox provider does not support start and stop.");
      }
      yield* assertOperationClaimed(receipt.operationId, claimId);
      const stopped = yield* power
        .stop({
          profile: deployment.intent.profileSnapshot,
          resource: deployment.resource,
          intent: deployment.intent,
          expectedEnvironmentId: deployment.environmentId,
        })
        .pipe(Effect.mapError(asServiceError));
      yield* assertOperationClaimed(receipt.operationId, claimId);
      yield* saveObservation(deploymentId, stopped, deployment.revision);
      if (stopped.state !== "Stopped") {
        return yield* failCommand(
          stopped.state === "Unknown"
            ? stopped.diagnostic
            : stopped.state === "Gone"
              ? "The sandbox container is gone."
              : "The sandbox container is still running after stop.",
        );
      }
      yield* updateOperation(receipt, claimId, {
        status: "Succeeded",
        result: { kind: "stopped", deploymentId },
      });
    });

  const actionsFor = (
    deployment: SandboxDeployment,
    observation: ProviderObservation | undefined,
    busy = false,
  ): ReadonlyArray<"start" | "stop" | "attach" | "delete"> => {
    if (busy || deployment.state === "Deleted") return [];
    if (deployment.state === "Requested" || deployment.state === "Allocated") return ["delete"];
    const power = driverFor(deployment.intent.profileSnapshot).power;
    if (power === undefined) return ["attach", "delete"];
    switch (observation?.state) {
      case "Running":
        return ["stop", "attach", "delete"];
      case "Stopped":
        return ["start", "delete"];
      case "Gone":
        return ["delete"];
      case "Unknown":
      default:
        return ["start", "delete"];
    }
  };

  const processProfileUpsert = (receipt: SandboxOperationReceipt, claimId: string) =>
    Effect.gen(function* () {
      if (receipt.profileInput === undefined) {
        return yield* failCommand("Profile upsert operation has no profile input.");
      }
      yield* assertOperationClaimed(receipt.operationId, claimId);
      const profile = yield* applyProfileUpsert(receipt.profileInput, receipt, claimId);
      yield* updateOperation(receipt, claimId, {
        status: "Succeeded",
        progress: { stage: "ready" },
        result: { kind: "profile", profileId: profile.profileId },
      });
    });

  const processProfileDelete = (receipt: SandboxOperationReceipt, claimId: string) =>
    Effect.gen(function* () {
      const profileId = receipt.profileId;
      if (profileId === undefined)
        return yield* failCommand("Profile delete operation has no profile id.");
      const profile = yield* repository.getProfile(profileId).pipe(Effect.mapError(asServiceError));
      if (Option.isSome(profile)) {
        yield* assertOperationClaimed(receipt.operationId, claimId);
        yield* repository
          .deleteProfile(profileId, receipt.expectedRevision)
          .pipe(Effect.mapError(asServiceError));
      }
      yield* updateOperation(receipt, claimId, {
        status: "Succeeded",
        result: { kind: "profile", profileId },
      });
    });

  const runDeploymentOperation = (
    receipt: SandboxOperationReceipt,
    operation: Effect.Effect<void, SandboxDeploymentServiceError>,
  ) =>
    receipt.deploymentId === undefined
      ? operation
      : withDeploymentLock(SandboxDeploymentId.make(receipt.deploymentId), operation);

  const runOperation = (receipt: SandboxOperationReceipt) =>
    Effect.gen(function* () {
      const claimedAt = now();
      const claimed = yield* repository
        .claimOperation(SandboxOperationId.make(receipt.operationId), workerId, claimedAt)
        .pipe(Effect.mapError(asServiceError));
      if (Option.isNone(claimed)) return;
      const claimedReceipt = claimed.value;
      const operation =
        claimedReceipt.command === "profile-upsert"
          ? processProfileUpsert(claimedReceipt, workerId)
          : claimedReceipt.command === "create"
            ? runDeploymentOperation(
                claimedReceipt,
                processCreateUnlocked(claimedReceipt, workerId),
              )
            : claimedReceipt.command === "start"
              ? runDeploymentOperation(
                  claimedReceipt,
                  processStartUnlocked(claimedReceipt, workerId),
                )
              : claimedReceipt.command === "stop"
                ? runDeploymentOperation(
                    claimedReceipt,
                    processStopUnlocked(claimedReceipt, workerId),
                  )
                : claimedReceipt.command === "delete"
                  ? runDeploymentOperation(
                      claimedReceipt,
                      processDeleteUnlocked(claimedReceipt, workerId),
                    )
                  : claimedReceipt.command === "profile-delete"
                    ? processProfileDelete(claimedReceipt, workerId)
                    : failCommand(`Unsupported sandbox operation '${claimedReceipt.command}'.`);
      yield* operation.pipe(Effect.catch((cause) => markFailed(claimedReceipt, workerId, cause)));
    }).pipe(
      Effect.catch((cause) =>
        Effect.logError("Failed to claim sandbox operation", {
          operationId: receipt.operationId,
          cause,
        }).pipe(Effect.asVoid),
      ),
    );

  const scheduledOperations = new Set<string>();
  const scheduleOperation = (receipt: SandboxOperationReceipt) => {
    const operationId = String(receipt.operationId);
    if (scheduledOperations.has(operationId)) return Effect.void;
    scheduledOperations.add(operationId);
    return schedule(
      runOperation(receipt).pipe(
        Effect.ensuring(Effect.sync(() => scheduledOperations.delete(operationId))),
      ),
    );
  };

  const list: SandboxDeploymentServiceShape["list"] = () =>
    Effect.gen(function* () {
      const profiles = yield* repository.listProfiles().pipe(Effect.mapError(asServiceError));
      const profileSummaries = yield* Effect.all(
        profiles.map((profile) => {
          if (!profile.enabled) {
            return Effect.succeed({
              kind: "unavailable" as const,
              profile,
              reason: "disabled" as const,
              diagnostic: "The sandbox profile is disabled.",
            });
          }
          return driverFor(profile)
            .validateProfile(profile, undefined, { pullIfMissing: false })
            .pipe(
              Effect.map((validated) => ({
                kind: "available" as const,
                profile,
                daemonVersion: validated.daemonVersion,
              })),
              Effect.catch((cause) =>
                Effect.succeed({
                  kind: "unavailable" as const,
                  profile,
                  reason: driverAvailabilityReason(cause),
                  diagnostic: diagnostic(cause),
                }),
              ),
            );
        }),
        { concurrency: 4 },
      );
      const deployments = yield* repository.listDeployments().pipe(Effect.mapError(asServiceError));
      const inFlight = yield* repository
        .listInFlightOperations()
        .pipe(Effect.mapError(asServiceError));
      const busyDeployments = new Set(
        inFlight.flatMap((operation) =>
          operation.deploymentId === undefined ? [] : [operation.deploymentId],
        ),
      );
      const deploymentSummaries = yield* Effect.all(
        deployments.map((deployment) => {
          const busy = busyDeployments.has(
            deployment.state === "Deleted"
              ? deployment.deploymentId
              : deployment.intent.deploymentId,
          );
          if (deployment.state === "Deleted") {
            return Effect.succeed({ deployment, actions: [] as const });
          }
          if (busy) {
            return repository.getObservation(deployment.intent.deploymentId).pipe(
              Effect.mapError(asServiceError),
              Effect.map((observation) => ({
                deployment,
                ...(Option.isSome(observation) ? { observation: observation.value } : {}),
                actions: [] as const,
              })),
            );
          }
          if (deployment.state === "Requested") {
            return Effect.succeed({ deployment, actions: busy ? [] : (["delete"] as const) });
          }
          return observationFor(deployment).pipe(
            Effect.map((observation) => ({
              deployment,
              observation,
              actions: actionsFor(deployment, observation, busy),
            })),
            Effect.catch((cause) =>
              Effect.succeed({
                deployment,
                observation: {
                  state: "Unknown" as const,
                  observedAt: now(),
                  diagnostic: diagnostic(cause),
                },
                actions: actionsFor(deployment, undefined, busy),
              }),
            ),
          );
        }),
        { concurrency: 4 },
      );
      const relayAvailable =
        options.relayUrl !== undefined &&
        dependencies.cloudCliTokenManager !== undefined &&
        dependencies.httpClient !== undefined
          ? yield* dependencies.cloudCliTokenManager.getExisting.pipe(
              Effect.map(Option.isSome),
              Effect.catch(() => Effect.succeed(false)),
            )
          : false;
      const hostDiagnostic = yield* hostAvailability();
      return {
        profiles: profileSummaries,
        deployments: deploymentSummaries,
        relayAvailable,
        providers: providerRegistry
          .listDescriptors()
          .map((descriptor) =>
            descriptor.driverKind === "docker" && hostDiagnostic !== undefined
              ? { ...descriptor, availabilityDiagnostic: hostDiagnostic }
              : descriptor,
          ),
      };
    });

  const upsertProfile: SandboxDeploymentServiceShape["upsertProfile"] = (actor, input) =>
    Effect.gen(function* () {
      const hash = payloadHash({ command: "profile-upsert", input });
      const existing = yield* existingOperation(actor, input.requestId, hash);
      if (Option.isSome(existing)) return { operationId: existing.value.operationId };
      const profileId =
        input.profileId ??
        SandboxProviderProfileId.make(
          yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
        );
      const profileInput: SandboxProfileInput = {
        profileId,
        name: input.name,
        driverKind: input.driverKind,
        ...(input.socketPath === undefined ? {} : { socketPath: input.socketPath }),
        image: input.image,
        enabled: input.enabled,
        ...(input.expectedRevision === undefined
          ? {}
          : { expectedRevision: input.expectedRevision }),
      };
      yield* validateProfileUpsert(profileInput);
      const operationId = SandboxOperationId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const receipt = {
        ...createReceipt(operationId, input.requestId, "profile-upsert", hash),
        profileId,
        profileInput,
      } satisfies SandboxOperationReceipt;
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* scheduleOperation(accepted.receipt);
      return { operationId: accepted.receipt.operationId };
    });

  const deleteProfile: SandboxDeploymentServiceShape["deleteProfile"] = (actor, input) =>
    Effect.gen(function* () {
      const hash = payloadHash({ command: "profile-delete", input });
      const existing = yield* existingOperation(actor, input.requestId, hash);
      if (Option.isSome(existing)) return { operationId: existing.value.operationId };
      const profile = yield* getProfile(input.profileId);
      if (profile.enabled) {
        return yield* failConflict("Disable the sandbox profile before deleting it.");
      }
      const deployments = yield* repository.listDeployments().pipe(Effect.mapError(asServiceError));
      if (
        deployments.some(
          (deployment) =>
            deployment.state !== "Deleted" && deployment.intent.profileId === profile.profileId,
        )
      ) {
        return yield* failConflict("Profile is still referenced by an active deployment.");
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== profile.revision) {
        return yield* failConflict(`Profile revision ${input.expectedRevision} is stale.`);
      }
      const operationId = SandboxOperationId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const receipt = {
        ...createReceipt(
          operationId,
          input.requestId,
          "profile-delete",
          hash,
          undefined,
          undefined,
          input.expectedRevision ?? profile.revision,
        ),
        profileId: profile.profileId,
      } satisfies SandboxOperationReceipt;
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* scheduleOperation(accepted.receipt);
      return { operationId: accepted.receipt.operationId };
    });

  const create: SandboxDeploymentServiceShape["create"] = (actor, input) =>
    Effect.gen(function* () {
      const hash = payloadHash({ command: "create", input });
      const existing = yield* existingOperation(actor, input.requestId, hash);
      if (Option.isSome(existing)) return { operationId: existing.value.operationId };
      const profile = yield* getProfile(input.profileId);
      if (!profile.enabled) {
        return yield* failConflict(`Sandbox profile '${profile.profileId}' is disabled.`);
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== profile.revision) {
        return yield* failConflict(`Profile revision ${input.expectedRevision} is stale.`);
      }
      const source = yield* dependencies.githubAccess
        .resolve(input.source)
        .pipe(Effect.mapError((cause) => asServiceError(cause)));
      const deploymentId = SandboxDeploymentId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const facts = yield* driverFor(profile)
        .validateProfile(profile, undefined, { pullIfMissing: false })
        .pipe(Effect.mapError(asServiceError));
      const bootstrapManifest = yield* Effect.try({
        try: () => bootstrapManifestFor(profile, facts),
        catch: (cause) => asServiceError(cause),
      });
      const intent = {
        deploymentId,
        controlEnvironmentId: yield* dependencies.environment.getEnvironmentId,
        profileId: profile.profileId,
        profileRevision: profile.revision,
        profileSnapshot: profile,
        providerInstanceId: input.providerInstanceId,
        label: input.label,
        source,
        bootstrapManifest,
        workspaceRoot: DEFAULT_SANDBOX_WORKSPACE_ROOT,
        kataHome: DEFAULT_SANDBOX_KATA_HOME,
        requestedAt: now(),
      };
      const operationId = SandboxOperationId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const receipt = createReceipt(
        operationId,
        input.requestId,
        "create",
        hash,
        deploymentId,
        undefined,
        input.expectedRevision ?? profile.revision,
      );
      const accepted = yield* acceptOperation({
        actor,
        receipt,
        deployment: requestDeployment(intent),
      });
      if (accepted.created) yield* scheduleOperation(accepted.receipt);
      return { operationId: accepted.receipt.operationId };
    });

  const deleteDeploymentCommand: SandboxDeploymentServiceShape["delete"] = (actor, input) =>
    Effect.gen(function* () {
      const hash = payloadHash({ command: "delete", input });
      const existing = yield* existingOperation(actor, input.requestId, hash);
      if (Option.isSome(existing)) return { operationId: existing.value.operationId };
      const deployment = yield* getDeployment(input.deploymentId);
      if (input.expectedRevision !== undefined && input.expectedRevision !== deployment.revision) {
        return yield* failConflict(`Deployment revision ${input.expectedRevision} is stale.`);
      }
      const operationId = SandboxOperationId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const receipt = createReceipt(
        operationId,
        input.requestId,
        "delete",
        hash,
        input.deploymentId,
        undefined,
        input.expectedRevision,
      );
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* scheduleOperation(accepted.receipt);
      return { operationId: accepted.receipt.operationId };
    });

  const start: SandboxDeploymentServiceShape["start"] = (actor, input) =>
    Effect.gen(function* () {
      const hash = payloadHash({ command: "start", input });
      const existing = yield* existingOperation(actor, input.requestId, hash);
      if (Option.isSome(existing)) return { operationId: existing.value.operationId };
      const deployment = yield* getDeployment(input.deploymentId);
      if (input.expectedRevision !== deployment.revision) {
        return yield* failConflict(`Deployment revision ${input.expectedRevision} is stale.`);
      }
      if (deployment.state !== "Identified") {
        return yield* failConflict("Only an identified sandbox can be started.");
      }
      if (driverFor(deployment.intent.profileSnapshot).power === undefined) {
        return yield* failConflict("The sandbox provider does not support start and stop.");
      }
      const operationId = SandboxOperationId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const receipt = createReceipt(
        operationId,
        input.requestId,
        "start",
        hash,
        input.deploymentId,
        input.attachment,
        input.expectedRevision,
      );
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* scheduleOperation(accepted.receipt);
      return { operationId: accepted.receipt.operationId };
    });

  const stop: SandboxDeploymentServiceShape["stop"] = (actor, input) =>
    Effect.gen(function* () {
      const hash = payloadHash({ command: "stop", input });
      const existing = yield* existingOperation(actor, input.requestId, hash);
      if (Option.isSome(existing)) return { operationId: existing.value.operationId };
      const deployment = yield* getDeployment(input.deploymentId);
      if (input.expectedRevision !== deployment.revision) {
        return yield* failConflict(`Deployment revision ${input.expectedRevision} is stale.`);
      }
      if (deployment.state !== "Identified") {
        return yield* failConflict("Only an identified sandbox can be stopped.");
      }
      if (driverFor(deployment.intent.profileSnapshot).power === undefined) {
        return yield* failConflict("The sandbox provider does not support start and stop.");
      }
      const operationId = SandboxOperationId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const receipt = createReceipt(
        operationId,
        input.requestId,
        "stop",
        hash,
        input.deploymentId,
        undefined,
        input.expectedRevision,
      );
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* scheduleOperation(accepted.receipt);
      return { operationId: accepted.receipt.operationId };
    });

  const getOperation: SandboxDeploymentServiceShape["getOperation"] = (operationId) =>
    repository.getOperation(operationId).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((operation) =>
        Option.isSome(operation)
          ? Effect.succeed(operation.value)
          : failNotFound(`Sandbox operation '${operationId}' was not found.`),
      ),
    );

  const mintHandoff: SandboxDeploymentServiceShape["mintHandoff"] = (
    deploymentId,
    attachment = "direct",
  ) =>
    withDeploymentLock(
      deploymentId,
      Effect.gen(function* () {
        const deployment = yield* getDeployment(deploymentId);
        if (deployment.state !== "Identified") {
          return yield* failConflict("Only an identified sandbox can be attached.");
        }
        return yield* makeHandoff(deployment, attachment);
      }),
    );

  const reconcile: SandboxDeploymentServiceShape["reconcile"] = () =>
    Effect.gen(function* () {
      const deployments = yield* repository.listDeployments().pipe(Effect.mapError(asServiceError));
      const inFlight = yield* repository
        .listInFlightOperations()
        .pipe(Effect.mapError(asServiceError));
      const busyDeployments = new Set(
        inFlight.flatMap((operation) =>
          operation.deploymentId === undefined ? [] : [operation.deploymentId],
        ),
      );
      yield* Effect.forEach(
        deployments.filter(
          (deployment): deployment is IdentifiedDeployment =>
            deployment.state === "Identified" &&
            !busyDeployments.has(deployment.intent.deploymentId),
        ),
        (deployment) =>
          withDeploymentLock(deployment.intent.deploymentId, observeDeployment(deployment)).pipe(
            Effect.asVoid,
            Effect.catch((cause) =>
              Effect.logWarning("Sandbox provider reconciliation failed", {
                deploymentId: deployment.intent.deploymentId,
                cause,
              }).pipe(Effect.asVoid),
            ),
          ),
        { concurrency: 4, discard: true },
      );
    });

  const recover: SandboxDeploymentServiceShape["recover"] = () =>
    Effect.gen(function* () {
      yield* repository.releaseInFlightClaims().pipe(Effect.mapError(asServiceError));
      const operations = yield* repository
        .listInFlightOperations()
        .pipe(Effect.mapError(asServiceError));
      yield* Effect.forEach(operations, (operation) => scheduleOperation(operation), {
        discard: true,
      });
      yield* reconcile();
    });

  return {
    list,
    upsertProfile,
    deleteProfile,
    create,
    start,
    stop,
    delete: deleteDeploymentCommand,
    getOperation,
    mintHandoff,
    reconcile,
    recover,
  };
}

const makeService = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const githubAccess = yield* SandboxGitHubAccess;
  const relayUrl = yield* relayUrlConfig.pipe(Effect.option, Effect.map(Option.getOrUndefined));
  const operationScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(operationScope, Exit.void));
  const probeDriver = makeDockerSandboxDriver({
    endpointHost: resolveHeadlessConnectionHost(serverConfig.host),
    publishHost: publishHostForBind(serverConfig.host),
    checkoutCredential: githubAccess.checkoutCredential,
  });
  const httpClient = yield* HttpClient.HttpClient;
  const service = makeSandboxDeploymentService(
    {
      repository: yield* SandboxDeploymentRepository,
      environment: yield* ServerEnvironment.ServerEnvironment,
      cloudCliTokenManager: yield* CliTokenManager.CloudCliTokenManager,
      githubAccess,
      credentialSeed: yield* SandboxCredentialSeed,
      secretStore: yield* ServerSecretStore.ServerSecretStore,
      crypto: yield* Crypto.Crypto,
      httpClient,
    },
    {
      endpointHost: resolveHeadlessConnectionHost(serverConfig.host),
      publishHost: publishHostForBind(serverConfig.host),
      ...(serverConfig.sandboxImageRepository === undefined
        ? {}
        : { sandboxImageRepository: serverConfig.sandboxImageRepository }),
      hostAvailability: () =>
        probeSandboxHostAvailability({
          driver: probeDriver,
          registry: makeOciRegistry({
            repository:
              serverConfig.sandboxImageRepository?.trim() || DEFAULT_MANAGED_IMAGE_REPOSITORY,
            httpClient,
          }),
          serverVersion: packageJson.version,
        }),
      ...(relayUrl === undefined ? {} : { relayUrl }),
      operationScope,
    },
  );
  yield* Effect.forkIn(service.recover(), operationScope);
  return service;
});

export class SandboxDeploymentService extends Context.Service<
  SandboxDeploymentService,
  SandboxDeploymentServiceShape
>()("@kata-sh/code-cli/kataSandbox/SandboxDeploymentService") {}

export const layer = Layer.effect(SandboxDeploymentService, makeService).pipe(
  Layer.provide(sandboxDeploymentRepositoryLayer),
  Layer.provideMerge(sandboxGitHubAccessLayer),
  Layer.provide(sandboxCredentialSeedLayer),
);
