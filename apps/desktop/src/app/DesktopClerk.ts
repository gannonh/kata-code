// @effect-diagnostics nodeBuiltinImport:off - Clerk's renderer bridge must be created synchronously before Electron's ready event.
import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { clerkFrontendApiHostnameFromPublishableKey } from "@kata-sh/code-shared/relayAuth";
import * as Electron from "electron";

import { desktopProtocolScheme } from "@kata-sh/code-shared/branding";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { isDevelopmentEnvironment } from "./DesktopEarlyElectronStartup.ts";
import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";
import {
  desktopLegacyUserDataDirName,
  resolveDesktopBaseDir,
  resolveDesktopStateDir,
  resolveDesktopUserDataPath,
} from "./DesktopStatePaths.ts";

declare const __KATACODE_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;

export class DesktopClerkBridgeInitializationError extends Schema.TaggedErrorClass<DesktopClerkBridgeInitializationError>()(
  "DesktopClerkBridgeInitializationError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerkBridgeCleanupError extends Schema.TaggedErrorClass<DesktopClerkBridgeCleanupError>()(
  "DesktopClerkBridgeCleanupError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clean up the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
  }
>()("@kata-sh/code-desktop/app/DesktopClerk") {}

export function resolveDesktopClerkFrontendApiHostname(
  publishableKey: string | undefined,
): string | undefined {
  const normalizedKey = publishableKey?.trim();
  if (!normalizedKey) return undefined;

  try {
    return clerkFrontendApiHostnameFromPublishableKey(normalizedKey);
  } catch {
    return undefined;
  }
}

export const desktopClerkFrontendApiHostname = resolveDesktopClerkFrontendApiHostname(
  typeof __KATACODE_BUILD_CLERK_PUBLISHABLE_KEY__ === "undefined"
    ? undefined
    : __KATACODE_BUILD_CLERK_PUBLISHABLE_KEY__,
);

export function createDesktopClerkBridge(stateDir: string, isDevelopment: boolean) {
  return createClerkBridge({
    storage: storage({ path: stateDir }),
    passkeys: true,
    renderer: {
      scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
      host: ElectronProtocol.DESKTOP_HOST,
    },
  });
}

type DesktopClerkBridge = ReturnType<typeof createDesktopClerkBridge>;

let preReadyBridge: DesktopClerkBridge | undefined;
let preReadyBridgeError: unknown;

export function initializeDesktopClerkBeforeReady(env: NodeJS.ProcessEnv = process.env): void {
  if (preReadyBridge !== undefined || preReadyBridgeError !== undefined) return;

  const configuredHome = env.KATACODE_HOME?.trim() || undefined;
  const isDevelopment = isDevelopmentEnvironment(env);
  const homeDirectory = NodeOS.homedir();
  const t3Home = Option.fromNullishOr(configuredHome);
  const baseDir = resolveDesktopBaseDir({
    homeDirectory,
    joinPath: NodePath.join,
    t3Home,
  });
  const stateDir = resolveDesktopStateDir({
    baseDir,
    isDevelopment,
    joinPath: NodePath.join,
    t3Home,
  });
  const userDataPath = resolveDesktopUserDataPath({
    appDataDirectory: Electron.app.getPath("appData"),
    exists: NodeFS.existsSync,
    isDevelopment,
    joinPath: NodePath.join,
    legacyUserDataDirName: desktopLegacyUserDataDirName(isDevelopment),
    userDataDirName: desktopProtocolScheme(isDevelopment),
  });

  try {
    Electron.app.setPath("userData", userDataPath);
    preReadyBridge = createDesktopClerkBridge(stateDir, isDevelopment);
  } catch (error) {
    preReadyBridgeError = error;
  }
}

/** Test-only: clear the pre-ready bridge so unit tests can re-run bootstrap. */
export function resetDesktopClerkBeforeReadyForTests(): void {
  preReadyBridge = undefined;
  preReadyBridgeError = undefined;
}

export const make = Effect.gen(function* () {
  // Clerk registers the renderer scheme during bridge creation, which must
  // happen before Electron emits `ready`. Keeping this service dependency
  // explicit makes the pre-ready layer a real acquisition prerequisite.
  yield* DesktopPreReadyPlatform.DesktopPreReadyElectronOptions;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;

  // Electron scopes the single-instance lock to the userData directory and
  // creates that directory when the lock is acquired. The SDK bridge takes
  // the lock at creation, so userData must already point at the real
  // directory here — under the default productName-derived path, acquiring
  // the lock would create "Kata Code (Alpha)" and make the legacy-install
  // detection in resolveUserDataPath match on fresh installs.
  const userDataPath = yield* DesktopAppIdentity.resolveUserDataPath;
  yield* electronApp.setPath("userData", userDataPath);

  const bridge = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        if (preReadyBridgeError !== undefined) throw preReadyBridgeError;
        const bridge =
          preReadyBridge ??
          createDesktopClerkBridge(environment.stateDir, environment.isDevelopment);
        preReadyBridge = undefined;
        return bridge;
      },
      catch: (cause) =>
        new DesktopClerkBridgeInitializationError({
          stateDir: environment.stateDir,
          isDevelopment: environment.isDevelopment,
          cause,
        }),
    }),
    (bridge) =>
      Effect.try({
        try: () => bridge.cleanup(),
        catch: (cause) =>
          new DesktopClerkBridgeCleanupError({
            stateDir: environment.stateDir,
            isDevelopment: environment.isDevelopment,
            cause,
          }),
      }).pipe(Effect.orDie),
  );

  return DesktopClerk.of({
    configure: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      // The SDK bridge holds Electron's single-instance lock (acquired at
      // bridge creation) so OAuth deep-link callbacks on Windows/Linux are
      // forwarded to the running app. In a secondary instance the bridge has
      // already begun quitting the app; app.quit() is asynchronous, so stop
      // bootstrap here before whenReady can fire.
      if (!bridge.isPrimaryInstance) {
        yield* electronApp.quit;
        return yield* Effect.interrupt;
      }

      yield* electronApp.on("second-instance", () => {
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) {
              yield* electronWindow.reveal(mainWindow.value);
            }
          }),
        );
      });
    }).pipe(Effect.withSpan("desktop.clerk.configure")),
  });
});

export const layer = Layer.effect(DesktopClerk, make);
