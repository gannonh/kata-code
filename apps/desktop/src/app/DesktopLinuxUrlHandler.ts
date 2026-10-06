import {
  DESKTOP_LEGACY_URL_HANDLER_ENTRY_NAME,
  DESKTOP_URL_HANDLER_ENTRY_NAME,
  desktopProtocolScheme,
  desktopUrlHandlerSchemes,
} from "@kata-sh/code-shared/branding";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

// Linux ships as an AppImage, so the .desktop entry users end up with is
// created by whatever integration tool they use (AppImageLauncher names it
// appimagekit_<hash>-….desktop) and its filename is not under our control.
// Electron's app.setAsDefaultProtocolClient resolves the desktop id from
// setDesktopName, which cannot match those files — so the browser keeps
// prompting "Choose an application" for every OAuth callback. Instead, write
// our own handler entry pointing at the current AppImage, refresh the desktop
// MIME cache so desktop environments recognize that entry as a handler, and
// use xdg-mime to record it as the scheme default in mimeapps.list.
const URL_HANDLER_DESKTOP_ENTRY_NAME = DESKTOP_URL_HANDLER_ENTRY_NAME;

// Packaged, the handler owns a file of its own. Unpackaged, it writes the
// portal-identity entry itself.
function urlHandlerEntryName(input: {
  readonly isPackaged: boolean;
  readonly linuxDesktopEntryName: string;
}): string {
  return input.isPackaged ? URL_HANDLER_DESKTOP_ENTRY_NAME : input.linuxDesktopEntryName;
}

// The portal-identity entry claims the URL schemes only when it is the same
// file as the handler entry. Otherwise a second claim would list Kata Code
// twice in "Choose an application".
export function portalEntryClaimsSchemes(input: {
  readonly isPackaged: boolean;
  readonly linuxDesktopEntryName: string;
}): boolean {
  return urlHandlerEntryName(input) === input.linuxDesktopEntryName;
}

// Pre-ready setup and the handler both point their entries at this one copy of
// the app icon, so the two render identical content. The AppImage mount is
// temporary; the OS chooser needs the icon after the app exits.
export function urlHandlerIconPath(
  join: (...segments: string[]) => string,
  applicationsDir: string,
): string {
  return join(applicationsDir, "..", "icons", `${URL_HANDLER_DESKTOP_ENTRY_NAME}.png`);
}

const { logInfo, logWarning } = makeComponentLogger("desktop-linux-url-handler");

export class DesktopLinuxUrlHandlerRegistrationError extends Schema.TaggedError<DesktopLinuxUrlHandlerRegistrationError>()(
  "DesktopLinuxUrlHandlerRegistrationError",
  {
    step: Schema.Literals(["write-desktop-entry", "set-default-handler"]),
    scheme: Schema.String,
    desktopEntryPath: Schema.optionalKey(Schema.String),
    exitCode: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    const exitCode = this.exitCode === undefined ? "" : `, xdg-mime exit code ${this.exitCode}`;
    return `Failed to register the ${this.scheme}:// URL handler (step: ${this.step}${exitCode}).`;
  }
}

const isRegistrationError = Schema.is(DesktopLinuxUrlHandlerRegistrationError);

export class DesktopLinuxUrlHandlerCacheRefreshError extends Schema.TaggedError<DesktopLinuxUrlHandlerCacheRefreshError>()(
  "DesktopLinuxUrlHandlerCacheRefreshError",
  {
    applicationsDir: Schema.String,
    exitCode: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    const exitCode =
      this.exitCode === undefined ? "" : `, update-desktop-database exit code ${this.exitCode}`;
    return `Failed to refresh the desktop MIME cache at ${this.applicationsDir}${exitCode}.`;
  }
}

const isCacheRefreshError = Schema.is(DesktopLinuxUrlHandlerCacheRefreshError);

const escapeDesktopEntryString = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");

// Exec values are unescaped twice by implementations: first the general
// string-value rules, then the Exec quoting rules — so writing composes the
// layers in reverse. The argument is double-quoted with reserved characters
// backslash-escaped and literal percent signs doubled (field codes), and the
// general string escaping is applied on top: a literal backslash ends up as
// four backslashes in the file, a quote as \\", a dollar sign as \\$.
export function escapeDesktopEntryExecArgument(value: string): string {
  const quoted = value
    .replaceAll("\\", () => "\\\\")
    .replaceAll("`", () => "\\`")
    .replaceAll("$", () => "\\$")
    .replaceAll('"', () => '\\"')
    .replaceAll("%", () => "%%");
  return escapeDesktopEntryString(`"${quoted}"`);
}

// The AppImage integration entry owns the window identity. This
// hidden URL-only entry must not compete with it for StartupWMClass matching.
// Null `schemes` renders no MimeType, so the entry claims no scheme.
export function renderUrlHandlerDesktopEntry(input: {
  readonly displayName: string;
  readonly execTarget: string;
  readonly schemes: readonly string[] | null;
  readonly iconPath?: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${escapeDesktopEntryString(input.displayName)}`,
    `Exec=${escapeDesktopEntryExecArgument(input.execTarget)} %U`,
    ...(input.iconPath === undefined ? [] : [`Icon=${escapeDesktopEntryString(input.iconPath)}`]),
    "Terminal=false",
    "NoDisplay=true",
    "StartupNotify=false",
    ...(input.schemes === null
      ? []
      : [`MimeType=${input.schemes.map((scheme) => `x-scheme-handler/${scheme}`).join(";")};`]),
    "",
  ].join("\n");
}

export class DesktopLinuxUrlHandler extends Context.Service<
  DesktopLinuxUrlHandler,
  {
    readonly register: Effect.Effect<void>;
  }
>()("@kata-sh/code-desktop/app/DesktopLinuxUrlHandler") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const assets = yield* DesktopAssets.DesktopAssets;

  const scheme = desktopProtocolScheme(environment.isDevelopment);
  const schemes = desktopUrlHandlerSchemes(environment.isDevelopment);
  const desktopEntryPath = environment.path.join(
    environment.linuxApplicationsDir,
    urlHandlerEntryName(environment),
  );
  const legacyDesktopEntryPath = environment.path.join(
    environment.linuxApplicationsDir,
    DESKTOP_LEGACY_URL_HANDLER_ENTRY_NAME,
  );
  const iconPath = urlHandlerIconPath(environment.path.join, environment.linuxApplicationsDir);

  const writeDesktopEntry = Effect.gen(function* () {
    // Inside the mounted AppImage, process.execPath points at a transient
    // /tmp/.mount_* path — the handler must launch the AppImage itself.
    const execTarget = Option.getOrElse(environment.appImagePath, () => process.execPath);
    const content = renderUrlHandlerDesktopEntry({
      displayName: environment.displayName,
      execTarget,
      schemes,
      ...(environment.isPackaged ? { iconPath } : {}),
    });
    // Skip a rewrite of a current entry: the portal may be reading it during
    // startup, and a rewrite would truncate it.
    const existing = yield* fileSystem
      .readFileString(desktopEntryPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (existing === content) return;
    yield* fileSystem.makeDirectory(environment.linuxApplicationsDir, { recursive: true });
    yield* fileSystem.writeFileString(desktopEntryPath, content);
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopLinuxUrlHandlerRegistrationError({
          step: "write-desktop-entry",
          scheme,
          desktopEntryPath,
          cause,
        }),
    ),
  );

  const updateDesktopDatabase = Effect.scoped(
    Effect.gen(function* () {
      const command = ChildProcess.make(
        "update-desktop-database",
        [environment.linuxApplicationsDir],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      const handle = yield* spawner.spawn(command);
      const exitCode = yield* handle.exitCode.pipe(Effect.timeout("5 seconds"));
      if ((exitCode as unknown as number) !== 0) {
        return yield* new DesktopLinuxUrlHandlerCacheRefreshError({
          applicationsDir: environment.linuxApplicationsDir,
          exitCode: Number(exitCode),
        });
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      isCacheRefreshError(error)
        ? error
        : new DesktopLinuxUrlHandlerCacheRefreshError({
            applicationsDir: environment.linuxApplicationsDir,
            cause: error,
          }),
    ),
  );

  const setDefaultHandler = Effect.scoped(
    Effect.gen(function* () {
      for (const handlerScheme of schemes) {
        const command = ChildProcess.make(
          "xdg-mime",
          ["default", URL_HANDLER_DESKTOP_ENTRY_NAME, `x-scheme-handler/${handlerScheme}`],
          {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          },
        );
        const handle = yield* spawner.spawn(command);
        const exitCode = yield* handle.exitCode;
        if ((exitCode as unknown as number) !== 0) {
          return yield* new DesktopLinuxUrlHandlerRegistrationError({
            step: "set-default-handler",
            scheme: handlerScheme,
            exitCode: Number(exitCode),
          });
        }
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      isRegistrationError(error)
        ? error
        : new DesktopLinuxUrlHandlerRegistrationError({
            step: "set-default-handler",
            scheme,
            cause: error,
          }),
    ),
  );

  const register = Effect.gen(function* () {
    if (environment.platform !== "linux") {
      return;
    }
    yield* writeDesktopEntry;
    // Best-effort: the previous slug's hidden entry must not keep claiming
    // the legacy URL scheme after this process has claimed both schemes.
    yield* fileSystem.remove(legacyDesktopEntryPath, { force: true }).pipe(Effect.ignore);
    if (!environment.isPackaged) return;

    yield* Effect.gen(function* () {
      const { png } = yield* assets.iconPaths;
      if (Option.isNone(png)) return;
      yield* fileSystem.makeDirectory(environment.path.dirname(iconPath), { recursive: true });
      yield* fileSystem.copyFile(png.value, iconPath);
    }).pipe(
      Effect.catch((error) =>
        logWarning("URL handler icon copy failed", { iconPath, category: error.reason._tag }),
      ),
    );

    yield* updateDesktopDatabase.pipe(
      // Some MIME implementations, including GIO, use mimeinfo.cache to verify
      // that a desktop entry is associated with a scheme. Cache refresh is
      // independently best-effort so a missing update-desktop-database executable
      // does not prevent xdg-mime from recording the requested defaults.
      Effect.catch((error) =>
        logWarning("desktop MIME cache refresh failed", {
          applicationsDir: environment.linuxApplicationsDir,
          message: error.message,
          ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
        }),
      ),
    );

    yield* setDefaultHandler;
    yield* logInfo("registered URL scheme handler", { schemes });
  }).pipe(
    // Registration is best-effort: a missing xdg-mime or read-only home must
    // never block startup — the OS chooser remains as fallback.
    Effect.catch((error) =>
      logWarning("URL scheme handler registration failed", {
        scheme,
        step: error.step,
        message: error.message,
        ...(error.desktopEntryPath === undefined
          ? {}
          : { desktopEntryPath: error.desktopEntryPath }),
        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
      }),
    ),
    Effect.withSpan("desktop.linuxUrlHandler.register"),
  );

  return DesktopLinuxUrlHandler.of({ register });
});

export const layer = Layer.effect(DesktopLinuxUrlHandler, make);
