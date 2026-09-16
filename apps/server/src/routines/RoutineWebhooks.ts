import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { payloadRepositoryId, summarizeGitHubEvent } from "./GitHubRoutineEvents.ts";
import { RoutineScheduler } from "./RoutineScheduler.ts";
import { RoutineStore } from "./RoutineStore.ts";

export const ROUTINE_WEBHOOK_ROUTE_PREFIX = "/api/routines/webhooks";
export const ROUTINE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
const MAX_DELIVERY_HEADER_LENGTH = 128;

/**
 * Deliveries must be recorded even while the server is still starting, because
 * GitHub does not retry a failed delivery on its own. The command readiness
 * middleware lets this prefix through without waiting.
 */
export function isRoutineWebhookPath(url: string): boolean {
  return url.startsWith(`${ROUTINE_WEBHOOK_ROUTE_PREFIX}/`);
}

export const routineConnectionSecretName = (connectionId: string) =>
  `routine-connection-${connectionId}`;

export const routineWebhookCallbackPath = (connectionId: string) =>
  `${ROUTINE_WEBHOOK_ROUTE_PREFIX}/github/${encodeURIComponent(connectionId)}`;

export function signGitHubWebhookBody(secret: Uint8Array, body: Uint8Array): string {
  return `sha256=${NodeCrypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function signatureMatches(secret: Uint8Array, body: Uint8Array, header: string): boolean {
  const expected = Buffer.from(signGitHubWebhookBody(secret, body));
  const provided = Buffer.from(header);
  return (
    expected.byteLength === provided.byteLength && NodeCrypto.timingSafeEqual(expected, provided)
  );
}

const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const reply = (status: number, detail: string) =>
  HttpServerResponse.jsonUnsafe({ ok: status < 300, detail }, { status });

/** Reads at most the cap; returns null once the body exceeds it. */
const readBoundedBody = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const declared = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > ROUTINE_WEBHOOK_MAX_BODY_BYTES) return null;
    let received = 0;
    const chunks = yield* Stream.runCollect(
      request.stream.pipe(
        Stream.takeWhile((chunk) => {
          received += chunk.byteLength;
          return received <= ROUTINE_WEBHOOK_MAX_BODY_BYTES;
        }),
      ),
    );
    if (received > ROUTINE_WEBHOOK_MAX_BODY_BYTES) return null;
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  });

/**
 * Signature-authenticated callback. It accepts nothing but a correctly signed
 * body for a known connection, records the delivery durably before answering,
 * and never exposes application RPCs or session authority.
 */
export const routineWebhookRouteLayer = HttpRouter.add(
  "POST",
  `${ROUTINE_WEBHOOK_ROUTE_PREFIX}/github/:connectionId`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const connectionId = params.connectionId ?? "";
    const storeOption = yield* Effect.serviceOption(RoutineStore);
    if (Option.isNone(storeOption) || connectionId.length === 0) {
      return reply(503, "Routines are unavailable on this environment.");
    }
    const store = storeOption.value;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const now = yield* Clock.currentTimeMillis;
    // Rejections are counted before the signature is verified, so bound what is
    // stored and logged from headers an unauthenticated request controls.
    const deliveryId = (request.headers["x-github-delivery"] ?? "").slice(
      0,
      MAX_DELIVERY_HEADER_LENGTH,
    );
    const eventName = (request.headers["x-github-event"] ?? "").slice(
      0,
      MAX_DELIVERY_HEADER_LENGTH,
    );
    const signature = request.headers["x-hub-signature-256"] ?? "";
    const connection = yield* store
      .findConnection(connectionId)
      .pipe(Effect.orElseSucceed(() => null));
    if (connection === null) return reply(404, "Unknown connection.");
    const rejected = (status: number, detail: string) =>
      store
        .recordRejectedDelivery(connection.id, { deliveryId, event: eventName, detail }, now)
        .pipe(
          Effect.ignoreCause({ log: true }),
          Effect.andThen(
            Effect.logInfo("routine webhook rejected", {
              connectionId,
              deliveryId,
              status,
              detail,
            }),
          ),
          Effect.as(reply(status, detail)),
        );
    if (deliveryId.length === 0 || eventName.length === 0 || signature.length === 0) {
      return yield* rejected(400, "Missing GitHub delivery headers.");
    }
    if (connection.status === "disabled") {
      return yield* rejected(403, "Connection is disabled.");
    }
    const secret = yield* secrets
      .get(routineConnectionSecretName(connection.id))
      .pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));
    if (Option.isNone(secret)) {
      return yield* rejected(403, "Connection has no signing secret.");
    }
    const body = yield* readBoundedBody(request).pipe(Effect.orElseSucceed(() => null));
    if (body === null) {
      return yield* rejected(413, "Body exceeds the webhook size limit.");
    }
    if (!signatureMatches(secret.value, body, signature)) {
      return yield* rejected(401, "Signature verification failed.");
    }
    const decoded = decodePayload(body.toString("utf8"));
    if (Option.isNone(decoded)) {
      return yield* rejected(400, "Body is not valid JSON.");
    }
    const payload = decoded.value;
    const repositoryId = payloadRepositoryId(payload);
    if (repositoryId !== connection.repositoryId) {
      return yield* rejected(403, "Delivery names a different repository.");
    }
    const digest = NodeCrypto.createHash("sha256").update(body).digest("hex");
    const summary = summarizeGitHubEvent(eventName, payload);
    const admission = yield* store
      .admitEvent({ connectionId: connection.id, deliveryId, digest, eventName, summary, now })
      .pipe(Effect.result);
    if (admission._tag === "Failure") {
      yield* Effect.logWarning("routine webhook delivery could not be recorded", {
        connectionId,
        deliveryId,
        cause: admission.failure.message,
      });
      return yield* rejected(503, "Delivery could not be recorded; ask GitHub to redeliver.");
    }
    const { status, runs } = admission.success;
    yield* Effect.logInfo("routine webhook delivery recorded", {
      connectionId,
      deliveryId,
      event: eventName,
      status,
      runIds: runs.map((run) => run.id),
    });
    if (runs.some((run) => run.status === "queued")) {
      const scheduler = yield* Effect.serviceOption(RoutineScheduler);
      if (Option.isSome(scheduler)) yield* scheduler.value.wake;
    }
    return HttpServerResponse.jsonUnsafe(
      { ok: true, status, runIds: runs.map((run) => run.id) },
      { status: status === "accepted" && eventName !== "ping" ? 202 : 200 },
    );
  }),
);
