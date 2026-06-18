import { resolveDefaultKatacodeHome, resolveLegacyT3Home } from "@kata-sh/code-shared/branding";
import { HostProcessEnvironment, HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import {
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLoginShell,
  readPathFromLaunchctl,
  resolveWindowsEnvironment,
} from "@kata-sh/code-shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";

function logPathHydrationWarning(message: string, error?: unknown): void {
  process.stderr.write(
    `[server] ${message} ${error instanceof Error ? error.message : (error ?? "")}\n`,
  );
}

function hydratePosixPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  let shellPath: string | undefined;
  for (const shell of listLoginShellCandidates(platform, env.SHELL)) {
    try {
      shellPath = readPathFromLoginShell(shell);
    } catch (error) {
      logPathHydrationWarning(`Failed to read PATH from login shell ${shell}.`, error);
    }

    if (shellPath) break;
  }

  const launchctlPath = platform === "darwin" && !shellPath ? readPathFromLaunchctl() : undefined;
  const mergedPath = mergePathEntries(shellPath ?? launchctlPath, env.PATH, platform);
  if (mergedPath) {
    env.PATH = mergedPath;
  }
}

export const fixPath = Effect.fn("fixPath")(function* (): Effect.fn.Return<
  void,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;

  if (platform === "win32") {
    const repairedEnvironment = yield* resolveWindowsEnvironment(env).pipe(
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
          return {} as Partial<NodeJS.ProcessEnv>;
        }),
      ),
    );
    for (const [key, value] of Object.entries(repairedEnvironment)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return;
  }

  if (platform !== "darwin" && platform !== "linux") return;

  yield* Effect.sync(() => hydratePosixPath(env, platform)).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        logPathHydrationWarning("Failed to hydrate PATH from the user environment.", defect);
      }),
    ),
  );
});

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return NodeOS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(NodeOS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return resolveDefaultKatacodeHome(NodeOS.homedir());
  }
  return resolve(yield* expandHomePath(raw.trim()));
});

export const warnLegacyHomeDirectoryIfNeeded = Effect.fn(function* (input: {
  readonly baseDir: string;
  readonly configuredExplicitly: boolean;
}) {
  if (input.configuredExplicitly) {
    return;
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homeDirectory = NodeOS.homedir();
  const legacyHome = resolveLegacyT3Home(homeDirectory);
  const defaultKatacodeHome = resolveDefaultKatacodeHome(homeDirectory);
  const legacyExists = yield* fs.exists(legacyHome).pipe(Effect.orElseSucceed(() => false));
  const katacodeExists = yield* fs
    .exists(defaultKatacodeHome)
    .pipe(Effect.orElseSucceed(() => false));

  if (
    legacyExists &&
    !katacodeExists &&
    path.resolve(input.baseDir) === path.resolve(defaultKatacodeHome)
  ) {
    yield* Effect.logWarning(
      `Found existing upstream state at ${legacyHome}. Kata Code uses ${defaultKatacodeHome} by default. Set KATACODE_HOME=${legacyHome} to reuse your existing data.`,
    );
  }
});
