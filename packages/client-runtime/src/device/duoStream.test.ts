import { afterEach, expect, it, vi } from "vite-plus/test";
import { createDeviceStreamClient, type DeviceScreenSize } from "./stream.ts";
afterEach(() => vi.unstubAllGlobals());

it("serializes Duo rotation and hinge commands over the one input socket", async () => {
  let socketReady = () => {};
  const socketConstructed = new Promise<void>((resolve) => {
    socketReady = resolve;
  });
  class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    binaryType = "arraybuffer";
    onopen?: () => void;
    onmessage?: (event: { data: ArrayBuffer }) => void;
    onclose?: (event: { code: number; reason: string }) => void;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      Socket.instances.push(this);
      socketReady();
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", async () => new Response("prime"));
  const onDuoControl = vi.fn();
  const client = createDeviceStreamClient(
    {
      platform: "ios",
      deviceId: "duo",
      access: {
        httpBase: "https://t3.test/api/device-hub",
        wsBase: "wss://t3.test/api/device-hub",
        credentials: true,
        query: { hostId: "remote", wsTicket: "ticket" },
      },
    },
    { present: () => true },
    {
      onStatus: vi.fn(),
      onDuoControl,
      onScreen: vi.fn(),
      onInputConnected: vi.fn(),
      onUnauthorized: vi.fn(),
      onMjpegFallback: vi.fn(),
    },
  );
  client.start();
  await socketConstructed;
  const ws = Socket.instances[0]!;
  const config = (orientation: DeviceScreenSize["orientation"] = "portrait") => {
    const json = new TextEncoder().encode(
      JSON.stringify({
        width: 2007,
        height: 2853,
        orientation,
        screenId: 3,
        supportsHingeAngle: true,
        hingePose: "open",
      }),
    );
    const packet = new Uint8Array(json.length + 1);
    packet[0] = 0x82;
    packet.set(json, 1);
    ws.onmessage?.({ data: packet.buffer });
  };
  config();
  const requestedOrientation = () =>
    JSON.parse(new TextDecoder().decode(ws.send.mock.lastCall?.[0].subarray(1))).orientation;
  client.rotate();
  expect(requestedOrientation()).toBe("landscape_left");
  config(); // An orientation-locked app keeps its framebuffer orientation after the sensor rotates.
  expect(onDuoControl.mock.lastCall?.[0].error).toBeNull();
  client.rotate();
  expect(requestedOrientation()).toBe("portrait_upside_down");
  config("portrait_upside_down");
  client.rotate();
  expect(requestedOrientation()).toBe("landscape_right");
  config(); // An external native orientation change becomes authoritative again.
  client.rotate();
  expect(requestedOrientation()).toBe("landscape_left");
  config("landscape_left");
  expect(onDuoControl.mock.lastCall?.[0].pending).toBe(false);
  client.controlDuo({ control: "angle", value: 40 });
  const angleRequest = JSON.parse(new TextDecoder().decode(ws.send.mock.lastCall?.[0].subarray(1)));
  const before = ws.send.mock.calls.length;
  client.controlDuo({ control: "orientation", value: "portrait" });
  expect(ws.send.mock.calls.length).toBe(before);
  config("landscape_left"); // The angle's config precedes its receipt; it cannot acknowledge a queued rotation.
  const reply = new TextEncoder().encode(
    JSON.stringify({ requestId: angleRequest.requestId, ok: true }),
  );
  const receipt = new Uint8Array(reply.length + 1);
  receipt[0] = 0x90;
  receipt.set(reply, 1);
  ws.onmessage?.({ data: receipt.buffer });
  expect(requestedOrientation()).toBe("portrait");
  expect(ws.send.mock.lastCall?.[0][0]).toBe(0x07);
  client.controlDuo({ control: "angle", value: 55 });
  const orientationSends = ws.send.mock.calls.length;
  expect(onDuoControl.mock.lastCall?.[0].pending).toBe(true);
  config();
  expect(ws.send.mock.calls.length).toBe(orientationSends + 1);
  const after = JSON.parse(new TextDecoder().decode(ws.send.mock.lastCall?.[0].subarray(1)));
  expect(after.command).toEqual({ control: "angle", value: 55 });
  const finalReply = new TextEncoder().encode(
    JSON.stringify({ requestId: after.requestId, ok: true }),
  );
  const finalReceipt = new Uint8Array(finalReply.length + 1);
  finalReceipt[0] = 0x90;
  finalReceipt.set(finalReply, 1);
  ws.onmessage?.({ data: finalReceipt.buffer });
  expect(onDuoControl.mock.lastCall?.[0].pending).toBe(false);
  client.stop();
  expect(ws.close).toHaveBeenCalledOnce();
});

it("reopens only the main video feed when physical orientation elects another Duo display", async () => {
  const sockets: { onmessage?: (event: { data: ArrayBuffer }) => void }[] = [];
  let socketReady = () => {};
  const socketConstructed = new Promise<void>((resolve) => {
    socketReady = resolve;
  });
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 1;
      onmessage?: (event: { data: ArrayBuffer }) => void;
      send = vi.fn();
      close = vi.fn();
      constructor() {
        sockets.push(this);
        socketReady();
      }
    },
  );
  vi.stubGlobal("VideoDecoder", vi.fn());
  vi.stubGlobal("EncodedVideoChunk", vi.fn());
  const feeds: AbortSignal[] = [];
  vi.stubGlobal("fetch", async (url: string, options: { signal: AbortSignal }) => {
    if (!url.includes("/stream.avcc")) return new Response("prime");
    feeds.push(options.signal);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          options.signal.addEventListener("abort", () =>
            controller.error(new DOMException("Aborted", "AbortError")),
          );
        },
      }),
    );
  });
  const client = createDeviceStreamClient(
    {
      platform: "ios",
      deviceId: "duo",
      access: {
        httpBase: "https://t3.test",
        wsBase: "wss://t3.test",
        credentials: true,
        query: {},
      },
    },
    { present: () => true },
    {
      onStatus: vi.fn(),
      onScreen: vi.fn(),
      onInputConnected: vi.fn(),
      onUnauthorized: vi.fn(),
      onMjpegFallback: vi.fn(),
    },
  );
  client.start();
  await socketConstructed;
  const config = (screenId: number) => {
    const json = new TextEncoder().encode(
      JSON.stringify({
        width: 2007,
        height: 2853,
        orientation: "portrait",
        screenId,
        supportsHingeAngle: true,
        supportsPhysicalOrientation: true,
      }),
    );
    const packet = new Uint8Array(json.length + 1);
    packet[0] = 0x82;
    packet.set(json, 1);
    sockets[0]!.onmessage?.({ data: packet.buffer });
  };
  config(3);
  expect(feeds).toHaveLength(1);
  config(1);
  expect(feeds).toHaveLength(2);
  expect(feeds[0]!.aborted).toBe(true);
  expect(feeds[1]!.aborted).toBe(false);
  config(1);
  expect(feeds).toHaveLength(2);
  expect(sockets).toHaveLength(1);
  client.stop();
  expect(feeds[1]!.aborted).toBe(true);
});
