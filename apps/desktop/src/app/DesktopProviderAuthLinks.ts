// Upstream #14290 handles these links inside DesktopClerk.configure. Kata keeps
// DesktopClerk at its trusted-test bytes (desktop-clerk-environment-identity),
// so the same handling registers here, right after clerk.configure, which has
// already stopped a secondary instance.
import { codexAuthDeliveryUrl, readCodexAuthHandoff } from "@kata-sh/code-shared/codexAuthHandoff";
import { HostProcessArguments } from "@kata-sh/code-shared/hostProcess";
import { providerAuthReturnUrl } from "@kata-sh/code-shared/providerAuthReturnUrl";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { CodexAuthCallbackError, receiveCodexAuthCallback } from "./CodexAuthCallback.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export const register = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const shell = yield* ElectronShell.ElectronShell;
  const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
  const runPromise = Effect.runPromiseWith(context);

  const startProviderAuthHandoff = (value: string | undefined) => {
    if (!value) return false;
    const request = readCodexAuthHandoff(value, environment.isDevelopment);
    if (!request) return false;
    void runPromise(
      Effect.gen(function* () {
        yield* electronApp.whenReady;
        yield* Effect.tryPromise({
          try: () =>
            receiveCodexAuthCallback(
              request.authorizationUrl,
              (url) => runPromise(shell.openExternal(url)),
              (callbackUrl) => codexAuthDeliveryUrl(request, callbackUrl),
            ),
          catch: () =>
            new CodexAuthCallbackError({
              detail:
                "Could not receive hosted web ChatGPT sign-in. Retry or use the redirect URL in the web app.",
            }),
        });
      }).pipe(Effect.catch(() => Effect.logWarning("Could not complete ChatGPT desktop handoff."))),
    );
    return true;
  };
  const resumeProviderAuth = (value: string | undefined) => {
    const destination = providerAuthReturnUrl(value);
    const expectedOrigin = `${ElectronProtocol.getDesktopScheme(environment.isDevelopment)}://app`;
    if (!destination?.startsWith(`${expectedOrigin}/`)) return false;
    void runPromise(
      Effect.gen(function* () {
        const mainWindow = yield* electronWindow.currentMainOrFirst;
        if (Option.isNone(mainWindow)) return;
        yield* Effect.promise(() => mainWindow.value.loadURL(destination));
        yield* electronWindow.reveal(mainWindow.value);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not return to provider setup", cause),
        ),
      ),
    );
    return true;
  };

  const args = yield* HostProcessArguments;
  args.some((value) => startProviderAuthHandoff(value));
  yield* electronApp.on("open-url", (event: { preventDefault: () => void }, url: string) => {
    if (startProviderAuthHandoff(url) || resumeProviderAuth(url)) event.preventDefault();
  });
  yield* electronApp.on("second-instance", (_event: unknown, argv: readonly string[]) => {
    argv?.some((value) => startProviderAuthHandoff(value) || resumeProviderAuth(value));
  });
}).pipe(Effect.withSpan("desktop.providerAuthLinks.register"));
