import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { payloadRepositoryId, summarizeGitHubEvent } from "./GitHubRoutineEvents.ts";
import {
  linearSignatureMatches,
  linearTimestampIsFresh,
  payloadEventType,
  payloadOrganizationId,
  payloadWebhookTimestamp,
  summarizeLinearEvent,
} from "./LinearRoutineEvents.ts";
import { RoutineScheduler } from "./RoutineScheduler.ts";
import { MAX_DELIVERY_HEADER_LENGTH, RoutineStore } from "./RoutineStore.ts";

const ROUTINE_WEBHOOK_ROUTE_PREFIX = "/api/routines/webhooks";
export const ROUTINE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

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

/** Linear's metadata read credential is a second, separate secret per connection. */
export const routineConnectionMetadataSecretName = (connectionId: string) =>
  `routine-connection-metadata-${connectionId}`;

export const routineWebhookCallbackPath = (connectionId: string) =>
  `${ROUTINE_WEBHOOK_ROUTE_PREFIX}/github/${encodeURIComponent(connectionId)}`;

export const routineLinearWebhookCallbackPath = (connectionId: string) =>
  `${ROUTINE_WEBHOOK_ROUTE_PREFIX}/linear/${encodeURIComponent(connectionId)}`;

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

type BoundedBody = { readonly body: Uint8Array } | { readonly oversized: true };

/** Reads at most the cap and reports an oversized body without consuming past it. */
const readBoundedBody = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const declared = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > ROUTINE_WEBHOOK_MAX_BODY_BYTES)
      return { oversized: true } as const satisfies BoundedBody;
    let received = 0;
    const chunks = yield* Stream.runCollect(
      request.stream.pipe(
        Stream.takeWhile((chunk) => {
          received += chunk.byteLength;
          return received <= ROUTINE_WEBHOOK_MAX_BODY_BYTES;
        }),
      ),
    );
    if (received > ROUTINE_WEBHOOK_MAX_BODY_BYTES)
      return { oversized: true } as const satisfies BoundedBody;
    return {
      body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    } as const satisfies BoundedBody;
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
    const connectionResult = yield* store.findConnection(connectionId).pipe(Effect.result);
    if (connectionResult._tag === "Failure") {
      yield* Effect.logWarning("routine webhook connection lookup failed", {
        connectionId,
        cause: connectionResult.failure.message,
      });
      return reply(503, "Routines are unavailable on this environment.");
    }
    const connection = connectionResult.success;
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
    const secretResult = yield* secrets
      .get(routineConnectionSecretName(connection.id))
      .pipe(Effect.result);
    if (secretResult._tag === "Failure") {
      yield* Effect.logWarning("routine webhook signing secret could not be read", {
        connectionId,
        cause: secretResult.failure.message,
      });
      return reply(503, "Signature verification is unavailable; ask GitHub to redeliver.");
    }
    if (Option.isNone(secretResult.success)) {
      return yield* rejected(403, "Connection has no signing secret.");
    }
    const bodyResult = yield* readBoundedBody(request).pipe(Effect.result);
    if (bodyResult._tag === "Failure") {
      yield* Effect.logWarning("routine webhook body could not be read", {
        connectionId,
        deliveryId,
        cause: bodyResult.failure,
      });
      return reply(503, "Delivery could not be read; ask GitHub to redeliver.");
    }
    if ("oversized" in bodyResult.success) {
      return yield* rejected(413, "Body exceeds the webhook size limit.");
    }
    const body = bodyResult.success.body;
    if (!signatureMatches(secretResult.success.value, body, signature)) {
      return yield* rejected(401, "Signature verification failed.");
    }
    const decoded = decodePayload(body.toString("utf8"));
    if (Option.isNone(decoded)) {
      return yield* rejected(400, "Body is not valid JSON.");
    }
    const payload = decoded.value;
    const digest = NodeCrypto.createHash("sha256").update(body).digest("hex");
    const admission = yield* store
      .admitEvent({
        connectionId: connection.id,
        deliveryId,
        digest,
        eventName,
        providerResourceId: payloadRepositoryId(payload),
        summary: summarizeGitHubEvent(eventName, payload),
        now,
      })
      .pipe(Effect.result);
    if (admission._tag === "Failure") {
      yield* Effect.logWarning("routine webhook delivery could not be recorded", {
        connectionId,
        deliveryId,
        cause: admission.failure.message,
      });
      return yield* rejected(503, "Delivery could not be recorded; ask GitHub to redeliver.");
    }
    const recorded = admission.success;
    if (recorded.status === "rejected") {
      yield* Effect.logInfo("routine webhook rejected", {
        connectionId,
        deliveryId,
        status: 403,
        reason: recorded.reason,
        detail: recorded.detail,
      });
      return reply(403, recorded.detail);
    }
    const { status, runs } = recorded;
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

/**
 * Linear's callback shares the durable admission boundary with GitHub but has
 * its own transport: a bare hex Linear-Signature, a signed webhookTimestamp
 * that must be fresh, and Linear-Delivery / Linear-Event headers that must
 * agree with the signed body. Linear retries failed deliveries up to three
 * times at 1 minute, 1 hour, and 6 hours; each retry carries a fresh signed
 * timestamp, so freshness never blocks a legitimate retry.
 */
export const linearWebhookRouteLayer = HttpRouter.add(
  "POST",
  `${ROUTINE_WEBHOOK_ROUTE_PREFIX}/linear/:connectionId`,
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
    const deliveryId = (request.headers["linear-delivery"] ?? "").slice(
      0,
      MAX_DELIVERY_HEADER_LENGTH,
    );
    const eventName = (request.headers["linear-event"] ?? "").slice(0, MAX_DELIVERY_HEADER_LENGTH);
    const signature = request.headers["linear-signature"] ?? "";
    const connectionResult = yield* store.findConnection(connectionId).pipe(Effect.result);
    if (connectionResult._tag === "Failure") {
      yield* Effect.logWarning("routine Linear webhook connection lookup failed", {
        connectionId,
        cause: connectionResult.failure.message,
      });
      return reply(503, "Routines are unavailable on this environment.");
    }
    const connection = connectionResult.success;
    if (connection === null || connection.provider !== "linear")
      return reply(404, "Unknown connection.");
    const rejected = (status: number, detail: string) =>
      store
        .recordRejectedDelivery(connection.id, { deliveryId, event: eventName, detail }, now)
        .pipe(
          Effect.ignoreCause({ log: true }),
          Effect.andThen(
            Effect.logInfo("routine Linear webhook rejected", {
              connectionId,
              deliveryId,
              status,
              detail,
            }),
          ),
          Effect.as(reply(status, detail)),
        );
    if (deliveryId.length === 0 || eventName.length === 0 || signature.length === 0) {
      return yield* rejected(400, "Missing Linear delivery headers.");
    }
    const secretResult = yield* secrets
      .get(routineConnectionSecretName(connection.id))
      .pipe(Effect.result);
    if (secretResult._tag === "Failure") {
      yield* Effect.logWarning("routine Linear webhook signing secret could not be read", {
        connectionId,
        cause: secretResult.failure.message,
      });
      return reply(503, "Signature verification is unavailable; ask Linear to redeliver.");
    }
    if (Option.isNone(secretResult.success)) {
      return yield* rejected(403, "Connection has no signing secret.");
    }
    const bodyResult = yield* readBoundedBody(request).pipe(Effect.result);
    if (bodyResult._tag === "Failure") {
      yield* Effect.logWarning("routine Linear webhook body could not be read", {
        connectionId,
        deliveryId,
        cause: bodyResult.failure,
      });
      return reply(503, "Delivery could not be read; ask Linear to redeliver.");
    }
    if ("oversized" in bodyResult.success) {
      return yield* rejected(413, "Body exceeds the webhook size limit.");
    }
    const body = bodyResult.success.body;
    if (!linearSignatureMatches(secretResult.success.value, body, signature)) {
      return yield* rejected(401, "Signature verification failed.");
    }
    const decoded = decodePayload(body.toString("utf8"));
    if (Option.isNone(decoded)) {
      return yield* rejected(400, "Body is not valid JSON.");
    }
    const payload = decoded.value;
    // The signed body is authoritative; the headers must agree with it.
    const payloadTimestamp = payloadWebhookTimestamp(payload);
    if (!linearTimestampIsFresh(payloadTimestamp, now)) {
      return yield* rejected(401, "Signed timestamp is outside the freshness window.");
    }
    const payloadType = payloadEventType(payload);
    if (payloadType !== null && payloadType !== eventName) {
      return yield* rejected(400, "Header and payload event type disagree.");
    }
    const headerTimestamp = request.headers["linear-timestamp"];
    if (
      headerTimestamp !== undefined &&
      Number.isFinite(Number(headerTimestamp)) &&
      Number(headerTimestamp) !== payloadTimestamp
    ) {
      return yield* rejected(400, "Header and payload timestamps disagree.");
    }
    const digest = NodeCrypto.createHash("sha256").update(body).digest("hex");
    const summarized = summarizeLinearEvent(payload);
    const admission = yield* store
      .admitEvent({
        connectionId: connection.id,
        deliveryId,
        digest,
        eventName,
        providerResourceId: payloadOrganizationId(payload),
        summary: summarized.kind === "event" ? summarized.summary : null,
        ...(summarized.kind === "ignored" ? { ignoredDetail: summarized.detail } : {}),
        now,
      })
      .pipe(Effect.result);
    if (admission._tag === "Failure") {
      yield* Effect.logWarning("routine Linear webhook delivery could not be recorded", {
        connectionId,
        deliveryId,
        cause: admission.failure.message,
      });
      return yield* rejected(503, "Delivery could not be recorded; ask Linear to redeliver.");
    }
    const recorded = admission.success;
    if (recorded.status === "rejected") {
      yield* Effect.logInfo("routine Linear webhook rejected", {
        connectionId,
        deliveryId,
        status: 403,
        reason: recorded.reason,
        detail: recorded.detail,
      });
      return reply(403, recorded.detail);
    }
    const { status, runs } = recorded;
    yield* Effect.logInfo("routine Linear webhook delivery recorded", {
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
      { status: 200 },
    );
  }),
);
