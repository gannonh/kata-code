import * as Effect from "effect/Effect";

import {
  type DesktopIpcMethod,
  type DesktopIpcMethodRegistration,
  makeIpcMethod,
} from "./DesktopIpc.ts";

const isPreviewManagerError = (
  error: unknown,
): error is { readonly _tag: "PreviewManagerError"; readonly cause?: unknown } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error as { _tag: unknown })._tag === "PreviewManagerError";

/**
 * Flatten PreviewManagerError wrappers before they cross IPC. Electron only
 * reliably preserves Error.name/message on the wire, and the renderer maps
 * those into agent-facing preview automation failures. Without unwrapping,
 * agents see "Desktop preview operation failed: automationClick" instead of
 * "No element matches locator ...".
 *
 * Non-preview errors (including payload schema failures) pass through unchanged.
 */
export const toPreviewIpcFailure = <E>(error: E): E | Error => {
  if (!isPreviewManagerError(error)) return error;
  const cause = error.cause;
  if (cause instanceof Error) {
    const next = new Error(cause.message) as Error & { detail?: unknown };
    next.name = cause.name;
    if ("detail" in cause && (cause as { detail?: unknown }).detail !== undefined) {
      next.detail = (cause as { detail?: unknown }).detail;
    }
    return next;
  }
  if (cause !== undefined && cause !== null) {
    return new Error(String(cause));
  }
  return error;
};

export const makePreviewIpcMethod = <
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopIpcMethodRegistration<
    Payload,
    EncodedPayload,
    Result,
    EncodedResult,
    E,
    R,
    PayloadDecodingServices,
    PayloadEncodingServices,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopIpcMethod<
  E | Error | import("effect/Schema").SchemaError,
  R | PayloadDecodingServices | ResultEncodingServices
> => {
  const base = makeIpcMethod(method);
  return {
    channel: base.channel,
    handler: (raw) => base.handler(raw).pipe(Effect.mapError(toPreviewIpcFailure)),
  };
};
