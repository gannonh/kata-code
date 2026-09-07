import { afterEach, expect, it, vi } from "vite-plus/test";
import { pollSandboxOperation, retrySandboxDeployment, createSandboxDeployment } from "./api";

afterEach(() => vi.unstubAllGlobals());
const acceptedAt = "2026-09-07T00:00:00.000Z";
const receipt = (status: string) => ({
  operationId: "op",
  requestId: "req",
  command: "create",
  payloadHash: "hash",
  status,
  acceptedAt,
  updatedAt: acceptedAt,
});
it("keeps polling past 360 observations, slows after one minute, and reconnects", async () => {
  let calls = 0;
  let now = Date.parse(acceptedAt);
  const waits: number[] = [];
  const reconnects: boolean[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new TypeError("network unavailable");
      return Response.json({ receipt: receipt(calls > 365 ? "Succeeded" : "Running") });
    }),
  );
  const result = await pollSandboxOperation("op", {
    now: () => now,
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    onReconnecting: (value) => reconnects.push(value),
  });
  expect(result.status).toBe("Succeeded");
  expect(waits.slice(0, 60)).toEqual(Array(60).fill(1000));
  expect(waits[60]).toBe(5000);
  expect(reconnects).toContain(true);
});
it("stops on revoked authorization and confirms absence through the list", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ message: "Authorization revoked" }, { status: 403 })),
  );
  await expect(pollSandboxOperation("op")).rejects.toThrow("Authorization revoked");
  const fetch = vi.fn(async (url: string) =>
    url.includes("operations")
      ? Response.json({}, { status: 404 })
      : Response.json({ profiles: [], deployments: [], providers: [] }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(pollSandboxOperation("op")).rejects.toThrow("no longer available");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("retries a failed create through its predecessor without a delete request", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({ operationId: "successor" }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await retrySandboxDeployment("predecessor")).toEqual({ operationId: "successor" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe("/api/kata-sandbox/deployments");
  expect(JSON.parse(String(init?.body))).toMatchObject({
    kind: "retry",
    previousOperationId: "predecessor",
  });
});
it("stops reconnecting after a transient error followed by revoked authorization", async () => {
  let calls = 0;
  const states: boolean[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      if (calls === 1) return Response.json({ receipt: receipt("Running") });
      if (calls === 2) throw new TypeError("connection lost");
      return Response.json({ message: "Authorization revoked" }, { status: 403 });
    }),
  );
  await expect(
    pollSandboxOperation("op", {
      wait: async () => {},
      onReconnecting: (state) => states.push(state),
    }),
  ).rejects.toThrow("Authorization revoked");
  expect(states).toEqual([false, true, false]);
});

it("does not accept a late create response after its dialog closes", async () => {
  let complete: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    ),
  );
  const controller = new AbortController();
  const pending = createSandboxDeployment(
    {
      image: { kind: "custom", digest: "sha256:" + "a".repeat(64) },
      socketPath: "/var/run/docker.sock",
      label: "repo",
      repository: "owner/repo",
      ref: "main",
      providerInstanceId: "codex",
    },
    controller.signal,
  );
  await vi.waitFor(() => expect(complete).toBeDefined());
  controller.abort();
  complete?.(Response.json({ operationId: "durable-server-create" }));
  await expect(pending).rejects.toThrow();
});

it("preserves the last Running receipt when a later 404 is confirmed by discovery", async () => {
  let calls = 0;
  const observed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls += 1;
      if (calls === 1) return Response.json({ receipt: receipt("Running") });
      return url.includes("operations")
        ? Response.json({}, { status: 404 })
        : Response.json({ profiles: [], deployments: [], providers: [] });
    }),
  );
  await expect(
    pollSandboxOperation("op", {
      wait: async () => {},
      onReceipt: (value) => observed.push(value.status),
    }),
  ).rejects.toThrow("no longer available");
  expect(observed).toEqual(["Running"]);
});
