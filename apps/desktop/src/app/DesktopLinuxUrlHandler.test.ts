import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLinuxUrlHandler from "./DesktopLinuxUrlHandler.ts";

interface RecordedRegistration {
  readonly directories: string[];
  readonly files: Array<{ readonly path: string; readonly content: string }>;
  readonly removed: string[];
  readonly commands: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }>;
  readonly copies: Array<{ readonly source: string; readonly destination: string }>;
}

const ICON_PATH = "/home/alice/.local/share/icons/katacode-url-handler.desktop.png";

const makeEnvironment = (path: Path.Path, overrides: Record<string, unknown> = {}) =>
  DesktopEnvironment.DesktopEnvironment.of({
    platform: "linux",
    isPackaged: true,
    isDevelopment: false,
    displayName: "Kata Code (Alpha)",
    linuxWmClass: "katacode",
    linuxDesktopEntryName: "t3code.desktop",
    linuxApplicationsDir: "/home/alice/.local/share/applications",
    appImagePath: Option.some("/home/alice/Applications/Kata-Code.AppImage"),
    path,
    ...overrides,
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

const mockProcess = (exitCode: number, stalled = false) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: stalled ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

const makeHandlerLayer = (
  recorded: RecordedRegistration,
  input: {
    readonly environment?: Record<string, unknown>;
    readonly updateDesktopDatabaseExitCode?: number;
    readonly updateDesktopDatabaseStalled?: boolean;
    readonly updateDesktopDatabaseStarted?: Deferred.Deferred<void>;
    readonly xdgMimeExitCode?: number;
    readonly writeError?: PlatformError.PlatformError;
    readonly existingEntry?: string;
    readonly iconSource?: string;
    readonly iconCopyError?: PlatformError.PlatformError;
  } = {},
) =>
  DesktopLinuxUrlHandler.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effect(
          DesktopEnvironment.DesktopEnvironment,
          Path.Path.pipe(
            Effect.map((path) => makeEnvironment(path, input.environment)),
            Effect.provide(Path.layer),
          ),
        ),
        Layer.succeed(DesktopAssets.DesktopAssets, {
          iconPaths: Effect.succeed({
            png: Option.fromUndefinedOr(input.iconSource),
            ico: Option.none(),
            icns: Option.none(),
          }),
          resolveResourcePath: () => Effect.succeedNone,
        }),
        FileSystem.layerNoop({
          copyFile: (source, destination) =>
            input.iconCopyError
              ? Effect.fail(input.iconCopyError)
              : Effect.sync(() => {
                  recorded.copies.push({ source, destination });
                }),
          readFileString: () => Effect.succeed(input.existingEntry ?? ""),
          makeDirectory: (path) =>
            Effect.sync(() => {
              recorded.directories.push(path);
            }),
          writeFileString: (path, content) =>
            input.writeError
              ? Effect.fail(input.writeError)
              : Effect.sync(() => {
                  recorded.files.push({ path, content });
                }),
          remove: (path) =>
            Effect.sync(() => {
              recorded.removed.push(path);
            }),
        }),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((command) => {
            const childProcess = command as unknown as {
              readonly command: string;
              readonly args: ReadonlyArray<string>;
            };
            if (childProcess.command === "update-desktop-database") {
              assert.isTrue(
                recorded.files.length > 0 || input.existingEntry !== undefined,
                "the desktop entry must exist before refreshing the MIME cache",
              );
            }
            recorded.commands.push({
              command: childProcess.command,
              args: childProcess.args,
            });
            const isCacheRefresh = childProcess.command === "update-desktop-database";
            const handle = mockProcess(
              isCacheRefresh
                ? (input.updateDesktopDatabaseExitCode ?? 0)
                : (input.xdgMimeExitCode ?? 0),
              isCacheRefresh && input.updateDesktopDatabaseStalled === true,
            );
            return isCacheRefresh && input.updateDesktopDatabaseStarted
              ? Deferred.succeed(input.updateDesktopDatabaseStarted, undefined).pipe(
                  Effect.as(handle),
                )
              : Effect.succeed(handle);
          }),
        ),
      ),
    ),
  );

const runRegister = (
  recorded: RecordedRegistration,
  input: Parameters<typeof makeHandlerLayer>[1] = {},
) =>
  Effect.gen(function* () {
    const handler = yield* DesktopLinuxUrlHandler.DesktopLinuxUrlHandler;
    yield* handler.register;
  }).pipe(Effect.provide(makeHandlerLayer(recorded, input)));

const emptyRecording = (): RecordedRegistration => ({
  directories: [],
  files: [],
  removed: [],
  commands: [],
  copies: [],
});

describe("DesktopLinuxUrlHandler", () => {
  it("renders a scheme-handler desktop entry with freedesktop Exec quoting", () => {
    const entry = DesktopLinuxUrlHandler.renderUrlHandlerDesktopEntry({
      displayName: "Kata Code (Nightly)",
      execTarget: '/home/al ice/Apps/T3 "100%" $HOME\\x.AppImage',
      schemes: ["katacode", "t3code"],
      iconPath: "/home/al ice/icons/T3\\x.png",
    });

    assert.include(entry, "[Desktop Entry]");
    assert.include(entry, "Name=Kata Code (Nightly)");
    // Exec composes both escaping layers: a literal backslash becomes four
    // backslashes in the file, a quote three characters, a dollar sign two
    // backslashes plus the sign.
    assert.include(
      entry,
      'Exec="/home/al ice/Apps/T3 \\\\"100%%\\\\" \\\\$HOME\\\\\\\\x.AppImage" %U',
    );
    assert.include(entry, "NoDisplay=true");
    assert.notInclude(entry, "StartupWMClass=");
    assert.include(entry, "MimeType=x-scheme-handler/katacode;x-scheme-handler/t3code;");
    assert.include(entry, "Icon=/home/al ice/icons/T3\\\\x.png");
  });

  it("omits Icon when no icon path is given", () => {
    const entry = DesktopLinuxUrlHandler.renderUrlHandlerDesktopEntry({
      displayName: "Kata Code (Dev)",
      execTarget: "/opt/kata/kata",
      schemes: ["katacode-dev"],
    });

    assert.notInclude(entry, "Icon=");
  });

  it("carries structured context on registration errors", () => {
    const writeError = new DesktopLinuxUrlHandler.DesktopLinuxUrlHandlerRegistrationError({
      step: "write-desktop-entry",
      scheme: "katacode",
      desktopEntryPath: "/home/alice/.local/share/applications/katacode-url-handler.desktop",
      cause: new Error("boom"),
    });
    assert.equal(
      writeError.message,
      "Failed to register the katacode:// URL handler (step: write-desktop-entry).",
    );
    assert.equal(
      writeError.desktopEntryPath,
      "/home/alice/.local/share/applications/katacode-url-handler.desktop",
    );

    const exitError = new DesktopLinuxUrlHandler.DesktopLinuxUrlHandlerRegistrationError({
      step: "set-default-handler",
      scheme: "katacode",
      exitCode: 4,
    });
    assert.equal(
      exitError.message,
      "Failed to register the katacode:// URL handler (step: set-default-handler, xdg-mime exit code 4).",
    );
  });

  it.effect(
    "writes the handler entry, refreshes the MIME cache, and claims each scheme default",
    () => {
      const recorded = emptyRecording();

      return Effect.gen(function* () {
        yield* runRegister(recorded);

        assert.deepEqual(recorded.directories, ["/home/alice/.local/share/applications"]);
        assert.equal(recorded.files.length, 1);
        assert.equal(
          recorded.files[0]?.path,
          "/home/alice/.local/share/applications/katacode-url-handler.desktop",
        );
        assert.include(
          recorded.files[0]?.content,
          'Exec="/home/alice/Applications/Kata-Code.AppImage" %U',
        );
        assert.include(recorded.files[0]?.content, `Icon=${ICON_PATH}`);
        assert.include(
          recorded.files[0]?.content,
          "MimeType=x-scheme-handler/katacode;x-scheme-handler/t3code;",
        );
        assert.deepEqual(recorded.removed, [
          "/home/alice/.local/share/applications/t3code-url-handler.desktop",
        ]);
        assert.deepEqual(recorded.commands, [
          {
            command: "update-desktop-database",
            args: ["/home/alice/.local/share/applications"],
          },
          {
            command: "xdg-mime",
            args: ["default", "katacode-url-handler.desktop", "x-scheme-handler/katacode"],
          },
          {
            command: "xdg-mime",
            args: ["default", "katacode-url-handler.desktop", "x-scheme-handler/t3code"],
          },
        ]);
      });
    },
  );

  it.effect("falls back to the process executable outside an AppImage", () => {
    const recorded = emptyRecording();

    return Effect.gen(function* () {
      yield* runRegister(recorded, { environment: { appImagePath: Option.none() } });

      assert.include(
        recorded.files[0]?.content,
        `Exec=${DesktopLinuxUrlHandler.escapeDesktopEntryExecArgument(process.execPath)} %U`,
      );
    });
  });

  it.effect("does not rewrite the pre-ready entry while the portal can be reading it", () => {
    const recorded = emptyRecording();

    return Effect.gen(function* () {
      yield* runRegister(recorded, {
        existingEntry: DesktopLinuxUrlHandler.renderUrlHandlerDesktopEntry({
          displayName: "Kata Code (Alpha)",
          execTarget: "/home/alice/Applications/Kata-Code.AppImage",
          schemes: ["katacode", "t3code"],
          iconPath: ICON_PATH,
        }),
      });

      assert.deepEqual(recorded.files, []);
      assert.deepEqual(recorded.directories, []);
      assert.deepEqual(
        recorded.commands.map(({ command }) => command),
        ["update-desktop-database", "xdg-mime", "xdg-mime"],
      );
    });
  });

  it.effect("installs a persistent icon even when the desktop entry is already current", () => {
    const recorded = emptyRecording();

    return Effect.gen(function* () {
      yield* runRegister(recorded, {
        iconSource: "/tmp/.mount_Kata/resources/icon.png",
        existingEntry: DesktopLinuxUrlHandler.renderUrlHandlerDesktopEntry({
          displayName: "Kata Code (Alpha)",
          execTarget: "/home/alice/Applications/Kata-Code.AppImage",
          schemes: ["katacode", "t3code"],
          iconPath: ICON_PATH,
        }),
      });

      assert.deepEqual(recorded.files, []);
      assert.deepEqual(recorded.directories, ["/home/alice/.local/share/icons"]);
      assert.deepEqual(recorded.copies, [
        { source: "/tmp/.mount_Kata/resources/icon.png", destination: ICON_PATH },
      ]);
      assert.equal(recorded.commands.at(-1)?.command, "xdg-mime");
    });
  });

  it.effect("still registers the handler when copying its icon fails", () => {
    const recorded = emptyRecording();

    return Effect.gen(function* () {
      yield* runRegister(recorded, {
        iconSource: "/tmp/.mount_Kata/resources/icon.png",
        iconCopyError: PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "copyFile",
          description: "read-only icon directory",
        }),
      });

      assert.equal(recorded.files.length, 1);
      assert.deepEqual(
        recorded.commands.map(({ command }) => command),
        ["update-desktop-database", "xdg-mime", "xdg-mime"],
      );
    });
  });

  it.effect("writes the portal identity without an icon or scheme claim in development", () => {
    const nonLinux = emptyRecording();
    const unpackaged = emptyRecording();

    return Effect.gen(function* () {
      yield* runRegister(nonLinux, { environment: { platform: "darwin" } });
      yield* runRegister(unpackaged, {
        iconSource: "/repo/apps/desktop/resources/icon.png",
        environment: {
          isPackaged: false,
          linuxDesktopEntryName: "katacode-dev.desktop",
        },
      });

      assert.deepEqual(nonLinux.files, []);
      assert.equal(
        unpackaged.files[0]?.path,
        "/home/alice/.local/share/applications/katacode-dev.desktop",
      );
      assert.notInclude(unpackaged.files[0]?.content, "Icon=");
      assert.deepEqual(unpackaged.copies, []);
      assert.deepEqual(unpackaged.commands, []);
    });
  });

  it.effect("never fails startup when registration cannot complete", () => {
    const desktopDatabaseFailed = emptyRecording();
    const xdgMimeFailed = emptyRecording();
    const writeFailed = emptyRecording();

    return Effect.gen(function* () {
      yield* runRegister(desktopDatabaseFailed, { updateDesktopDatabaseExitCode: 1 });
      yield* runRegister(xdgMimeFailed, { xdgMimeExitCode: 1 });
      yield* runRegister(writeFailed, {
        writeError: PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "writeFileString",
          description: "read-only filesystem",
          pathOrDescriptor: "/home/alice/.local/share/applications/katacode-url-handler.desktop",
        }),
      });

      assert.deepEqual(
        desktopDatabaseFailed.commands.map(({ command }) => command),
        ["update-desktop-database", "xdg-mime", "xdg-mime"],
      );
      assert.equal(xdgMimeFailed.files.length, 1);
      assert.deepEqual(writeFailed.commands, []);
    });
  });

  it.effect("continues to xdg-mime when the desktop MIME cache refresh stalls", () =>
    Effect.gen(function* () {
      const recorded = emptyRecording();
      const started = yield* Deferred.make<void>();
      const registration = yield* runRegister(recorded, {
        updateDesktopDatabaseStalled: true,
        updateDesktopDatabaseStarted: started,
      }).pipe(Effect.forkChild);

      yield* Deferred.await(started);
      yield* TestClock.adjust("5 seconds");
      yield* Fiber.join(registration);

      assert.deepEqual(
        recorded.commands.map(({ command }) => command),
        ["update-desktop-database", "xdg-mime", "xdg-mime"],
      );
    }),
  );
});
