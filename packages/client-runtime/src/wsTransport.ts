import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { RpcClient } from "effect/unstable/rpc";

import { isTransportConnectionErrorMessage } from "./transportError.ts";
import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsProtocolLifecycleHandlers,
  type WsRpcProtocolClient,
  type WsRpcProtocolSocketUrlProvider,
} from "./wsRpcProtocol.ts";

export interface WsTransportOptions {
  /**
   * Merged into the transport `ManagedRuntime` alongside the RPC protocol layer
   * (for example a `Tracer` layer for OTLP).
   */
  readonly tracingLayer?: Layer.Layer<never, never, never>;
  /**
   * Override protocol construction (defaults to {@link createWsRpcProtocolLayer}).
   * The web app supplies its instrumented layer factory.
   */
  readonly createProtocolLayer?: (
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
  ) => Layer.Layer<RpcClient.Protocol, never, never>;
  readonly logWarning?: (message: string, metadata: { readonly error: string }) => void;
  /** Maximum time allowed for each graceful session-close or forced runtime-dispose step. */
  readonly sessionCloseTimeout?: Duration.Input;
  /**
   * Invoked at the start of {@link WsTransport.reconnect} before the session is replaced.
   */
  readonly onBeforeReconnect?: () => void;
}

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input;
  readonly onResubscribe?: () => void;
  readonly tag?: string;
}

const DEFAULT_SUBSCRIPTION_RETRY_DELAY = Duration.millis(250);
const DEFAULT_SESSION_CLOSE_TIMEOUT = Duration.seconds(5);
const NOOP: () => void = () => undefined;

interface TransportSession {
  readonly clientPromise: Promise<WsRpcProtocolClient>;
  readonly clientScope: Scope.Closeable;
  readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
  /** Rejects when this session is replaced by a reconnect. In-flight one-shot
   *  requests race this so they never hang forever on a superseded socket
   *  (which left UI callers stuck on "Loading…" with no error to react to). */
  readonly replaced: Promise<never>;
  /** Trip {@link TransportSession.replaced}. Called when the session is swapped
   *  out on reconnect or torn down on dispose. */
  readonly markReplaced: () => void;
}

/** Error thrown into an in-flight request whose session was replaced by a
 *  reconnect. Callers should retry on a fresh session rather than hang. */
export class TransportSessionReplacedError extends Error {
  constructor() {
    super("WebSocket session was replaced by a reconnect");
    this.name = "TransportSessionReplacedError";
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

export class WsTransport {
  private readonly url: WsRpcProtocolSocketUrlProvider;
  private readonly lifecycleHandlers: WsProtocolLifecycleHandlers | undefined;
  private readonly options: WsTransportOptions | undefined;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;
  private hasReportedTransportDisconnect = false;
  private intentionalCloseDepth = 0;
  private nextSessionId = 0;
  private activeSessionId = 0;
  private lastHeartbeatPongAt: number | null = null;
  private readonly streamRequestStartListeners = new Set<
    (info: { readonly tag: string }) => void
  >();
  private reconnectChain: Promise<void> = Promise.resolve();
  private readonly retiringSessions = new Set<Promise<void>>();
  private session: TransportSession;

  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
    options?: WsTransportOptions,
  ) {
    this.url = url;
    this.lifecycleHandlers = lifecycleHandlers;
    this.options = options;
    this.session = this.createSession();
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const session = this.session;
    return await this.runOnSession(session, (client) =>
      session.runtime.runPromise(Effect.suspend(() => execute(client))),
    );
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const session = this.session;
    await this.runOnSession(session, (client) =>
      session.runtime.runPromise(
        Stream.runForEach(connect(client), (value) =>
          Effect.sync(() => {
            try {
              listener(value);
            } catch {
              // Ignore listener errors so the stream can finish cleanly.
            }
          }),
        ),
      ),
    );
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions,
  ): () => void {
    if (this.disposed) {
      return NOOP;
    }

    let active = true;
    let hasReceivedValue = false;
    const retryDelayMs = Duration.toMillis(
      Duration.fromInputUnsafe(options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY),
    );
    let cancelCurrentStream: () => void = NOOP;
    const onStreamRequestStart = (info: { readonly tag: string }) => {
      if (
        !hasReceivedValue ||
        !active ||
        (options?.tag !== undefined && info.tag !== options.tag)
      ) {
        return;
      }

      try {
        options?.onResubscribe?.();
      } catch {
        // Ignore reconnect hook failures so the stream can recover.
      }
    };
    this.streamRequestStartListeners.add(onStreamRequestStart);

    void (async () => {
      for (;;) {
        if (!active || this.disposed) {
          return;
        }

        const session = this.session;
        try {
          if (hasReceivedValue) {
            try {
              options?.onResubscribe?.();
            } catch {
              // Ignore reconnect hook failures so the stream can recover.
            }
          }
          const runningStream = this.runStreamOnSession(
            session,
            connect,
            listener,
            () => active && session === this.session,
            () => {
              this.hasReportedTransportDisconnect = false;
              hasReceivedValue = true;
            },
          );
          cancelCurrentStream = runningStream.cancel;
          await runningStream.completed;
          cancelCurrentStream = NOOP;
        } catch (error) {
          cancelCurrentStream = NOOP;
          if (!active || this.disposed) {
            return;
          }

          // Skip retry if the session has already been replaced by a reconnect.
          if (session !== this.session) {
            continue;
          }

          const formattedError = formatErrorMessage(error);
          if (!isTransportConnectionErrorMessage(formattedError)) {
            this.logWarning("WebSocket RPC subscription failed", { error: formattedError });
            return;
          }

          if (!this.hasReportedTransportDisconnect) {
            this.logWarning("WebSocket RPC subscription disconnected", {
              error: formattedError,
            });
          }
          this.hasReportedTransportDisconnect = true;
          await sleep(retryDelayMs);
        }
      }
    })();

    return () => {
      active = false;
      this.streamRequestStartListeners.delete(onStreamRequestStart);
      cancelCurrentStream();
    };
  }

  async reconnect() {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const reconnectOperation = this.reconnectChain.then(async () => {
      if (this.disposed) {
        throw new Error("Transport disposed");
      }

      try {
        this.options?.onBeforeReconnect?.();
      } catch {
        // Ignore hook failures so reconnect can proceed.
      }

      this.lastHeartbeatPongAt = null;
      const previousSession = this.session;
      previousSession.markReplaced();
      this.session = this.createSession();
      // The replacement session is usable while bounded retirement drains the
      // superseded runtime in the background.
      this.retireSession(previousSession);
    });

    this.reconnectChain = reconnectOperation.catch(() => undefined);
    await reconnectOperation;
  }

  isHeartbeatFresh(maxAgeMs = 15_000): boolean {
    return (
      this.lastHeartbeatPongAt !== null && performance.now() - this.lastHeartbeatPongAt <= maxAgeMs
    );
  }

  dispose(): Promise<void> {
    if (this.disposalPromise !== null) {
      return this.disposalPromise;
    }

    this.disposed = true;
    this.disposalPromise = (async () => {
      await this.reconnectChain.catch(() => undefined);
      this.session.markReplaced();
      this.retireSession(this.session);
      await Promise.all(this.retiringSessions);
    })();
    return this.disposalPromise;
  }

  private async runOnSession<T>(
    session: TransportSession,
    execute: (client: WsRpcProtocolClient) => Promise<T>,
  ): Promise<T> {
    const client = await Promise.race([session.clientPromise, session.replaced]);
    return await Promise.race([execute(client), session.replaced]);
  }

  private retireSession(session: TransportSession): void {
    let retirement!: Promise<void>;
    retirement = this.closeSession(session)
      .catch((error: unknown) => {
        this.logWarning("WebSocket session retirement failed", {
          error: formatErrorMessage(error),
        });
      })
      .finally(() => {
        this.retiringSessions.delete(retirement);
      });
    this.retiringSessions.add(retirement);
  }

  private async closeSession(session: TransportSession): Promise<void> {
    this.intentionalCloseDepth += 1;
    try {
      await this.runCleanupStep(
        () => session.runtime.runPromise(Scope.close(session.clientScope, Exit.void)),
        "WebSocket session scope close failed",
      );
    } finally {
      await this.runCleanupStep(
        () => session.runtime.dispose(),
        "WebSocket session runtime disposal failed",
      );
      this.intentionalCloseDepth = Math.max(0, this.intentionalCloseDepth - 1);
    }
  }

  private async runCleanupStep(operation: () => Promise<unknown>, message: string): Promise<void> {
    // Promise assimilation observes synchronous throws and late rejections even
    // when the timeout wins the race.
    const observed = Promise.resolve().then(operation);
    const timeoutMs = Duration.toMillis(
      Duration.fromInputUnsafe(this.options?.sessionCloseTimeout ?? DEFAULT_SESSION_CLOSE_TIMEOUT),
    );
    try {
      await Promise.race([
        observed,
        sleep(timeoutMs).then(() => {
          throw new Error(`timed out after ${timeoutMs}ms`);
        }),
      ]);
    } catch (error) {
      this.logWarning(message, { error: formatErrorMessage(error) });
    }
  }

  private createSession(): TransportSession {
    const protocolFactory = this.options?.createProtocolLayer ?? createWsRpcProtocolLayer;
    const sessionId = this.nextSessionId + 1;
    this.nextSessionId = sessionId;
    this.activeSessionId = sessionId;
    const lifecycleHandlers = this.lifecycleHandlers;
    const protocolLayer = protocolFactory(this.url, {
      ...lifecycleHandlers,
      isActive: () =>
        !this.disposed &&
        this.activeSessionId === sessionId &&
        (lifecycleHandlers?.isActive?.() ?? true),
      isCloseIntentional: () =>
        this.disposed ||
        this.intentionalCloseDepth > 0 ||
        lifecycleHandlers?.isCloseIntentional?.() === true,
      onHeartbeatPong: () => {
        this.lastHeartbeatPongAt = performance.now();
        lifecycleHandlers?.onHeartbeatPong?.();
      },
      onRequestStart: (info) => {
        lifecycleHandlers?.onRequestStart?.(info);
        if (!info.stream) {
          return;
        }
        for (const listener of this.streamRequestStartListeners) {
          listener({ tag: info.tag });
        }
      },
    });
    const rootLayer = this.options?.tracingLayer
      ? Layer.mergeAll(protocolLayer, this.options.tracingLayer)
      : protocolLayer;
    const runtime = ManagedRuntime.make(rootLayer);
    const clientScope = runtime.runSync(Scope.make());
    let markReplaced: () => void = NOOP;
    const replaced = new Promise<never>((_, reject) => {
      markReplaced = () => reject(new TransportSessionReplacedError());
    });
    // This promise exists to interrupt in-flight requests; nothing awaits it on
    // the happy path. Attach a no-op catch so its rejection is always handled
    // (no unhandledrejection when a session is replaced with no pending calls).
    replaced.catch(() => undefined);
    return {
      runtime,
      clientScope,
      clientPromise: runtime.runPromise(Scope.provide(clientScope)(makeWsRpcProtocolClient)),
      replaced,
      markReplaced,
    };
  }

  private logWarning(message: string, metadata: { readonly error: string }) {
    const logWarning = this.options?.logWarning;
    if (logWarning) {
      logWarning(message, metadata);
    } else {
      Effect.runSync(Effect.logWarning(message, metadata));
    }
  }

  private runStreamOnSession<TValue>(
    session: TransportSession,
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    isActive: () => boolean,
    markValueReceived: () => void,
  ): {
    readonly cancel: () => void;
    readonly completed: Promise<void>;
  } {
    let cancelled = false;
    let cancelRuntime: () => void = NOOP;
    void session.replaced.catch(() => {
      cancelled = true;
      cancelRuntime();
    });
    const completed = this.runOnSession(
      session,
      (client) =>
        new Promise<void>((resolve, reject) => {
          if (cancelled) {
            resolve();
            return;
          }
          cancelRuntime = session.runtime.runCallback(
            Stream.runForEach(connect(client), (value) =>
              Effect.sync(() => {
                if (!isActive()) {
                  return;
                }

                markValueReceived();
                try {
                  listener(value);
                } catch {
                  // Ignore listener errors so the stream stays live.
                }
              }),
            ),
            {
              onExit: (exit) => {
                if (Exit.isSuccess(exit)) {
                  resolve();
                  return;
                }

                reject(Cause.squash(exit.cause));
              },
            },
          );
          if (cancelled) {
            cancelRuntime();
          }
        }),
    );

    return {
      cancel: () => {
        cancelled = true;
        cancelRuntime();
      },
      completed,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return Effect.runPromise(Effect.sleep(Duration.millis(ms)));
}
