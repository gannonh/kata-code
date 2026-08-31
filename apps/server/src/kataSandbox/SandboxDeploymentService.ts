// @effect-diagnostics globalDate:off - operation timestamps use the injectable service clock.
// @effect-diagnostics nodeBuiltinImport:off - bootstrap tokens and request hashes use Node primitives.
// @effect-diagnostics preferSchemaOverJson:off - request hashes and private target HTTP bodies are JSON.
import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";

import { AuthPairingCredentialResult, EnvironmentId } from "@kata-sh/code-contracts";
import {
  DEFAULT_DOCKER_SOCKET_PATH,
  DEFAULT_SANDBOX_KATA_HOME,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  type SandboxDeployment,
  type SandboxDeploymentIntent,
  SandboxDeploymentId,
  SandboxEndpoint,
  SandboxOperationId,
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
  type SandboxProfileDeleteRequest,
  type SandboxProfileUpsertRequest,
  type SandboxAccepted,
} from "@kata-sh/code-kata-sandbox-contracts/http";
import type { SandboxHandoff } from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  allocateDeployment,
  deleteDeployment,
  identifyDeployment,
  redactDiagnostic,
  requestDeployment,
  resolveManagedImage,
  makeVcrOciRegistry,
  DEFAULT_VCR_IMAGE_REPOSITORY,
  SandboxDriverError,
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
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { resolveHeadlessConnectionHost } from "../startupAccess.ts";
import { makeDockerSandboxDriver } from "@kata-sh/code-kata-sandbox-docker";
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
import { SandboxSourceResolver, type SandboxSourceResolverShape } from "./SandboxSourceResolver.ts";
import { layer as sandboxSourceResolverLayer } from "./SandboxSourceResolver.ts";

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
}

export interface SandboxDeploymentServiceDependencies {
  readonly repository: SandboxDeploymentRepositoryShape;
  readonly environment: Pick<ServerEnvironment.ServerEnvironment["Service"], "getEnvironmentId">;
  readonly sourceResolver: SandboxSourceResolverShape;
  readonly credentialSeed: SandboxCredentialSeedShape;
  readonly secretStore: ServerSecretStore.ServerSecretStore["Service"];
  readonly crypto: Crypto.Crypto;
  readonly managedImageRegistry?: ManagedImageRegistry;
  readonly providerRegistry?: SandboxProviderRegistry;
}

export interface SandboxDeploymentServiceOptions {
  readonly driverFor?: (profile: SandboxProfile) => SandboxProviderDriver;
  readonly endpointHost?: string;
  readonly bootstrapManifestFor?: (
    profile: SandboxProfile,
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
  readonly delete: (
    actor: string,
    input: SandboxDeleteRequest,
  ) => Effect.Effect<SandboxAccepted, SandboxDeploymentServiceError>;
  readonly getOperation: (
    operationId: SandboxOperationId,
  ) => Effect.Effect<SandboxOperationReceipt, SandboxDeploymentServiceError>;
  readonly mintHandoff: (
    deploymentId: SandboxDeploymentId,
  ) => Effect.Effect<SandboxHandoff, SandboxDeploymentServiceError>;
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

function endpointPairingUrl(endpoint: string, credential: string): string {
  const url = new URL(endpoint);
  url.pathname = "/pair";
  url.search = "";
  url.hash = new URLSearchParams([["token", credential]]).toString();
  return url.toString();
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
          HttpClientRequest.bodyJsonUnsafe({ label: input.label }),
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
  const defaultDriver = makeDockerSandboxDriver({ endpointHost });
  const driverFor = options.driverFor ?? (() => defaultDriver);
  const providerRegistry =
    options.providerRegistry ??
    dependencies.providerRegistry ??
    new SandboxProviderRegistry([defaultDriver]);
  const managedImageRegistry =
    options.managedImageRegistry ??
    dependencies.managedImageRegistry ??
    makeVcrOciRegistry({
      repository:
        process.env.KATACODE_SANDBOX_IMAGE_REPOSITORY?.trim() || DEFAULT_VCR_IMAGE_REPOSITORY,
    });
  const bootstrapManifestFor = options.bootstrapManifestFor ?? buildSandboxBootstrapManifest;
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

  const saveOperation = (receipt: SandboxOperationReceipt) =>
    repository.saveOperation(receipt).pipe(Effect.mapError(asServiceError));

  const createReceipt = (
    operationId: SandboxOperationId,
    requestId:
      | SandboxCreateRequest["requestId"]
      | SandboxDeleteRequest["requestId"]
      | SandboxProfileDeleteRequest["requestId"]
      | SandboxProfileUpsertRequest["requestId"],
    command: SandboxOperationReceipt["command"],
    hash: string,
    deploymentId?: SandboxDeploymentId,
    expectedRevision?: number,
  ): SandboxOperationReceipt => ({
    operationId,
    requestId,
    command,
    payloadHash: hash,
    status: "Accepted",
    ...(deploymentId ? { deploymentId } : {}),
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
    update: Pick<SandboxOperationReceipt, "status"> &
      Partial<
        Pick<
          SandboxOperationReceipt,
          "result" | "error" | "deploymentId" | "progress" | "resolvedImageDigest"
        >
      >,
  ) =>
    repository.getOperation(receipt.operationId).pipe(
      Effect.mapError(asServiceError),
      Effect.flatMap((current) =>
        saveOperation({
          ...(Option.isSome(current) ? current.value : receipt),
          ...update,
          updatedAt: now(),
        }),
      ),
    );

  const markFailed = (receipt: SandboxOperationReceipt, cause: unknown) =>
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
        return updateOperation(latest, {
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

  const saveObservation = (deploymentId: SandboxDeploymentId, observation: ProviderObservation) =>
    repository.saveObservation(deploymentId, observation).pipe(Effect.mapError(asServiceError));

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

  const applyProfileUpsert = (input: SandboxProfileInput, receipt?: SandboxOperationReceipt) =>
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
        receipt === undefined
          ? Effect.void
          : updateOperation(receipt, { status: "Running", progress }).pipe(
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
      if (receipt !== undefined) {
        yield* updateOperation(receipt, {
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

  const observationFor = (
    deployment: AllocatedDeployment | IdentifiedDeployment,
  ): Effect.Effect<ProviderObservation, SandboxDeploymentServiceError> =>
    Effect.gen(function* () {
      const driver = driverFor(deployment.intent.profileSnapshot);
      const observation = yield* driver
        .observe({ profile: deployment.intent.profileSnapshot, resource: deployment.resource })
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
      return observation;
    });

  const compensateAllocation = (
    deployment: AllocatedDeployment | IdentifiedDeployment,
    original: unknown,
  ): Effect.Effect<never, SandboxDeploymentServiceError> =>
    Effect.gen(function* () {
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

  const processCreate = (receipt: SandboxOperationReceipt) =>
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
        yield* driver
          .validateProfile(
            profile,
            (progress) =>
              updateOperation(receipt, { status: "Running", progress }).pipe(
                Effect.catch(() => Effect.void),
              ),
            { pullIfMissing: false },
          )
          .pipe(Effect.mapError(asServiceError));
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
        yield* saveDeployment(allocated, deployment.revision).pipe(
          Effect.catch((cause) => compensateAllocation(allocated, cause)),
        );
        deployment = allocated;
      }

      if (deployment.state === "Allocated") {
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
            Effect.catch((cause) => compensateAllocation(deployment as AllocatedDeployment, cause)),
          );
        const next = identifyDeployment(
          deployment,
          EnvironmentId.make(identified.environmentId),
          SandboxEndpoint.make(identified.endpoint),
          identified.resource,
          now(),
        );
        yield* saveDeployment(next, deployment.revision);
        deployment = next;
        yield* saveObservation(deploymentId, {
          state: "Running",
          observedAt: now(),
          environmentId: next.environmentId,
          endpoint: next.endpoint,
        });
      } else if (deployment.state === "Identified") {
        const observation = yield* observationFor(deployment);
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
      yield* updateOperation(receipt, {
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

  const processDelete = (receipt: SandboxOperationReceipt) =>
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
      if (deployment.state === "Deleted") {
        yield* updateOperation(receipt, {
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
        const deleted = deleteDeployment(deployment, now());
        yield* saveDeployment(deleted, deployment.revision);
        yield* updateOperation(receipt, {
          status: "Succeeded",
          result: operationResultForDeleted(deleted),
        });
        return;
      }

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
      yield* saveObservation(deploymentId, observation);
      if (observation.state !== "Gone") {
        return yield* failCommand(
          observation.state === "Unknown"
            ? observation.diagnostic
            : "Docker reported the sandbox is still running after deletion.",
        );
      }

      const deleted = deleteDeployment(deployment, now());
      yield* saveDeployment(deleted, deployment.revision);
      yield* dependencies.secretStore
        .remove(BOOTSTRAP_SECRET_PREFIX + deploymentId)
        .pipe(Effect.catch(() => Effect.void));
      yield* updateOperation(receipt, {
        status: "Succeeded",
        result: operationResultForDeleted(deleted),
      });
    });

  const processProfileUpsert = (receipt: SandboxOperationReceipt) =>
    Effect.gen(function* () {
      if (receipt.profileInput === undefined) {
        return yield* failCommand("Profile upsert operation has no profile input.");
      }
      const profile = yield* applyProfileUpsert(receipt.profileInput, receipt);
      yield* updateOperation(receipt, {
        status: "Succeeded",
        progress: { stage: "ready" },
        result: { kind: "profile", profileId: profile.profileId },
      });
    });

  const processProfileDelete = (receipt: SandboxOperationReceipt) =>
    Effect.gen(function* () {
      const profileId = receipt.profileId;
      if (profileId === undefined)
        return yield* failCommand("Profile delete operation has no profile id.");
      yield* repository
        .deleteProfile(profileId, receipt.expectedRevision)
        .pipe(Effect.mapError(asServiceError));
      yield* updateOperation(receipt, {
        status: "Succeeded",
        result: { kind: "profile", profileId },
      });
    });

  const runOperation = (receipt: SandboxOperationReceipt) =>
    updateOperation(receipt, { status: "Running" }).pipe(
      Effect.andThen(
        receipt.command === "profile-upsert"
          ? processProfileUpsert(receipt)
          : receipt.command === "create"
            ? processCreate(receipt)
            : receipt.command === "delete"
              ? processDelete(receipt)
              : receipt.command === "profile-delete"
                ? processProfileDelete(receipt)
                : failCommand(`Unsupported sandbox operation '${receipt.command}'.`),
      ),
      Effect.catch((cause) => markFailed(receipt, cause)),
    );

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
        { concurrency: "unbounded" },
      );
      const deployments = yield* repository.listDeployments().pipe(Effect.mapError(asServiceError));
      const deploymentSummaries = yield* Effect.all(
        deployments.map((deployment) => {
          if (deployment.state === "Requested" || deployment.state === "Deleted") {
            return Effect.succeed({ deployment });
          }
          return observationFor(deployment).pipe(
            Effect.map((observation) => ({ deployment, observation })),
            Effect.catch((cause) =>
              Effect.succeed({
                deployment,
                observation: {
                  state: "Unknown" as const,
                  observedAt: now(),
                  diagnostic: diagnostic(cause),
                },
              }),
            ),
          );
        }),
        { concurrency: "unbounded" },
      );
      return {
        profiles: profileSummaries,
        deployments: deploymentSummaries,
        providers: providerRegistry.listDescriptors(),
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
      if (accepted.created) yield* schedule(runOperation(accepted.receipt));
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
          input.expectedRevision,
        ),
        profileId: profile.profileId,
      } satisfies SandboxOperationReceipt;
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* schedule(runOperation(accepted.receipt));
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
      const source = yield* dependencies.sourceResolver
        .resolve(input.source)
        .pipe(Effect.mapError((cause) => asServiceError(cause)));
      const deploymentId = SandboxDeploymentId.make(
        yield* dependencies.crypto.randomUUIDv4.pipe(Effect.mapError(asServiceError)),
      );
      const bootstrapManifest = yield* Effect.try({
        try: () => bootstrapManifestFor(profile),
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
        input.expectedRevision,
      );
      const accepted = yield* acceptOperation({
        actor,
        receipt,
        deployment: requestDeployment(intent),
      });
      if (accepted.created) yield* schedule(runOperation(accepted.receipt));
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
        input.expectedRevision,
      );
      const accepted = yield* acceptOperation({ actor, receipt });
      if (accepted.created) yield* schedule(runOperation(accepted.receipt));
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

  const mintHandoff: SandboxDeploymentServiceShape["mintHandoff"] = (deploymentId) =>
    Effect.gen(function* () {
      const deployment = yield* getDeployment(deploymentId);
      if (deployment.state !== "Identified") {
        return yield* failConflict("Only an identified sandbox can be attached.");
      }
      const bootstrapToken = yield* bootstrapTokenFor(deploymentId);
      const observation = yield* observationFor(deployment);
      if (observation.state !== "Running") {
        return yield* failConflict(
          observation.state === "Unknown"
            ? observation.diagnostic
            : "The sandbox container is no longer available.",
        );
      }
      const issued = yield* issuePairingCredential({
        endpoint: deployment.endpoint,
        bootstrapToken,
        label: targetPairingLabel(deploymentId),
      });
      return {
        deploymentId,
        environmentId: deployment.environmentId,
        endpoint: deployment.endpoint,
        pairingUrl: endpointPairingUrl(deployment.endpoint, issued.credential),
        workspaceRoot: deployment.workspaceRoot,
        expiresAt: issued.expiresAt,
      } satisfies SandboxHandoff;
    });

  const recover: SandboxDeploymentServiceShape["recover"] = () =>
    repository.listInFlightOperations().pipe(
      Effect.mapError(asServiceError),
      Effect.tap((operations) =>
        Effect.forEach(operations, (operation) => schedule(runOperation(operation)), {
          discard: true,
        }),
      ),
      Effect.asVoid,
    );

  return {
    list,
    upsertProfile,
    deleteProfile,
    create,
    delete: deleteDeploymentCommand,
    getOperation,
    mintHandoff,
    recover,
  };
}

const makeService = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const operationScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(operationScope, Exit.void));
  const service = makeSandboxDeploymentService(
    {
      repository: yield* SandboxDeploymentRepository,
      environment: yield* ServerEnvironment.ServerEnvironment,
      sourceResolver: yield* SandboxSourceResolver,
      credentialSeed: yield* SandboxCredentialSeed,
      secretStore: yield* ServerSecretStore.ServerSecretStore,
      crypto: yield* Crypto.Crypto,
    },
    {
      endpointHost: resolveHeadlessConnectionHost(serverConfig.host),
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
  Layer.provide(sandboxSourceResolverLayer),
  Layer.provide(sandboxCredentialSeedLayer),
);
