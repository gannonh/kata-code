import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

export interface DesktopIpcInvokeEvent {}

export interface DesktopIpcSyncEvent {
  returnValue: unknown;
}

export type DesktopIpcHandleListener = (
  event: DesktopIpcInvokeEvent,
  raw: unknown,
) => unknown | Promise<unknown>;

export type DesktopIpcSyncListener = (event: DesktopIpcSyncEvent) => void;

export interface DesktopIpcMain {
  removeHandler(channel: string): void;
  handle(channel: string, listener: DesktopIpcHandleListener): void;
  removeAllListeners(channel: string): void;
  on(channel: string, listener: DesktopIpcSyncListener): void;
}

export interface DesktopIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: (raw: unknown) => Effect.Effect<unknown, E, R>;
}

export interface DesktopSyncIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: () => Effect.Effect<unknown, E, R>;
}

export interface DesktopIpcShape {
  readonly handle: <E, R>(
    input: DesktopIpcMethod<E, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
  readonly handleSync: <E, R>(
    input: DesktopSyncIpcMethod<E, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
}

export class DesktopIpc extends Context.Service<DesktopIpc, DesktopIpcShape>()(
  "@kata-sh/code-desktop/ipc/DesktopIpc",
) {}

/**
 * Flatten PreviewManagerError wrappers before they cross IPC. Electron only
 * reliably preserves Error.name/message on the wire, and the renderer maps
 * those into agent-facing preview automation failures. Without unwrapping,
 * agents see "Desktop preview operation failed: automationClick" instead of
 * "No element matches locator ...".
 */
export const toIpcFailure = (error: unknown): Error => {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag: unknown })._tag === "PreviewManagerError"
  ) {
    const cause = (error as { cause?: unknown }).cause;
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
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
};

export const make = (ipcMain: DesktopIpcMain): DesktopIpcShape =>
  DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
      channel,
      handler,
    }: DesktopIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, (_event, raw) =>
            runPromise(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({ channel });
                return yield* handler(raw);
              }).pipe(
                Effect.mapError(toIpcFailure),
                Effect.annotateLogs({ channel }),
                Effect.withSpan("desktop.ipc.invoke"),
              ),
            ),
          );
        }),
        () => Effect.sync(() => ipcMain.removeHandler(channel)),
      );
    }),

    handleSync: Effect.fn("desktop.ipc.registerSync")(function* <E, R>({
      channel,
      handler,
    }: DesktopSyncIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runSync = Effect.runSyncWith(context);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ipcMain.removeAllListeners(channel);
          ipcMain.on(channel, (event) => {
            event.returnValue = runSync(
              Effect.gen(function* () {
                yield* Effect.annotateCurrentSpan({ channel });
                return yield* handler();
              }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invokeSync")),
            );
          });
        }),
        () => Effect.sync(() => ipcMain.removeAllListeners(channel)),
      );
    }),
  });

/**
 * Convenience helpers for creating IPC methods
 */

export interface DesktopIpcMethodRegistration<
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
> {
  readonly channel: string;
  readonly payload: Schema.Codec<
    Payload,
    EncodedPayload,
    PayloadDecodingServices,
    PayloadEncodingServices
  >;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: (input: Payload) => Effect.Effect<Result, E, R>;
}

export const makeIpcMethod = <
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
  E | Schema.SchemaError,
  R | PayloadDecodingServices | ResultEncodingServices
> => {
  const decode = Schema.decodeUnknownEffect(method.payload);
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: (raw) =>
      decode(raw).pipe(
        Effect.flatMap(method.handler),
        Effect.flatMap(encode),
        Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
      ),
  };
};

export interface DesktopSyncIpcMethodRegistration<
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: () => Effect.Effect<Result, E, R>;
}

export const makeSyncIpcMethod = <
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopSyncIpcMethodRegistration<
    Result,
    EncodedResult,
    E,
    R,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopSyncIpcMethod<E | Schema.SchemaError, R | ResultEncodingServices> => {
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: () =>
      method
        .handler()
        .pipe(
          Effect.flatMap(encode),
          Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
        ),
  };
};
