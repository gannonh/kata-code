// @effect-diagnostics preferSchemaOverJson:off - JSON columns store versioned domain snapshots.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  DockerResourceHandle,
  ProviderObservation,
  SandboxDeployment,
  SandboxDeploymentIntent,
  SandboxDeploymentId,
  SandboxOperationReceipt,
  SandboxOperationResult,
  SandboxProfile,
  SandboxProfileInput,
  SandboxProviderProfileId,
  SandboxRequestId,
  type RequestedDeployment,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

import {
  isPersistenceError,
  toPersistenceSqlError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../persistence/Errors.ts";

export class SandboxRepositoryConflictError extends Data.TaggedError(
  "SandboxRepositoryConflictError",
)<{
  readonly resource: string;
  readonly message: string;
}> {}

export type SandboxRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError
  | SandboxRepositoryConflictError;

export interface SandboxAcceptedOperation {
  readonly actor: string;
  readonly receipt: SandboxOperationReceipt;
  readonly deployment?: RequestedDeployment;
}

export interface SandboxDeploymentRepositoryShape {
  readonly listProfiles: () => Effect.Effect<ReadonlyArray<SandboxProfile>, SandboxRepositoryError>;
  readonly getProfile: (
    profileId: SandboxProviderProfileId,
  ) => Effect.Effect<Option.Option<SandboxProfile>, SandboxRepositoryError>;
  readonly saveProfile: (
    profile: SandboxProfile,
    expectedRevision?: number,
  ) => Effect.Effect<void, SandboxRepositoryError>;
  readonly deleteProfile: (
    profileId: SandboxProviderProfileId,
  ) => Effect.Effect<void, SandboxRepositoryError>;
  readonly listDeployments: () => Effect.Effect<
    ReadonlyArray<SandboxDeployment>,
    SandboxRepositoryError
  >;
  readonly getDeployment: (
    deploymentId: SandboxDeploymentId,
  ) => Effect.Effect<Option.Option<SandboxDeployment>, SandboxRepositoryError>;
  readonly saveDeployment: (
    deployment: SandboxDeployment,
    expectedRevision?: number,
  ) => Effect.Effect<void, SandboxRepositoryError>;
  readonly getObservation: (
    deploymentId: SandboxDeploymentId,
  ) => Effect.Effect<Option.Option<ProviderObservation>, SandboxRepositoryError>;
  readonly saveObservation: (
    deploymentId: SandboxDeploymentId,
    observation: ProviderObservation,
  ) => Effect.Effect<void, SandboxRepositoryError>;
  readonly accept: (
    input: SandboxAcceptedOperation,
  ) => Effect.Effect<SandboxOperationReceipt, SandboxRepositoryError>;
  readonly getOperation: (
    operationId: string,
  ) => Effect.Effect<Option.Option<SandboxOperationReceipt>, SandboxRepositoryError>;
  readonly getOperationByRequest: (
    actor: string,
    requestId: SandboxRequestId,
  ) => Effect.Effect<Option.Option<SandboxOperationReceipt>, SandboxRepositoryError>;
  readonly saveOperation: (
    receipt: SandboxOperationReceipt,
  ) => Effect.Effect<void, SandboxRepositoryError>;
  readonly listInFlightOperations: () => Effect.Effect<
    ReadonlyArray<SandboxOperationReceipt>,
    SandboxRepositoryError
  >;
}

export class SandboxDeploymentRepository extends Context.Service<
  SandboxDeploymentRepository,
  SandboxDeploymentRepositoryShape
>()("@kata-sh/code-cli/kataSandbox/SandboxDeploymentRepository") {}

const ProfileRow = Schema.Struct({
  profileId: Schema.String,
  name: Schema.String,
  driverKind: Schema.String,
  socketPath: Schema.String,
  imageDigest: Schema.String,
  enabled: Schema.Int,
  revision: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const DeploymentRow = Schema.Struct({
  deploymentId: Schema.String,
  state: Schema.String,
  revision: Schema.Int,
  intentJson: Schema.NullOr(Schema.String),
  resourceJson: Schema.NullOr(Schema.String),
  profileId: Schema.NullOr(Schema.String),
  environmentId: Schema.NullOr(Schema.String),
  endpoint: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.NullOr(Schema.String),
  kataHome: Schema.NullOr(Schema.String),
  identifiedAt: Schema.NullOr(Schema.String),
  deletedAt: Schema.NullOr(Schema.String),
});

const ObservationRow = Schema.Struct({
  observationJson: Schema.String,
});

const OperationRow = Schema.Struct({
  operationId: Schema.String,
  actor: Schema.String,
  requestId: Schema.String,
  command: Schema.String,
  payloadHash: Schema.String,
  status: Schema.String,
  deploymentId: Schema.NullOr(Schema.String),
  profileId: Schema.NullOr(Schema.String),
  profileInputJson: Schema.NullOr(Schema.String),
  resultJson: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  acceptedAt: Schema.String,
  updatedAt: Schema.String,
});

const decodeDeploymentRow = Schema.decodeUnknownEffect(DeploymentRow);
const decodeObservationRow = Schema.decodeUnknownEffect(ObservationRow);
const decodeOperationRow = Schema.decodeUnknownEffect(OperationRow);
const decodeSandboxProfile = Schema.decodeUnknownEffect(SandboxProfile);
const decodeSandboxDeployment = Schema.decodeUnknownEffect(SandboxDeployment);
const decodeSandboxDeploymentIntent = Schema.decodeUnknownEffect(SandboxDeploymentIntent);
const decodeDockerResourceHandle = Schema.decodeUnknownEffect(DockerResourceHandle);
const decodeProviderObservation = Schema.decodeUnknownEffect(ProviderObservation);
const decodeSandboxOperationResult = Schema.decodeUnknownEffect(SandboxOperationResult);
const decodeSandboxOperationReceipt = Schema.decodeUnknownEffect(SandboxOperationReceipt);
const decodeSandboxProfileInput = Schema.decodeUnknownEffect(SandboxProfileInput);

function decodeFailure(operation: string, cause: unknown): PersistenceDecodeError {
  return new PersistenceDecodeError({
    operation,
    issue: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function decodeJson<T>(
  decode: (value: unknown) => Effect.Effect<T, Schema.SchemaError>,
  value: string,
  operation: string,
): Effect.Effect<T, PersistenceDecodeError> {
  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: (cause) => decodeFailure(operation, cause),
  }).pipe(
    Effect.flatMap((parsed) =>
      decode(parsed).pipe(
        Effect.mapError((cause) => PersistenceDecodeError.fromSchemaError(operation, cause)),
      ),
    ),
  );
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromProfileRow(
  row: typeof ProfileRow.Type,
): Effect.Effect<SandboxProfile, PersistenceDecodeError> {
  return decodeSandboxProfile({
    profileId: row.profileId,
    name: row.name,
    driverKind: row.driverKind,
    socketPath: row.socketPath,
    imageDigest: row.imageDigest,
    enabled: row.enabled === 1,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }).pipe(
    Effect.mapError((cause) => PersistenceDecodeError.fromSchemaError("profile.decode", cause)),
  );
}

function fromDeploymentRow(raw: unknown): Effect.Effect<SandboxDeployment, PersistenceDecodeError> {
  return decodeDeploymentRow(raw).pipe(
    Effect.mapError((cause) =>
      PersistenceDecodeError.fromSchemaError("deployment.row.decode", cause),
    ),
    Effect.flatMap((row) =>
      Effect.gen(function* () {
        const intent =
          row.intentJson === null
            ? undefined
            : yield* decodeJson(
                decodeSandboxDeploymentIntent,
                row.intentJson,
                "deployment.intent.decode",
              );
        const resource =
          row.resourceJson === null
            ? undefined
            : yield* decodeJson(
                decodeDockerResourceHandle,
                row.resourceJson,
                "deployment.resource.decode",
              );

        switch (row.state) {
          case "Requested":
            if (intent === undefined)
              return yield* decodeFailure(
                "deployment.decode",
                "Requested deployment has no intent.",
              );
            return yield* decodeSandboxDeployment({
              state: "Requested",
              revision: row.revision,
              intent,
            }).pipe(
              Effect.mapError((cause) =>
                PersistenceDecodeError.fromSchemaError("deployment.decode", cause),
              ),
            );
          case "Allocated":
            if (intent === undefined || resource === undefined) {
              return yield* decodeFailure(
                "deployment.decode",
                "Allocated deployment is incomplete.",
              );
            }
            return yield* decodeSandboxDeployment({
              state: "Allocated",
              revision: row.revision,
              intent,
              resource,
            }).pipe(
              Effect.mapError((cause) =>
                PersistenceDecodeError.fromSchemaError("deployment.decode", cause),
              ),
            );
          case "Identified":
            if (
              intent === undefined ||
              resource === undefined ||
              row.environmentId === null ||
              row.endpoint === null ||
              row.workspaceRoot === null ||
              row.kataHome === null ||
              row.identifiedAt === null
            ) {
              return yield* decodeFailure(
                "deployment.decode",
                "Identified deployment is incomplete.",
              );
            }
            return yield* decodeSandboxDeployment({
              state: "Identified",
              revision: row.revision,
              intent,
              resource,
              environmentId: row.environmentId,
              endpoint: row.endpoint,
              workspaceRoot: row.workspaceRoot,
              kataHome: row.kataHome,
              identifiedAt: row.identifiedAt,
            }).pipe(
              Effect.mapError((cause) =>
                PersistenceDecodeError.fromSchemaError("deployment.decode", cause),
              ),
            );
          case "Deleted":
            if (row.deletedAt === null || row.profileId === null) {
              return yield* decodeFailure("deployment.decode", "Deleted deployment is incomplete.");
            }
            return yield* decodeSandboxDeployment({
              state: "Deleted",
              revision: row.revision,
              deploymentId: row.deploymentId,
              profileId: row.profileId,
              ...(row.environmentId === null ? {} : { environmentId: row.environmentId }),
              deletedAt: row.deletedAt,
            }).pipe(
              Effect.mapError((cause) =>
                PersistenceDecodeError.fromSchemaError("deployment.decode", cause),
              ),
            );
          default:
            return yield* decodeFailure(
              "deployment.decode",
              `Unknown deployment state '${row.state}'.`,
            );
        }
      }),
    ),
  );
}

function fromObservationRow(
  raw: unknown,
): Effect.Effect<ProviderObservation, PersistenceDecodeError> {
  return decodeObservationRow(raw).pipe(
    Effect.mapError((cause) =>
      PersistenceDecodeError.fromSchemaError("observation.row.decode", cause),
    ),
    Effect.flatMap((row) =>
      decodeJson(decodeProviderObservation, row.observationJson, "observation.decode"),
    ),
  );
}

function fromOperationRow(
  raw: unknown,
): Effect.Effect<SandboxOperationReceipt, PersistenceDecodeError> {
  return decodeOperationRow(raw).pipe(
    Effect.mapError((cause) =>
      PersistenceDecodeError.fromSchemaError("operation.row.decode", cause),
    ),
    Effect.flatMap((row) =>
      Effect.gen(function* () {
        const result =
          row.resultJson === null
            ? undefined
            : yield* decodeJson(
                decodeSandboxOperationResult,
                row.resultJson,
                "operation.result.decode",
              );
        return yield* decodeSandboxOperationReceipt({
          operationId: row.operationId,
          requestId: row.requestId,
          command: row.command,
          payloadHash: row.payloadHash,
          status: row.status,
          ...(row.deploymentId === null ? {} : { deploymentId: row.deploymentId }),
          ...(row.profileId === null ? {} : { profileId: row.profileId }),
          ...(row.profileInputJson === null
            ? {}
            : {
                profileInput: yield* decodeJson(
                  decodeSandboxProfileInput,
                  row.profileInputJson,
                  "operation.profile-input.decode",
                ),
              }),
          ...(result === undefined ? {} : { result }),
          ...(row.error === null ? {} : { error: row.error }),
          acceptedAt: row.acceptedAt,
          updatedAt: row.updatedAt,
        }).pipe(
          Effect.mapError((cause) =>
            PersistenceDecodeError.fromSchemaError("operation.decode", cause),
          ),
        );
      }),
    ),
  );
}

const profileInput = Schema.Struct({ profileId: SandboxProviderProfileId });
const deploymentInput = Schema.Struct({ deploymentId: SandboxDeploymentId });

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProfileRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProfileRow,
    execute: () => sql`
      SELECT
        profile_id AS "profileId",
        name,
        driver_kind AS "driverKind",
        socket_path AS "socketPath",
        image_digest AS "imageDigest",
        enabled,
        revision,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM kata_sandbox_profiles
      ORDER BY name ASC, profile_id ASC
    `,
  });

  const getProfileRow = SqlSchema.findOneOption({
    Request: profileInput,
    Result: ProfileRow,
    execute: ({ profileId }) => sql`
      SELECT
        profile_id AS "profileId",
        name,
        driver_kind AS "driverKind",
        socket_path AS "socketPath",
        image_digest AS "imageDigest",
        enabled,
        revision,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM kata_sandbox_profiles
      WHERE profile_id = ${profileId}
    `,
  });

  const listDeploymentRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: DeploymentRow,
    execute: () => sql`
      SELECT
        deployment_id AS "deploymentId",
        state,
        revision,
        intent_json AS "intentJson",
        resource_json AS "resourceJson",
        profile_id AS "profileId",
        environment_id AS "environmentId",
        endpoint,
        workspace_root AS "workspaceRoot",
        kata_home AS "kataHome",
        identified_at AS "identifiedAt",
        deleted_at AS "deletedAt"
      FROM kata_sandbox_deployments
      ORDER BY deployment_id ASC
    `,
  });

  const getDeploymentRow = SqlSchema.findOneOption({
    Request: deploymentInput,
    Result: DeploymentRow,
    execute: ({ deploymentId }) => sql`
      SELECT
        deployment_id AS "deploymentId",
        state,
        revision,
        intent_json AS "intentJson",
        resource_json AS "resourceJson",
        profile_id AS "profileId",
        environment_id AS "environmentId",
        endpoint,
        workspace_root AS "workspaceRoot",
        kata_home AS "kataHome",
        identified_at AS "identifiedAt",
        deleted_at AS "deletedAt"
      FROM kata_sandbox_deployments
      WHERE deployment_id = ${deploymentId}
    `,
  });

  const getOperationRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ operationId: Schema.String }),
    Result: OperationRow,
    execute: ({ operationId }) => sql`
      SELECT
        operation_id AS "operationId",
        actor,
        request_id AS "requestId",
        command,
        payload_hash AS "payloadHash",
        status,
        deployment_id AS "deploymentId",
        profile_id AS "profileId",
        profile_input_json AS "profileInputJson",
        result_json AS "resultJson",
        error,
        accepted_at AS "acceptedAt",
        updated_at AS "updatedAt"
      FROM kata_sandbox_operation_receipts
      WHERE operation_id = ${operationId}
    `,
  });

  const getOperationByRequestRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ actor: Schema.String, requestId: SandboxRequestId }),
    Result: OperationRow,
    execute: ({ actor, requestId }) => sql`
      SELECT
        operation_id AS "operationId",
        actor,
        request_id AS "requestId",
        command,
        payload_hash AS "payloadHash",
        status,
        deployment_id AS "deploymentId",
        profile_id AS "profileId",
        profile_input_json AS "profileInputJson",
        result_json AS "resultJson",
        error,
        accepted_at AS "acceptedAt",
        updated_at AS "updatedAt"
      FROM kata_sandbox_operation_receipts
      WHERE actor = ${actor} AND request_id = ${requestId}
    `,
  });

  const listInFlightRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: OperationRow,
    execute: () => sql`
      SELECT
        operation_id AS "operationId",
        actor,
        request_id AS "requestId",
        command,
        payload_hash AS "payloadHash",
        status,
        deployment_id AS "deploymentId",
        profile_id AS "profileId",
        profile_input_json AS "profileInputJson",
        result_json AS "resultJson",
        error,
        accepted_at AS "acceptedAt",
        updated_at AS "updatedAt"
      FROM kata_sandbox_operation_receipts
      WHERE status IN ('Accepted', 'Running')
      ORDER BY accepted_at ASC, operation_id ASC
    `,
  });

  const mapSql =
    (operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, SandboxRepositoryError, R> =>
      effect.pipe(
        Effect.mapError((cause): SandboxRepositoryError => {
          if (Schema.isSchemaError(cause)) {
            return PersistenceDecodeError.fromSchemaError(operation, cause);
          }
          if (isPersistenceError(cause) || cause instanceof SandboxRepositoryConflictError) {
            return cause;
          }
          return toPersistenceSqlError(operation)(cause);
        }),
      );

  const listProfiles = () =>
    listProfileRows(undefined).pipe(
      Effect.flatMap((rows) => Effect.all(rows.map(fromProfileRow))),
      mapSql("SandboxDeploymentRepository.listProfiles"),
    );

  const getProfile = (profileId: SandboxProviderProfileId) =>
    getProfileRow({ profileId }).pipe(
      Effect.flatMap((value) =>
        Option.isNone(value)
          ? Effect.succeed(Option.none())
          : fromProfileRow(value.value).pipe(Effect.map(Option.some)),
      ),
      mapSql("SandboxDeploymentRepository.getProfile"),
    );

  const listDeployments = () =>
    listDeploymentRows(undefined).pipe(
      Effect.flatMap((rows) => Effect.all(rows.map(fromDeploymentRow))),
      mapSql("SandboxDeploymentRepository.listDeployments"),
    );

  const getDeployment = (deploymentId: SandboxDeploymentId) =>
    getDeploymentRow({ deploymentId }).pipe(
      Effect.flatMap((value) =>
        Option.isNone(value)
          ? Effect.succeed(Option.none())
          : fromDeploymentRow(value.value).pipe(Effect.map(Option.some)),
      ),
      mapSql("SandboxDeploymentRepository.getDeployment"),
    );

  const getObservationRow = SqlSchema.findOneOption({
    Request: deploymentInput,
    Result: ObservationRow,
    execute: ({ deploymentId }) => sql`
      SELECT observation_json AS "observationJson"
      FROM kata_sandbox_observations
      WHERE deployment_id = ${deploymentId}
    `,
  });

  const getObservation = (deploymentId: SandboxDeploymentId) =>
    getObservationRow({ deploymentId }).pipe(
      Effect.flatMap((value) =>
        Option.isNone(value)
          ? Effect.succeed(Option.none())
          : fromObservationRow(value.value).pipe(Effect.map(Option.some)),
      ),
      mapSql("SandboxDeploymentRepository.getObservation"),
    );

  const saveProfile = (profile: SandboxProfile, expectedRevision?: number) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          if (expectedRevision === undefined) {
            yield* sql`
            INSERT INTO kata_sandbox_profiles (
              profile_id, name, driver_kind, socket_path, image_digest,
              enabled, revision, created_at, updated_at
            ) VALUES (
              ${profile.profileId}, ${profile.name}, ${profile.driverKind}, ${profile.socketPath},
              ${profile.imageDigest}, ${profile.enabled ? 1 : 0}, ${profile.revision},
              ${profile.createdAt}, ${profile.updatedAt}
            )
          `;
            return;
          }
          const changed = yield* sql`
          UPDATE kata_sandbox_profiles
          SET name = ${profile.name},
              driver_kind = ${profile.driverKind},
              socket_path = ${profile.socketPath},
              image_digest = ${profile.imageDigest},
              enabled = ${profile.enabled ? 1 : 0},
              revision = ${profile.revision},
              updated_at = ${profile.updatedAt}
          WHERE profile_id = ${profile.profileId}
            AND revision = ${expectedRevision}
          RETURNING profile_id
        `;
          if (changed.length === 0) {
            return yield* new SandboxRepositoryConflictError({
              resource: profile.profileId,
              message: `Profile revision ${expectedRevision} is stale.`,
            });
          }
        }),
      )
      .pipe(mapSql("SandboxDeploymentRepository.saveProfile"));

  const saveDeployment = (deployment: SandboxDeployment, expectedRevision?: number) => {
    const intent = "intent" in deployment ? deployment.intent : undefined;
    const resource = "resource" in deployment ? deployment.resource : undefined;
    const environmentId = "environmentId" in deployment ? deployment.environmentId : undefined;
    const endpoint = "endpoint" in deployment ? deployment.endpoint : undefined;
    const workspaceRoot = "workspaceRoot" in deployment ? deployment.workspaceRoot : undefined;
    const kataHome = "kataHome" in deployment ? deployment.kataHome : undefined;
    const identifiedAt = "identifiedAt" in deployment ? deployment.identifiedAt : undefined;
    const deletedAt = "deletedAt" in deployment ? deployment.deletedAt : undefined;
    const profileId =
      deployment.state === "Deleted" ? deployment.profileId : deployment.intent.profileId;

    return sql
      .withTransaction(
        Effect.gen(function* () {
          if (expectedRevision === undefined) {
            yield* sql`
            INSERT INTO kata_sandbox_deployments (
              deployment_id, state, revision, intent_json, resource_json,
              profile_id, environment_id, endpoint, workspace_root, kata_home, identified_at, deleted_at
            ) VALUES (
              ${deployment.state === "Deleted" ? deployment.deploymentId : deployment.intent.deploymentId},
              ${deployment.state},
              ${deployment.revision},
              ${intent === undefined ? null : encodeJson(intent)},
              ${resource === undefined ? null : encodeJson(resource)},
              ${profileId ?? null},
              ${environmentId ?? null}, ${endpoint ?? null}, ${workspaceRoot ?? null},
              ${kataHome ?? null}, ${identifiedAt ?? null}, ${deletedAt ?? null}
            )
          `;
            return;
          }
          const changed = yield* sql`
          UPDATE kata_sandbox_deployments
          SET state = ${deployment.state},
              revision = ${deployment.revision},
              intent_json = ${intent === undefined ? null : encodeJson(intent)},
              resource_json = ${resource === undefined ? null : encodeJson(resource)},
              profile_id = ${profileId ?? null},
              environment_id = ${environmentId ?? null},
              endpoint = ${endpoint ?? null},
              workspace_root = ${workspaceRoot ?? null},
              kata_home = ${kataHome ?? null},
              identified_at = ${identifiedAt ?? null},
              deleted_at = ${deletedAt ?? null}
          WHERE deployment_id = ${deployment.state === "Deleted" ? deployment.deploymentId : deployment.intent.deploymentId}
            AND revision = ${expectedRevision}
          RETURNING deployment_id
        `;
          if (changed.length === 0) {
            return yield* new SandboxRepositoryConflictError({
              resource:
                deployment.state === "Deleted"
                  ? deployment.deploymentId
                  : deployment.intent.deploymentId,
              message: `Deployment revision ${expectedRevision} is stale.`,
            });
          }
        }),
      )
      .pipe(mapSql("SandboxDeploymentRepository.saveDeployment"));
  };

  const deleteProfile = (profileId: SandboxProviderProfileId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const profiles = yield* sql`
          SELECT enabled
          FROM kata_sandbox_profiles
          WHERE profile_id = ${profileId}
        `;
          if (profiles[0]?.enabled !== 0) {
            return yield* new SandboxRepositoryConflictError({
              resource: profileId,
              message: "Disable the sandbox profile before deleting it.",
            });
          }
          const references = yield* sql`
          SELECT deployment_id
          FROM kata_sandbox_deployments
          WHERE state != 'Deleted'
            AND json_extract(intent_json, '$.profileId') = ${profileId}
          LIMIT 1
        `;
          if (references.length > 0) {
            return yield* new SandboxRepositoryConflictError({
              resource: profileId,
              message: "Profile is still referenced by an active deployment.",
            });
          }
          yield* sql`DELETE FROM kata_sandbox_profiles WHERE profile_id = ${profileId}`;
        }),
      )
      .pipe(mapSql("SandboxDeploymentRepository.deleteProfile"));

  const saveObservation = (deploymentId: SandboxDeploymentId, observation: ProviderObservation) =>
    sql`
      INSERT INTO kata_sandbox_observations (deployment_id, observation_json)
      VALUES (${deploymentId}, ${encodeJson(observation)})
      ON CONFLICT (deployment_id)
      DO UPDATE SET observation_json = excluded.observation_json
    `.pipe(Effect.asVoid, mapSql("SandboxDeploymentRepository.saveObservation"));

  const insertReceipt = (input: SandboxAcceptedOperation) =>
    sql`
      INSERT INTO kata_sandbox_operation_receipts (
        operation_id, actor, request_id, command, payload_hash, status,
        deployment_id, profile_id, profile_input_json, result_json, error, accepted_at, updated_at
      ) VALUES (
        ${input.receipt.operationId}, ${input.actor}, ${input.receipt.requestId},
        ${input.receipt.command}, ${input.receipt.payloadHash}, ${input.receipt.status},
        ${input.receipt.deploymentId ?? null},
        ${input.receipt.profileId ?? null},
        ${input.receipt.profileInput === undefined ? null : encodeJson(input.receipt.profileInput)},
        ${input.receipt.result === undefined ? null : encodeJson(input.receipt.result)},
        ${input.receipt.error ?? null}, ${input.receipt.acceptedAt}, ${input.receipt.updatedAt}
      )
      ON CONFLICT (actor, request_id) DO NOTHING
    `.pipe(Effect.asVoid);

  const readReceiptRow = (
    value: Option.Option<typeof OperationRow.Type>,
    requestId: SandboxRequestId,
  ): Effect.Effect<SandboxOperationReceipt, SandboxRepositoryError> => {
    if (Option.isNone(value)) {
      return Effect.fail(
        new SandboxRepositoryConflictError({
          resource: requestId,
          message: "Accepted operation disappeared before it could be read.",
        }),
      );
    }
    return fromOperationRow(value.value);
  };

  const accept = (
    input: SandboxAcceptedOperation,
  ): Effect.Effect<SandboxOperationReceipt, SandboxRepositoryError> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const before = yield* sql`
          SELECT operation_id
          FROM kata_sandbox_operation_receipts
          WHERE actor = ${input.actor} AND request_id = ${input.receipt.requestId}
        `;
          if (
            before.length === 0 &&
            input.receipt.command === "delete" &&
            input.receipt.deploymentId
          ) {
            const creates = yield* sql`
            SELECT operation_id
            FROM kata_sandbox_operation_receipts
            WHERE command = 'create'
              AND deployment_id = ${input.receipt.deploymentId}
              AND status IN ('Accepted', 'Running')
            LIMIT 1
          `;
            if (creates.length > 0) {
              return yield* new SandboxRepositoryConflictError({
                resource: input.receipt.deploymentId,
                message: "The sandbox deployment is still being created.",
              });
            }
          }
          if (
            before.length === 0 &&
            input.receipt.command === "profile-upsert" &&
            input.receipt.profileInput?.profileId !== undefined
          ) {
            const profiles = yield* sql`
            SELECT revision
            FROM kata_sandbox_profiles
            WHERE profile_id = ${input.receipt.profileInput.profileId}
          `;
            const currentRevision = profiles[0]?.revision;
            if (
              (currentRevision !== undefined &&
                (input.receipt.profileInput.expectedRevision === undefined ||
                  input.receipt.profileInput.expectedRevision !== currentRevision)) ||
              (currentRevision === undefined &&
                input.receipt.profileInput.expectedRevision !== undefined &&
                input.receipt.profileInput.expectedRevision !== 0)
            ) {
              return yield* new SandboxRepositoryConflictError({
                resource: input.receipt.profileInput.profileId,
                message: "The sandbox profile revision is stale.",
              });
            }
          }
          if (
            before.length === 0 &&
            input.receipt.command === "profile-delete" &&
            input.receipt.profileId
          ) {
            const profiles = yield* sql`
            SELECT enabled
            FROM kata_sandbox_profiles
            WHERE profile_id = ${input.receipt.profileId}
          `;
            if (profiles[0]?.enabled !== 0) {
              return yield* new SandboxRepositoryConflictError({
                resource: input.receipt.profileId,
                message: "Disable the sandbox profile before deleting it.",
              });
            }
            const references = yield* sql`
            SELECT deployment_id
            FROM kata_sandbox_deployments
            WHERE state != 'Deleted'
              AND profile_id = ${input.receipt.profileId}
            LIMIT 1
          `;
            if (references.length > 0) {
              return yield* new SandboxRepositoryConflictError({
                resource: input.receipt.profileId,
                message: "Profile is still referenced by an active deployment.",
              });
            }
          }
          if (before.length === 0 && input.receipt.command === "create" && input.deployment) {
            const profiles = yield* sql`
            SELECT enabled
            FROM kata_sandbox_profiles
            WHERE profile_id = ${input.deployment.intent.profileId}
          `;
            if (profiles[0]?.enabled !== 1) {
              return yield* new SandboxRepositoryConflictError({
                resource: input.deployment.intent.profileId,
                message: "Sandbox profile is unavailable.",
              });
            }
          }
          yield* insertReceipt(input);
          if (before.length === 0 && input.deployment !== undefined) {
            const deployment = input.deployment;
            yield* sql`
            INSERT INTO kata_sandbox_deployments (
              deployment_id, state, revision, intent_json, resource_json,
              profile_id, environment_id, endpoint, workspace_root, kata_home, identified_at, deleted_at
            ) VALUES (
              ${deployment.intent.deploymentId}, 'Requested', ${deployment.revision},
              ${encodeJson(deployment.intent)}, NULL, ${deployment.intent.profileId}, NULL, NULL, NULL, NULL, NULL, NULL
            )
          `;
          }
        }),
      )
      .pipe(
        Effect.asVoid,
        Effect.flatMap(() =>
          getOperationByRequestRow({ actor: input.actor, requestId: input.receipt.requestId }).pipe(
            Effect.flatMap((value) => readReceiptRow(value, input.receipt.requestId)),
          ),
        ),
        mapSql("SandboxDeploymentRepository.accept"),
      );

  const getOperation = (operationId: string) =>
    getOperationRow({ operationId }).pipe(
      Effect.flatMap((value) =>
        Option.isNone(value)
          ? Effect.succeed(Option.none())
          : fromOperationRow(value.value).pipe(Effect.map(Option.some)),
      ),
      mapSql("SandboxDeploymentRepository.getOperation"),
    );

  const getOperationByRequest = (actor: string, requestId: SandboxRequestId) =>
    getOperationByRequestRow({ actor, requestId }).pipe(
      Effect.flatMap((value) =>
        Option.isNone(value)
          ? Effect.succeed(Option.none())
          : fromOperationRow(value.value).pipe(Effect.map(Option.some)),
      ),
      mapSql("SandboxDeploymentRepository.getOperationByRequest"),
    );

  const saveOperation = (receipt: SandboxOperationReceipt) =>
    sql`
      UPDATE kata_sandbox_operation_receipts
      SET status = ${receipt.status},
          deployment_id = ${receipt.deploymentId ?? null},
          profile_id = ${receipt.profileId ?? null},
          profile_input_json = ${receipt.profileInput === undefined ? null : encodeJson(receipt.profileInput)},
          result_json = ${receipt.result === undefined ? null : encodeJson(receipt.result)},
          error = ${receipt.error ?? null},
          updated_at = ${receipt.updatedAt}
      WHERE operation_id = ${receipt.operationId}
    `.pipe(Effect.asVoid, mapSql("SandboxDeploymentRepository.saveOperation"));

  const listInFlightOperations = () =>
    listInFlightRows(undefined).pipe(
      Effect.flatMap((rows) => Effect.all(rows.map(fromOperationRow))),
      mapSql("SandboxDeploymentRepository.listInFlightOperations"),
    );

  return {
    listProfiles,
    getProfile,
    saveProfile,
    deleteProfile,
    listDeployments,
    getDeployment,
    saveDeployment,
    getObservation,
    saveObservation,
    accept,
    getOperation,
    getOperationByRequest,
    saveOperation,
    listInFlightOperations,
  } satisfies SandboxDeploymentRepositoryShape;
});

export const layer = Layer.effect(SandboxDeploymentRepository, makeRepository);
