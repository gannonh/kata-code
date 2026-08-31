import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  EnvironmentAuthenticatedAuth,
  EnvironmentInternalError,
  EnvironmentScopeRequiredError,
  ProviderInstanceId,
} from "@kata-sh/code-contracts";

import {
  ProviderObservation,
  ResolvedGitHubSource,
  SandboxAttachment,
  SandboxDeployment,
  SandboxDeploymentAction,
  SandboxDeploymentId,
  SandboxDeploymentLabel,
  SandboxHandoff,
  SandboxOperationId,
  SandboxOperationReceipt,
  SandboxProfileInput,
  SandboxProfileSummary,
  SandboxProviderDescriptor,
  SandboxProviderProfileId,
  SandboxRequestId,
  SandboxProviderDriverKind,
} from "./domain.ts";

export class SandboxConflictError extends Schema.TaggedErrorClass<SandboxConflictError>()(
  "SandboxConflictError",
  {
    message: Schema.String,
    requestId: Schema.optional(SandboxRequestId),
  },
  { httpApiStatus: 409 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(SandboxConflictError)(this, { status: 409 });
  }
}

export class SandboxAuthorizationError extends Schema.TaggedErrorClass<SandboxAuthorizationError>()(
  "SandboxAuthorizationError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(SandboxAuthorizationError)(this, { status: 403 });
  }
}

export class SandboxNotFoundError extends Schema.TaggedErrorClass<SandboxNotFoundError>()(
  "SandboxNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(SandboxNotFoundError)(this, { status: 404 });
  }
}

export class SandboxCommandError extends Schema.TaggedErrorClass<SandboxCommandError>()(
  "SandboxCommandError",
  { message: Schema.String },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(SandboxCommandError)(this, { status: 502 });
  }
}

const SandboxHttpErrors = [
  EnvironmentScopeRequiredError,
  EnvironmentInternalError,
  SandboxAuthorizationError,
  SandboxConflictError,
  SandboxNotFoundError,
  SandboxCommandError,
] as const;

export const SandboxProfileUpsertRequest = Schema.Struct({
  requestId: SandboxRequestId,
  profileId: Schema.optional(SandboxProviderProfileId),
  name: SandboxProfileInput.fields.name,
  driverKind: SandboxProviderDriverKind,
  socketPath: SandboxProfileInput.fields.socketPath,
  image: SandboxProfileInput.fields.image,
  enabled: SandboxProfileInput.fields.enabled,
  expectedRevision: SandboxProfileInput.fields.expectedRevision,
});
export type SandboxProfileUpsertRequest = typeof SandboxProfileUpsertRequest.Type;

export const SandboxCreateRequest = Schema.Struct({
  requestId: SandboxRequestId,
  profileId: SandboxProviderProfileId,
  label: SandboxDeploymentLabel,
  source: Schema.Struct({
    repository: ResolvedGitHubSource.fields.repository,
    ref: ResolvedGitHubSource.fields.ref,
  }),
  providerInstanceId: ProviderInstanceId,
  expectedRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SandboxCreateRequest = typeof SandboxCreateRequest.Type;

export const SandboxStartRequest = Schema.Struct({
  requestId: SandboxRequestId,
  deploymentId: SandboxDeploymentId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  attachment: SandboxAttachment,
});
export type SandboxStartRequest = typeof SandboxStartRequest.Type;

export const SandboxStopRequest = Schema.Struct({
  requestId: SandboxRequestId,
  deploymentId: SandboxDeploymentId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type SandboxStopRequest = typeof SandboxStopRequest.Type;

export const SandboxDeleteRequest = Schema.Struct({
  requestId: SandboxRequestId,
  deploymentId: SandboxDeploymentId,
  expectedRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SandboxDeleteRequest = typeof SandboxDeleteRequest.Type;

export const SandboxProfileDeleteRequest = Schema.Struct({
  requestId: SandboxRequestId,
  profileId: SandboxProviderProfileId,
  expectedRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type SandboxProfileDeleteRequest = typeof SandboxProfileDeleteRequest.Type;

export const SandboxAccepted = Schema.Struct({
  operationId: SandboxOperationId,
});
export type SandboxAccepted = typeof SandboxAccepted.Type;

export const SandboxDeploymentSummary = Schema.Struct({
  deployment: SandboxDeployment,
  observation: Schema.optional(ProviderObservation),
  actions: Schema.optional(Schema.Array(SandboxDeploymentAction)),
});
export type SandboxDeploymentSummary = typeof SandboxDeploymentSummary.Type;

export const SandboxListResponse = Schema.Struct({
  profiles: Schema.Array(SandboxProfileSummary),
  deployments: Schema.Array(SandboxDeploymentSummary),
  relayAvailable: Schema.optional(Schema.Boolean),
  /** Registered sandbox drivers clients can use when creating profiles. */
  providers: Schema.Array(SandboxProviderDescriptor),
});
export type SandboxListResponse = typeof SandboxListResponse.Type;

export const SandboxOperationResponse = Schema.Struct({
  receipt: SandboxOperationReceipt,
});
export type SandboxOperationResponse = typeof SandboxOperationResponse.Type;

export const SandboxHandoffResponse = SandboxHandoff;

export const SandboxHttpApiGroup = HttpApiGroup.make("kataSandbox")
  .add(
    HttpApiEndpoint.get("list", "/api/kata-sandbox", {
      success: SandboxListResponse,
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("upsertProfile", "/api/kata-sandbox/profiles", {
      payload: SandboxProfileUpsertRequest,
      success: SandboxAccepted.pipe(HttpApiSchema.status(202)),
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteProfile", "/api/kata-sandbox/profiles/delete", {
      payload: SandboxProfileDeleteRequest,
      success: SandboxAccepted.pipe(HttpApiSchema.status(202)),
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/kata-sandbox/deployments", {
      payload: SandboxCreateRequest,
      success: SandboxAccepted.pipe(HttpApiSchema.status(202)),
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("start", "/api/kata-sandbox/deployments/start", {
      payload: SandboxStartRequest,
      success: SandboxAccepted.pipe(HttpApiSchema.status(202)),
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("stop", "/api/kata-sandbox/deployments/stop", {
      payload: SandboxStopRequest,
      success: SandboxAccepted.pipe(HttpApiSchema.status(202)),
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("delete", "/api/kata-sandbox/deployments/delete", {
      payload: SandboxDeleteRequest,
      success: SandboxAccepted.pipe(HttpApiSchema.status(202)),
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("operation", "/api/kata-sandbox/operations/:operationId", {
      params: Schema.Struct({ operationId: SandboxOperationId }),
      success: SandboxOperationResponse,
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("mintHandoff", "/api/kata-sandbox/deployments/:deploymentId/handoff", {
      params: Schema.Struct({ deploymentId: SandboxDeploymentId }),
      success: SandboxHandoffResponse,
      error: SandboxHttpErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "mintRelayHandoff",
      "/api/kata-sandbox/deployments/:deploymentId/handoff/relay",
      {
        params: Schema.Struct({ deploymentId: SandboxDeploymentId }),
        success: SandboxHandoffResponse,
        error: SandboxHttpErrors,
      },
    ),
  )
  .middleware(EnvironmentAuthenticatedAuth);

export type SandboxHttpApiGroup = typeof SandboxHttpApiGroup;

export const SandboxHttpApi = HttpApi.make("kataSandbox").add(SandboxHttpApiGroup);
export type SandboxHttpApi = typeof SandboxHttpApi;

export const sandboxHttpAcceptedSchema = HttpApiSchema.Accepted;
