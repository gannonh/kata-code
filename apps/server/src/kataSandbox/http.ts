import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";

import {
  SandboxCommandError,
  SandboxConflictError,
  SandboxHttpApi,
  SandboxNotFoundError,
} from "@kata-sh/code-kata-sandbox-contracts/http";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthPairingCredentialResult,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  EnvironmentAuthenticatedPrincipal,
  TrimmedNonEmptyString,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import * as PairingGrantStore from "../auth/PairingGrantStore.ts";
import * as ServerConfig from "../config.ts";
import * as SandboxDeploymentService from "./SandboxDeploymentService.ts";
import * as SandboxGitHubAccess from "./SandboxGitHubAccess.ts";

const SandboxBootstrapPairingRequest = Schema.Struct({
  label: TrimmedNonEmptyString,
  scopes: Schema.optional(Schema.Array(Schema.Literals([AuthRelayReadScope, AuthRelayWriteScope]))),
});
const decodeSandboxBootstrapPairingRequest = Schema.decodeUnknownEffect(
  SandboxBootstrapPairingRequest,
);

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
} as const;

const sandboxHandoffMutex = Semaphore.makeUnsafe(1);
const sandboxBootstrapPairingMutex = Semaphore.makeUnsafe(1);

function rawJsonError(status: number, error: string) {
  return HttpServerResponse.setHeaders(
    HttpServerResponse.jsonUnsafe({ error }, { status }),
    NO_STORE_HEADERS,
  );
}

function hasMatchingSecret(candidate: string | undefined, expected: string | undefined): boolean {
  if (candidate === undefined || expected === undefined) return false;
  const candidateBytes = NodeBuffer.Buffer.from(candidate, "utf8");
  const expectedBytes = NodeBuffer.Buffer.from(expected, "utf8");
  return (
    candidateBytes.length === expectedBytes.length &&
    NodeCrypto.timingSafeEqual(candidateBytes, expectedBytes)
  );
}

function bearerCredential(authorization: string | undefined): string | undefined {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return undefined;
  const credential = authorization.slice("Bearer ".length).trim();
  return credential.length > 0 ? credential : undefined;
}

const noStoreResponseHeaders = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeaders(response, NO_STORE_HEADERS)),
);

export const sandboxBootstrapPairingRouteLayer = HttpRouter.add(
  "POST",
  "/api/kata-sandbox/bootstrap-pairing-token",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    if (
      !hasMatchingSecret(
        bearerCredential(request.headers.authorization),
        config.sandboxBootstrapToken,
      )
    ) {
      return rawJsonError(401, "The sandbox bootstrap credential is invalid.");
    }

    const body = yield* request.json.pipe(Effect.result);
    if (body._tag === "Failure") return rawJsonError(400, "The sandbox pairing label is invalid.");
    const decoded = yield* decodeSandboxBootstrapPairingRequest(body.success).pipe(Effect.result);
    if (decoded._tag === "Failure")
      return rawJsonError(400, "The sandbox pairing label is invalid.");

    const issued = yield* sandboxBootstrapPairingMutex
      .withPermits(1)(
        Effect.gen(function* () {
          const pairingGrants = yield* PairingGrantStore.PairingGrantStore;
          const active = yield* pairingGrants.listActive();
          yield* Effect.forEach(
            active.filter(
              (link) =>
                link.subject === "sandbox-bootstrap" && link.label === decoded.success.label,
            ),
            (link) => pairingGrants.revoke(link.id),
            { discard: true },
          );
          return yield* pairingGrants.issueOneTimeToken({
            scopes: decoded.success.scopes ?? AuthStandardClientScopes,
            subject: "sandbox-bootstrap",
            label: decoded.success.label,
          });
        }),
      )
      .pipe(Effect.result);
    if (issued._tag === "Failure")
      return rawJsonError(500, "The sandbox pairing credential could not be issued.");

    const response = yield* HttpServerResponse.schemaJson(AuthPairingCredentialResult)({
      id: issued.success.id,
      credential: issued.success.credential,
      ...(issued.success.label ? { label: issued.success.label } : {}),
      expiresAt: issued.success.expiresAt,
    });
    return HttpServerResponse.setHeaders(response, NO_STORE_HEADERS);
  }),
);

const toHttpError = (error: SandboxDeploymentService.SandboxDeploymentServiceError) => {
  switch (error.kind) {
    case "conflict":
      return new SandboxConflictError({ message: error.message });
    case "not-found":
      return new SandboxNotFoundError({ message: error.message });
    case "command":
      return new SandboxCommandError({ message: error.message });
  }
};

const githubAccessToHttpError = (error: SandboxGitHubAccess.SandboxGitHubAccessError) =>
  new SandboxCommandError({ message: error.message });

export const sandboxHttpApiLayer = HttpApiBuilder.group(
  SandboxHttpApi,
  "kataSandbox",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* SandboxDeploymentService.SandboxDeploymentService;
    const githubAccess = yield* SandboxGitHubAccess.SandboxGitHubAccess;
    return handlers
      .handle(
        "list",
        Effect.fn("kataSandbox.http.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* EnvironmentAuthenticatedPrincipal;
          if (
            !session.scopes.has(AuthAccessReadScope) &&
            !session.scopes.has(AuthOrchestrationReadScope)
          ) {
            yield* requireEnvironmentScope(AuthAccessReadScope);
          }
          const result = yield* service.list().pipe(Effect.mapError(toHttpError));
          return session.scopes.has(AuthAccessReadScope)
            ? result
            : { profiles: [], deployments: [], providers: result.providers };
        }),
      )
      .handle(
        "listGitHubRepositories",
        Effect.fn("kataSandbox.http.listGitHubRepositories")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStoreResponseHeaders;
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          const result = yield* githubAccess
            .listRepositories({ page: args.payload.page ?? 1 })
            .pipe(Effect.mapError(githubAccessToHttpError));
          return result;
        }),
      )
      .handle(
        "listGitHubBranches",
        Effect.fn("kataSandbox.http.listGitHubBranches")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStoreResponseHeaders;
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          const result = yield* githubAccess
            .listBranches({
              repository: args.payload.repository,
              page: args.payload.page ?? 1,
            })
            .pipe(Effect.mapError(githubAccessToHttpError));
          return result;
        }),
      )
      .handle(
        "upsertProfile",
        Effect.fn("kataSandbox.http.upsertProfile")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* service
            .upsertProfile(session.subject, args.payload)
            .pipe(Effect.mapError(toHttpError));
        }),
      )
      .handle(
        "deleteProfile",
        Effect.fn("kataSandbox.http.deleteProfile")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* service
            .deleteProfile(session.subject, args.payload)
            .pipe(Effect.mapError(toHttpError));
        }),
      )
      .handle(
        "create",
        Effect.fn("kataSandbox.http.create")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* service
            .create(session.subject, args.payload)
            .pipe(Effect.mapError(toHttpError));
        }),
      )
      .handle(
        "start",
        Effect.fn("kataSandbox.http.start")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* service
            .start(session.subject, args.payload)
            .pipe(Effect.mapError(toHttpError));
        }),
      )
      .handle(
        "stop",
        Effect.fn("kataSandbox.http.stop")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* service
            .stop(session.subject, args.payload)
            .pipe(Effect.mapError(toHttpError));
        }),
      )
      .handle(
        "delete",
        Effect.fn("kataSandbox.http.delete")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* service
            .delete(session.subject, args.payload)
            .pipe(Effect.mapError(toHttpError));
        }),
      )
      .handle(
        "operation",
        Effect.fn("kataSandbox.http.operation")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessReadScope);
          const operation = yield* service
            .getOperation(args.params.operationId)
            .pipe(Effect.mapError(toHttpError));
          return { receipt: operation };
        }),
      )
      .handle(
        "mintHandoff",
        Effect.fn("kataSandbox.http.mintHandoff")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          const result = yield* sandboxHandoffMutex.withPermits(1)(
            service.mintHandoff(args.params.deploymentId).pipe(Effect.mapError(toHttpError)),
          );
          yield* noStoreResponseHeaders;
          return result;
        }),
      )
      .handle(
        "mintRelayHandoff",
        Effect.fn("kataSandbox.http.mintRelayHandoff")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          const result = yield* sandboxHandoffMutex.withPermits(1)(
            service
              .mintHandoff(args.params.deploymentId, "relay")
              .pipe(Effect.mapError(toHttpError)),
          );
          yield* noStoreResponseHeaders;
          return result;
        }),
      );
  }),
);
