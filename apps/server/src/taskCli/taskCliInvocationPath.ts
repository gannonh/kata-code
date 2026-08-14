// @effect-diagnostics nodeBuiltinImport:off -- the PATH shim is written once at process start with node:fs.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { TASK_CLI_EXECUTABLE_ENVIRONMENT_KEY } from "@kata-sh/code-contracts";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);

export interface TaskCliLaunchTarget {
  readonly interpreter: string;
  readonly entry: string;
}

export interface TaskCliInvocationPath {
  readonly executablePath: string;
  readonly pathPrepend: ReadonlyArray<string>;
}

const quote = (value: string): string => JSON.stringify(value);

const isElectronBinary = (execPath: string, env: NodeJS.ProcessEnv): boolean =>
  env.ELECTRON_RUN_AS_NODE === "1" || /electron/i.test(execPath);

export function resolveNodeInterpreter(
  execPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isElectronBinary(execPath, env)) return execPath;
  for (const dir of (env.PATH ?? "").split(NodePath.delimiter)) {
    if (!dir || /Electron\.app/i.test(dir)) continue;
    for (const nodeName of ["node", "node.exe"]) {
      const candidate = NodePath.join(dir, nodeName);
      try {
        if (NodeFs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return execPath;
}

export function resolveTaskCliLaunchTarget(
  env: NodeJS.ProcessEnv = process.env,
  argv: ReadonlyArray<string> = process.argv,
  execPath: string = process.execPath,
): TaskCliLaunchTarget {
  const configured = env[TASK_CLI_EXECUTABLE_ENVIRONMENT_KEY]?.trim();
  const entry = configured || argv[1] || "katacode";
  const resolvedEntry = NodePath.isAbsolute(entry)
    ? entry
    : entry.includes("/") || entry.includes("\\")
      ? NodePath.resolve(entry)
      : entry;
  return {
    interpreter: resolveNodeInterpreter(execPath, env),
    entry: resolvedEntry,
  };
}

export function renderTaskCliShimScript(target: TaskCliLaunchTarget): string {
  const extension = NodePath.extname(target.entry).toLowerCase();
  const isScript = SCRIPT_EXTENSIONS.has(extension);
  if (!isScript && NodePath.basename(target.entry).replace(/\.exe$/iu, "") === "katacode") {
    return `#!/bin/sh\nexec ${quote(target.entry)} "$@"\n`;
  }
  const command = isScript
    ? `exec ${quote(target.interpreter)} ${quote(target.entry)} "$@"`
    : `exec ${quote(target.entry)} "$@"`;
  return `#!/bin/sh\n${command}\n`;
}

export function ensureTaskCliInvocationPath(input?: {
  readonly stateDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: ReadonlyArray<string>;
  readonly execPath?: string;
}): TaskCliInvocationPath {
  const target = resolveTaskCliLaunchTarget(input?.env, input?.argv, input?.execPath);
  const binDir = NodePath.join(
    input?.stateDir ?? NodePath.join(NodeOs.tmpdir(), "katacode-task-cli", String(process.pid)),
    "bin",
  );
  const executablePath = NodePath.join(binDir, "katacode");
  const script = renderTaskCliShimScript(target);
  NodeFs.mkdirSync(binDir, { recursive: true });
  const existing = NodeFs.existsSync(executablePath)
    ? NodeFs.readFileSync(executablePath, "utf8")
    : undefined;
  if (existing !== script) {
    NodeFs.writeFileSync(executablePath, script, { mode: 0o755 });
    NodeFs.chmodSync(executablePath, 0o755);
  }
  return { executablePath, pathPrepend: [binDir] };
}
