// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - Hosted handoff test uses a real localhost listener without an OpenAI account.
// Upstream #14290 added these cases to DesktopClerk.test.ts, which Kata keeps
// at its trusted bytes; they follow the handling into DesktopProviderAuthLinks.
import * as NodeHttp from "node:http";
import { EnvironmentId, ProviderInstanceId } from "@kata-sh/code-contracts";
import { codexAuthHandoffUrl, readCodexAuthDelivery } from "@kata-sh/code-shared/codexAuthHandoff";
import { HostProcessArguments } from "@kata-sh/code-shared/hostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopProviderAuthLinks from "./DesktopProviderAuthLinks.ts";

const environment = DesktopEnvironment.DesktopEnvironment.of({
  isDevelopment: true,
} as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

const noopShell = ElectronShell.ElectronShell.of({
  openExternal: () => Effect.succeed(true),
  openSystemSettings: () => Effect.succeed(false),
  copyText: () => Effect.void,
});

const recordingApp = (listeners: Map<string, (...args: unknown[]) => void>) =>
  ({
    whenReady: Effect.void,
    on: (name: string, listener: (...args: unknown[]) => void) =>
      Effect.sync(() => {
        listeners.set(name, listener);
      }),
  }) as unknown as ElectronApp.ElectronApp["Service"];

it.effect(
  "provider auth deep links navigate and reveal the running desktop without handling Clerk URLs",
  () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const revealed = Promise.withResolvers<void>();
    const loadURL = vi.fn(async (_url: string) => undefined);
    const window = { loadURL };
    const electronWindow = {
      currentMainOrFirst: Effect.succeed(Option.some(window)),
      reveal: () => Effect.sync(() => revealed.resolve()),
    } as unknown as ElectronWindow.ElectronWindow["Service"];
    return Effect.gen(function* () {
      yield* DesktopProviderAuthLinks.register;
      const event = { preventDefault: vi.fn() };
      listeners.get("open-url")!(event, "katacode-dev://app/auth/callback?code=clerk-code");
      listeners.get("open-url")!(event, "katacode://app/welcome");
      listeners.get("open-url")!(event, "t3code-dev://app/welcome");
      assert.equal(loadURL.mock.calls.length, 0);
      assert.equal(event.preventDefault.mock.calls.length, 0);
      listeners.get("second-instance")!({}, [
        "katacode",
        "katacode-dev://app/settings/providers?instanceId=work&code=never-forward",
      ]);
      yield* Effect.promise(() => revealed.promise);
      assert.deepEqual(loadURL.mock.calls, [
        ["katacode-dev://app/settings/providers?instanceId=work"],
      ]);
      listeners.get("open-url")!(event, "katacode-dev://app/welcome#agents:machine-id");
      assert.equal(event.preventDefault.mock.calls.length, 1);
    }).pipe(
      Effect.scoped,
      Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
      Effect.provideService(ElectronShell.ElectronShell, noopShell),
      Effect.provideService(HostProcessArguments, ["katacode"]),
      Effect.provideService(ElectronApp.ElectronApp, recordingApp(listeners)),
      Effect.provideService(ElectronWindow.ElectronWindow, electronWindow),
    );
  },
);

for (const entry of ["startup", "open-url"] as const) {
  it.effect(`receives hosted web sign-in through the desktop ${entry} handler`, () =>
    Effect.gen(function* () {
      const port = yield* Effect.promise(async () => {
        const server = NodeHttp.createServer();
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("address");
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return address.port;
      });
      const authorize = new URL("https://auth.openai.com/api/accounts/authorize");
      authorize.search = new URLSearchParams({
        client_id: "dynamic_agent_client",
        response_type: "code",
        redirect_uri: `http://127.0.0.1:${port}/auth/callback`,
        state: "a".repeat(43),
        code_challenge_method: "S256",
        code_challenge: "b".repeat(43),
      }).toString();
      const request = {
        authorizationUrl: authorize.toString(),
        returnUrl: "https://app.kata.sh/welcome#agents:remote-one",
        environmentId: EnvironmentId.make("remote-one"),
        instanceId: ProviderInstanceId.make("work"),
        flowId: "flow-one",
      };
      const link = codexAuthHandoffUrl(request, true);
      assert.isTrue(link.startsWith("katacode-dev://auth/codex?"));
      const delivered = Promise.withResolvers<string>();
      const shell = ElectronShell.ElectronShell.of({
        openExternal: (value) =>
          Effect.promise(async () => {
            const url = new URL(String(value));
            const callback = new URL(url.searchParams.get("redirect_uri")!);
            callback.search = new URLSearchParams({
              state: url.searchParams.get("state")!,
              code: "test-code",
              client_id: "oaiapp_test",
            }).toString();
            const response = await fetch(callback, { redirect: "manual" });
            delivered.resolve(response.headers.get("location")!);
            return true;
          }),
        openSystemSettings: () => Effect.succeed(false),
        copyText: () => Effect.void,
      });
      const listeners = new Map<string, (...args: unknown[]) => void>();
      yield* Effect.gen(function* () {
        yield* DesktopProviderAuthLinks.register;
        if (entry === "open-url") {
          const event = { preventDefault: vi.fn() };
          listeners.get("open-url")!(event, link);
          assert.strictEqual(event.preventDefault.mock.calls.length, 1);
        }
        const delivery = readCodexAuthDelivery(yield* Effect.promise(() => delivered.promise));
        assert.strictEqual(delivery?.environmentId, request.environmentId);
        assert.strictEqual(delivery?.instanceId, request.instanceId);
        assert.strictEqual(delivery?.flowId, request.flowId);
        assert.strictEqual(delivery?.returnUrl, request.returnUrl);
      }).pipe(
        Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment),
        Effect.provideService(ElectronShell.ElectronShell, shell),
        Effect.provideService(
          HostProcessArguments,
          entry === "startup" ? ["katacode", link] : ["katacode"],
        ),
        Effect.provideService(ElectronApp.ElectronApp, recordingApp(listeners)),
        Effect.provideService(
          ElectronWindow.ElectronWindow,
          {} as ElectronWindow.ElectronWindow["Service"],
        ),
      );
    }).pipe(Effect.scoped),
  );
}
