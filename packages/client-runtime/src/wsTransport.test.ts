import { WS_METHODS } from "@kata-sh/code-contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { WsTransport } from "./wsTransport.ts";

type WsEventType = "open" | "message" | "close" | "error";
type WsEvent = { code?: number; data?: unknown; reason?: string; type?: string };
type WsListener = (event?: WsEvent) => void;
type TransportSessionForTest = {
  clientPromise: Promise<never>;
  readonly runtime: {
    runPromise: (...args: never[]) => Promise<unknown>;
    dispose: () => Promise<void>;
  };
};

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: WsEventType, listener: WsListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason, type: "close" });
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  serverMessage(data: unknown) {
    this.emit("message", { data, type: "message" });
  }

  error() {
    this.emit("error", { type: "error" });
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const transports: WsTransport[] = [];

function getSocket(): MockWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error("Expected a websocket instance");
  }
  return socket;
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = performance.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (performance.now() - startedAt >= timeoutMs) {
        throw error;
      }
      await Effect.runPromise(Effect.sleep(Duration.millis(10)));
    }
  }
}

function createTransport(...args: ConstructorParameters<typeof WsTransport>): WsTransport {
  const transport = new WsTransport(...args);
  transports.push(transport);
  return transport;
}

beforeEach(() => {
  vi.useRealTimers();
  sockets.length = 0;
  transports.length = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://localhost:3020",
        hostname: "localhost",
        port: "3020",
        protocol: "http:",
      },
      desktopBridge: undefined,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(async () => {
  await Promise.allSettled(transports.map((transport) => transport.dispose()));
  transports.length = 0;
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("normalizes root websocket urls to /ws and preserves query params", async () => {
    const transport = createTransport("ws://localhost:3020/?token=secret-token");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    expect(getSocket().url).toBe("ws://localhost:3020/ws?token=secret-token");
    await transport.dispose();
  });

  it("uses an explicit secure websocket base url", async () => {
    const transport = createTransport("wss://app.example.com");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    expect(getSocket().url).toBe("wss://app.example.com/ws");
    await transport.dispose();
  });

  it("uses an explicit insecure websocket base url for remote backends", async () => {
    const transport = createTransport("ws://192.168.1.44:3773");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    expect(getSocket().url).toBe("ws://192.168.1.44:3773/ws");
    await transport.dispose();
  });

  it("supports async websocket url providers", async () => {
    const transport = createTransport(async () => "wss://remote.example.com/?wsTicket=dynamic");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    expect(getSocket().url).toBe("wss://remote.example.com/ws?wsTicket=dynamic");
    await transport.dispose();
  });

  it("invokes optional lifecycle handlers when the socket opens and closes", async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const transport = createTransport("ws://localhost:3020", {
      onOpen,
      onClose,
    });

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const socket = getSocket();
    socket.open();

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledOnce();
    });

    socket.close(1012, "service restart");

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith(
        {
          code: 1012,
          reason: "service restart",
        },
        {
          intentional: false,
        },
      );
    });

    await transport.dispose();
  });

  it("tracks heartbeat freshness from websocket pongs", async () => {
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const onHeartbeatPong = vi.fn();
    const transport = createTransport("ws://localhost:3020", { onHeartbeatPong });

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    expect(transport.isHeartbeatFresh()).toBe(false);

    const socket = getSocket();
    socket.open();
    socket.serverMessage(JSON.stringify({ _tag: "Pong" }));

    await waitFor(() => {
      expect(onHeartbeatPong).toHaveBeenCalledOnce();
    });

    expect(transport.isHeartbeatFresh()).toBe(true);
    expect(transport.isHeartbeatFresh(500)).toBe(true);

    nowSpy.mockReturnValue(1_501);
    expect(transport.isHeartbeatFresh(500)).toBe(false);

    await transport.dispose();
  });

  it("clears heartbeat freshness when reconnecting", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    const onHeartbeatPong = vi.fn();
    const transport = createTransport("ws://localhost:3020", { onHeartbeatPong });

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const firstSocket = getSocket();
    firstSocket.open();
    firstSocket.serverMessage(JSON.stringify({ _tag: "Pong" }));

    await waitFor(() => {
      expect(onHeartbeatPong).toHaveBeenCalledOnce();
    });
    expect(transport.isHeartbeatFresh()).toBe(true);

    await transport.reconnect();

    expect(transport.isHeartbeatFresh()).toBe(false);

    await transport.dispose();
  });

  it("does not report an intentional dispose as a close", async () => {
    const onClose = vi.fn();
    const transport = createTransport("ws://localhost:3020", { onClose });

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    getSocket().open();
    await transport.dispose();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores stale socket lifecycle events after reconnect starts a new session", async () => {
    const onClose = vi.fn();
    const transport = createTransport("ws://localhost:3020", { onClose });

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const firstSocket = getSocket();
    firstSocket.open();

    await transport.reconnect();

    await waitFor(() => {
      expect(sockets).toHaveLength(2);
    });

    firstSocket.close(1006, "stale close");

    expect(onClose).not.toHaveBeenCalled();

    await transport.dispose();
  });

  it("rejects client acquisition when its session is replaced", async () => {
    const transport = createTransport("ws://localhost:3020");
    await waitFor(() => expect(sockets).toHaveLength(1));
    const session = (transport as unknown as { session: TransportSessionForTest }).session;
    session.clientPromise = new Promise<never>(() => undefined);

    const requestPromise = transport.request(() => Effect.succeed("unexpected"));
    await transport.reconnect();

    await expect(requestPromise).rejects.toThrow(/replaced by a reconnect/);
  });

  it("rejects an in-flight request when its session is replaced by a reconnect", async () => {
    const transport = createTransport("ws://localhost:3020");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    getSocket().open();

    // Dispatch a request on the first session, then reconnect before the server
    // answers. Without the session-replacement race this promise would hang
    // forever (the old runtime's scope is closed in the background), which left
    // UI callers stuck on "Loading…" with no error to react to.
    const requestPromise = transport.request((client) =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: "terminal.toggle",
        key: "ctrl+k",
      }),
    );

    await transport.reconnect();

    await expect(requestPromise).rejects.toThrow(/replaced by a reconnect/);

    await transport.dispose();
  });

  it("reconnects the websocket session without disposing the transport", async () => {
    const transport = createTransport("ws://localhost:3020");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const firstSocket = getSocket();
    firstSocket.open();

    await transport.reconnect();

    await waitFor(() => {
      expect(sockets).toHaveLength(2);
    });

    await waitFor(() => {
      expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED);
    });

    const secondSocket = getSocket();
    expect(secondSocket).not.toBe(firstSocket);

    const requestPromise = transport.request((client) =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: "terminal.toggle",
        key: "ctrl+k",
      }),
    );

    secondSocket.open();

    await waitFor(() => {
      expect(secondSocket.sent).toHaveLength(1);
    });

    const requestMessage = JSON.parse(secondSocket.sent[0] ?? "{}") as { id: string };
    secondSocket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: requestMessage.id,
        exit: {
          _tag: "Success",
          value: {
            keybindings: [],
            issues: [],
          },
        },
      }),
    );

    await expect(requestPromise).resolves.toEqual({
      keybindings: [],
      issues: [],
    });

    await transport.dispose();
  });

  it("sends requests while the previous session is still closing", async () => {
    const transport = createTransport("ws://localhost:3020");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    getSocket().open();
    let releaseClose!: () => void;
    const pendingClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const closeSession = vi
      .spyOn(
        transport as unknown as {
          closeSession: (session: unknown) => Promise<void>;
        },
        "closeSession",
      )
      .mockReturnValue(pendingClose);

    await transport.reconnect();
    await waitFor(() => {
      expect(sockets).toHaveLength(2);
    });

    const secondSocket = getSocket();
    const requestPromise = transport.request((client) =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: "terminal.toggle",
        key: "ctrl+k",
      }),
    );
    secondSocket.open();

    await waitFor(() => {
      expect(secondSocket.sent).toHaveLength(1);
    });
    const requestMessage = JSON.parse(secondSocket.sent[0] ?? "{}") as { id: string };
    secondSocket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: requestMessage.id,
        exit: {
          _tag: "Success",
          value: { keybindings: [], issues: [] },
        },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ keybindings: [], issues: [] });
    releaseClose();
    closeSession.mockRestore();
    await transport.dispose();
  });

  it("sends unary RPC requests and resolves successful exits", async () => {
    const transport = createTransport("ws://localhost:3020");

    const requestPromise = transport.request((client) =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: "terminal.toggle",
        key: "ctrl+k",
      }),
    );

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const socket = getSocket();
    socket.open();

    await waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });

    const requestMessage = JSON.parse(socket.sent[0] ?? "{}") as {
      _tag: string;
      id: string;
      payload: unknown;
      tag: string;
    };
    expect(requestMessage).toMatchObject({
      _tag: "Request",
      tag: WS_METHODS.serverUpsertKeybinding,
      payload: {
        command: "terminal.toggle",
        key: "ctrl+k",
      },
    });

    socket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: requestMessage.id,
        exit: {
          _tag: "Success",
          value: {
            keybindings: [],
            issues: [],
          },
        },
      }),
    );

    await expect(requestPromise).resolves.toEqual({
      keybindings: [],
      issues: [],
    });

    await transport.dispose();
  });

  it("delivers stream chunks to subscribers", async () => {
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
    );
    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const socket = getSocket();
    socket.open();

    await waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });

    const requestMessage = JSON.parse(socket.sent[0] ?? "{}") as { id: string; tag: string };
    expect(requestMessage.tag).toBe(WS_METHODS.subscribeServerLifecycle);

    const welcomeEvent = {
      version: 1,
      sequence: 1,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "Local environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/workspace",
        projectName: "workspace",
      },
    };

    socket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: requestMessage.id,
        values: [welcomeEvent],
      }),
    );

    await waitFor(() => {
      expect(listener).toHaveBeenCalledWith(welcomeEvent);
    });

    unsubscribe();
    await transport.dispose();
  });

  it("re-subscribes stream listeners after the stream exits", async () => {
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();
    const onResubscribe = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { onResubscribe },
    );
    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const socket = getSocket();
    socket.open();

    await waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });

    const firstRequest = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: firstRequest.id,
        values: [
          {
            version: 1,
            sequence: 1,
            type: "welcome",
            payload: {
              environment: {
                environmentId: "environment-local",
                label: "Local environment",
                platform: { os: "darwin", arch: "arm64" },
                serverVersion: "0.0.0-test",
                capabilities: { repositoryIdentity: true },
              },
              cwd: "/tmp/one",
              projectName: "one",
            },
          },
        ],
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: firstRequest.id,
        exit: {
          _tag: "Success",
          value: null,
        },
      }),
    );

    await waitFor(() => {
      const nextRequest = socket.sent
        .map((message) => JSON.parse(message) as { _tag?: string; id?: string })
        .find((message) => message._tag === "Request" && message.id !== firstRequest.id);
      expect(nextRequest).toBeDefined();
    });
    expect(onResubscribe).toHaveBeenCalledOnce();

    const secondRequest = socket.sent
      .map((message) => JSON.parse(message) as { _tag?: string; id?: string; tag?: string })
      .find(
        (message): message is { _tag: "Request"; id: string; tag: string } =>
          message._tag === "Request" && message.id !== firstRequest.id,
      );
    if (!secondRequest) {
      throw new Error("Expected a resubscribe request");
    }
    expect(secondRequest.tag).toBe(WS_METHODS.subscribeServerLifecycle);
    expect(secondRequest.id).not.toBe(firstRequest.id);

    const secondEvent = {
      version: 1,
      sequence: 2,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "Local environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/two",
        projectName: "two",
      },
    };
    socket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: secondRequest.id,
        values: [secondEvent],
      }),
    );

    await waitFor(() => {
      expect(listener).toHaveBeenLastCalledWith(secondEvent);
    });

    unsubscribe();
    await transport.dispose();
  });

  it("re-subscribes live stream listeners after an explicit transport reconnect", async () => {
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();
    const onResubscribe = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { onResubscribe },
    );

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const firstSocket = getSocket();
    firstSocket.open();

    await waitFor(() => {
      expect(firstSocket.sent).toHaveLength(1);
    });

    const firstRequest = JSON.parse(firstSocket.sent[0] ?? "{}") as { id: string };
    const firstEvent = {
      version: 1,
      sequence: 1,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "Local environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/one",
        projectName: "one",
      },
    };

    firstSocket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: firstRequest.id,
        values: [firstEvent],
      }),
    );

    await waitFor(() => {
      expect(listener).toHaveBeenLastCalledWith(firstEvent);
    });

    await transport.reconnect();

    await waitFor(() => {
      expect(sockets).toHaveLength(2);
    });

    await waitFor(() => {
      expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED);
    });

    const secondSocket = getSocket();
    expect(secondSocket).not.toBe(firstSocket);

    secondSocket.open();

    await waitFor(() => {
      expect(secondSocket.sent).toHaveLength(1);
    });

    const secondRequest = JSON.parse(secondSocket.sent[0] ?? "{}") as {
      id: string;
      tag: string;
    };
    expect(secondRequest.tag).toBe(WS_METHODS.subscribeServerLifecycle);
    expect(secondRequest.id).not.toBe(firstRequest.id);
    expect(onResubscribe).toHaveBeenCalledOnce();

    const secondEvent = {
      version: 1,
      sequence: 2,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-local",
          label: "Local environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/two",
        projectName: "two",
      },
    };

    secondSocket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: secondRequest.id,
        values: [secondEvent],
      }),
    );

    await waitFor(() => {
      expect(listener).toHaveBeenLastCalledWith(secondEvent);
    });

    unsubscribe();
    await transport.dispose();
  });

  it("re-subscribes when the replaced session never acquires a client", async () => {
    const transport = createTransport("ws://localhost:3020", undefined, {
      sessionCloseTimeout: 10,
    });
    await waitFor(() => expect(sockets).toHaveLength(1));
    const firstSession = (transport as unknown as { session: TransportSessionForTest }).session;
    firstSession.clientPromise = new Promise<never>(() => undefined);

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      vi.fn(),
    );

    await transport.reconnect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    const replacementSocket = getSocket();
    replacementSocket.open();

    await waitFor(() => expect(replacementSocket.sent).toHaveLength(1));
    expect(JSON.parse(replacementSocket.sent[0] ?? "{}")).toMatchObject({
      tag: WS_METHODS.subscribeServerLifecycle,
    });

    unsubscribe();
    await transport.dispose();
  });

  it("re-subscribes while the replaced stream and session cleanup never settle", async () => {
    const transport = createTransport("ws://localhost:3020");
    await waitFor(() => expect(sockets).toHaveLength(1));
    getSocket().open();

    let attempts = 0;
    const unsubscribe = transport.subscribe(() => {
      attempts += 1;
      return Stream.never;
    }, vi.fn());
    await waitFor(() => expect(attempts).toBe(1));

    let releaseClose!: () => void;
    const pendingClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const closeSession = vi
      .spyOn(
        transport as unknown as { closeSession: (session: unknown) => Promise<void> },
        "closeSession",
      )
      .mockReturnValue(pendingClose);

    await transport.reconnect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    getSocket().open();
    await waitFor(() => expect(attempts).toBe(2));

    unsubscribe();
    closeSession.mockRestore();
    releaseClose();
    await transport.dispose();
  });

  it("ignores superseded subscription events while the replacement stream stays active", async () => {
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    const firstSocket = getSocket();
    firstSocket.open();
    await waitFor(() => expect(firstSocket.sent).toHaveLength(1));
    const firstRequest = JSON.parse(firstSocket.sent[0] ?? "{}") as { id: string };

    let releaseClose!: () => void;
    const pendingClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const closeSession = vi
      .spyOn(
        transport as unknown as { closeSession: (session: unknown) => Promise<void> },
        "closeSession",
      )
      .mockReturnValue(pendingClose);

    await transport.reconnect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    const replacementSocket = getSocket();
    replacementSocket.open();
    await waitFor(() => expect(replacementSocket.sent).toHaveLength(1));
    const replacementRequest = JSON.parse(replacementSocket.sent[0] ?? "{}") as { id: string };

    const staleEvent = {
      version: 1,
      sequence: 1,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-stale",
          label: "Stale environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/stale",
        projectName: "stale",
      },
    };
    firstSocket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: firstRequest.id,
        values: [staleEvent],
      }),
    );
    await Effect.runPromise(Effect.sleep("1 millis"));
    expect(listener).not.toHaveBeenCalled();

    const replacementEvent = {
      version: 1,
      sequence: 2,
      type: "welcome",
      payload: {
        environment: {
          environmentId: "environment-current",
          label: "Current environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        cwd: "/tmp/current",
        projectName: "current",
      },
    };
    replacementSocket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: replacementRequest.id,
        values: [replacementEvent],
      }),
    );
    await waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenLastCalledWith(replacementEvent);

    unsubscribe();
    closeSession.mockRestore();
    releaseClose();
    await transport.dispose();
  });

  it("does not fire onResubscribe when the first stream attempt exits before any value", async () => {
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();
    const onResubscribe = vi.fn();

    const unsubscribe = transport.subscribe(
      (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { onResubscribe },
    );
    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    const socket = getSocket();
    socket.open();

    await waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });

    const firstRequest = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: firstRequest.id,
        exit: {
          _tag: "Success",
          value: null,
        },
      }),
    );

    await waitFor(() => {
      const nextRequest = socket.sent
        .map((message) => JSON.parse(message) as { _tag?: string; id?: string })
        .find((message) => message._tag === "Request" && message.id !== firstRequest.id);
      expect(nextRequest).toBeDefined();
    });
    expect(onResubscribe).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    await transport.dispose();
  });

  it("does not retry stream subscriptions after application-level failures", async () => {
    const warnSpy = vi.fn();
    const transport = createTransport("ws://localhost:3020", undefined, { logWarning: warnSpy });
    let attempts = 0;

    const unsubscribe = transport.subscribe(
      () =>
        Stream.suspend(() => {
          attempts += 1;
          return Stream.fail(new Error("Git command failed in GitCore.statusDetails"));
        }),
      vi.fn(),
      { retryDelay: 10 },
    );

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    getSocket().open();

    await waitFor(() => {
      expect(attempts).toBe(1);
    });
    const stableSince = performance.now();
    await waitFor(() => {
      expect(performance.now() - stableSince).toBeGreaterThanOrEqual(50);
    });

    expect(attempts).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith("WebSocket RPC subscription failed", {
      error: "Git command failed in GitCore.statusDetails",
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      "WebSocket RPC subscription disconnected",
      expect.anything(),
    );

    unsubscribe();
    await transport.dispose();
  });

  it("keeps retrying stream subscriptions after transport failures", async () => {
    const warnSpy = vi.fn();
    const transport = createTransport("ws://localhost:3020", undefined, { logWarning: warnSpy });
    let attempts = 0;

    const unsubscribe = transport.subscribe(
      () =>
        Stream.suspend(() => {
          attempts += 1;
          return Stream.fail(new Error("Socket is not connected"));
        }),
      vi.fn(),
      { retryDelay: 10 },
    );

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    getSocket().open();

    await waitFor(() => {
      expect(attempts).toBeGreaterThanOrEqual(2);
    });

    expect(warnSpy).toHaveBeenCalledWith("WebSocket RPC subscription disconnected", {
      error: "Socket is not connected",
    });

    unsubscribe();
    await transport.dispose();
  });

  it("logs a transport disconnect once even when multiple subscriptions fail together", async () => {
    const warnSpy = vi.fn();
    const transport = createTransport("ws://localhost:3020", undefined, { logWarning: warnSpy });

    const unsubscribeA = transport.subscribe(
      () => Stream.fail(new Error("SocketCloseError: 1006")),
      vi.fn(),
      { retryDelay: 10 },
    );
    const unsubscribeB = transport.subscribe(
      () => Stream.fail(new Error("SocketCloseError: 1006")),
      vi.fn(),
      { retryDelay: 10 },
    );

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    getSocket().open();

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
    expect(warnSpy).toHaveBeenCalledWith("WebSocket RPC subscription disconnected", {
      error: "SocketCloseError: 1006",
    });

    unsubscribeA();
    unsubscribeB();
    await transport.dispose();
  });

  it("rejects an active finite stream request when its session is replaced", async () => {
    const transport = createTransport("ws://localhost:3020");

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    getSocket().open();

    const requestPromise = transport.requestStream(
      (client) =>
        client[WS_METHODS.gitRunStackedAction]({
          actionId: "action-1",
          cwd: "/repo",
          action: "commit",
        }),
      vi.fn(),
    );

    await waitFor(() => {
      expect(getSocket().sent).toHaveLength(1);
    });
    await transport.reconnect();

    await expect(requestPromise).rejects.toThrow(/replaced by a reconnect/);
  });

  it("streams finite request events without re-subscribing", async () => {
    const transport = createTransport("ws://localhost:3020");
    const listener = vi.fn();

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.requestStream(
      (client) =>
        client[WS_METHODS.gitRunStackedAction]({
          actionId: "action-1",
          cwd: "/repo",
          action: "commit",
        }),
      listener,
    );

    await waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });

    const requestMessage = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    const progressEvent = {
      actionId: "action-1",
      cwd: "/repo",
      action: "commit",
      kind: "phase_started",
      phase: "commit",
      label: "Committing...",
    } as const;

    socket.serverMessage(
      JSON.stringify({
        _tag: "Chunk",
        requestId: requestMessage.id,
        values: [progressEvent],
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: requestMessage.id,
        exit: {
          _tag: "Success",
          value: null,
        },
      }),
    );

    await expect(requestPromise).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledWith(progressEvent);
    expect(
      socket.sent.filter((message) => {
        const parsed = JSON.parse(message) as { _tag?: string; tag?: string };
        return parsed._tag === "Request" && parsed.tag === WS_METHODS.gitRunStackedAction;
      }),
    ).toHaveLength(1);
    await transport.dispose();
  });

  it("tracks repeated reconnect retirements and dispose drains all of them", async () => {
    const transport = createTransport("ws://localhost:3020");
    await waitFor(() => expect(sockets).toHaveLength(1));
    getSocket().open();

    const releases: Array<() => void> = [];
    const closeSession = vi
      .spyOn(
        transport as unknown as { closeSession: (session: unknown) => Promise<void> },
        "closeSession",
      )
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      );

    await transport.reconnect();
    await transport.reconnect();
    await transport.reconnect();
    const disposePromise = transport.dispose();

    await waitFor(() => expect(closeSession).toHaveBeenCalledTimes(4));
    let disposed = false;
    void disposePromise.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    for (const release of releases) release();
    await disposePromise;
    expect(disposed).toBe(true);
    closeSession.mockRestore();
  });

  it("bounds failed session cleanup, logs it, and still drains on dispose", async () => {
    const warnSpy = vi.fn();
    const transport = createTransport("ws://localhost:3020", undefined, {
      logWarning: warnSpy,
      sessionCloseTimeout: "10 millis",
    });
    await waitFor(() => expect(sockets).toHaveLength(1));
    getSocket().open();

    const session = (transport as unknown as { session: TransportSessionForTest }).session;
    vi.spyOn(session.runtime, "runPromise").mockReturnValueOnce(new Promise(() => undefined));
    vi.spyOn(session.runtime, "dispose").mockRejectedValueOnce(new Error("dispose exploded"));

    await transport.reconnect();
    await transport.dispose();

    expect(warnSpy).toHaveBeenCalledWith("WebSocket session scope close failed", {
      error: "timed out after 10ms",
    });
    expect(warnSpy).toHaveBeenCalledWith("WebSocket session runtime disposal failed", {
      error: "dispose exploded",
    });
  });
});
