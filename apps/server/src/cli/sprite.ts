import * as NodeUtil from "node:util";
import packageJson from "../../package.json" with { type: "json" };
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

const BOOTSTRAP_TASK_TTL = "5m";
const TASK_NAME = "kata-session";
const INTERNAL_ENV_PREFIX = "KATACODE_SPRITE_";

type Environment = Readonly<Record<string, string>>;

export interface SpriteTarget {
  readonly sprite: string;
  readonly org?: string;
}

export interface SpriteInvocation {
  readonly command: "sprite";
  readonly args: ReadonlyArray<string>;
}

class SpriteCliError extends CliError.UserError {
  override get message(): string {
    return String(this.cause);
  }
}

function targetArgs(target: SpriteTarget): ReadonlyArray<string> {
  return ["-s", target.sprite, ...(target.org ? ["-o", target.org] : [])];
}

function formatEnvironment(environment: Environment): string {
  return Object.entries(environment)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function assertSpriteEnvValue(label: string, value: string): void {
  if (value.includes(",") || value.includes("\n") || value.includes("\r")) {
    throw new SpriteCliError({
      cause: `${label} contains a comma or newline unsupported by Sprite --env.`,
    });
  }
}

function validateEnvironment(environment: Environment): void {
  for (const key of Object.keys(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new SpriteCliError({ cause: `Invalid environment variable name: ${key}` });
    }
    if (key === "TUNNEL_TRANSPORT_PROTOCOL" || key.startsWith(INTERNAL_ENV_PREFIX)) {
      throw new SpriteCliError({ cause: `Reserved environment variable: ${key}` });
    }
  }
}

function encodeEnvironment(environment: Environment): string {
  return Buffer.from(JSON.stringify(environment)).toString("base64");
}

function execInvocation(
  target: SpriteTarget,
  args: ReadonlyArray<string>,
  options?: { readonly env?: Environment; readonly tty?: boolean },
): SpriteInvocation {
  const environment = options?.env ?? {};
  const env = formatEnvironment(environment);
  return {
    command: "sprite",
    args: [
      ...targetArgs(target),
      "exec",
      ...(options?.tty ? ["--tty"] : []),
      ...(env ? ["--env", env] : []),
      "--",
      ...args,
    ],
  };
}

const setupScript = `
set -eu
npm install --global --prefix "$HOME/.local" \
  --allow-scripts=msgpackr-extract,node-pty \
  "$KATACODE_SPRITE_PACKAGE"
export PATH="$HOME/.local/bin:$PATH"
package_root=$(npm root --global --prefix "$HOME/.local")/@kata-sh/code-cli
node -e 'require(require.resolve("node-pty", { paths: [process.argv[1]] }))' "$package_root"
katacode connect link --headless --base-dir "$HOME/.katacode"

mkdir -p "$HOME/.katacode"
node <<'EOF'
const fs = require("node:fs");
const path = process.env.HOME + "/.katacode/service-env.json";
let environment = {};
if (process.env.KATACODE_SPRITE_ENV_B64) {
  environment = JSON.parse(Buffer.from(process.env.KATACODE_SPRITE_ENV_B64, "base64"));
} else if (fs.existsSync(path)) {
  environment = JSON.parse(fs.readFileSync(path, "utf8"));
}
environment.TUNNEL_TRANSPORT_PROTOCOL = "http2";
fs.writeFileSync(path, JSON.stringify(environment));
EOF
cat > "$HOME/.katacode/service-env.cjs" <<'EOF'
const fs = require("node:fs");
Object.assign(
  process.env,
  JSON.parse(fs.readFileSync(process.env.HOME + "/.katacode/service-env.json", "utf8")),
);
EOF
chmod 600 "$HOME/.katacode/service-env.json" "$HOME/.katacode/service-env.cjs"

sprite-env services stop katacode >/dev/null 2>&1 || true
sprite-env services delete katacode >/dev/null 2>&1 || true
sprite-env services create katacode \
  --cmd "$(command -v node)" \
  --args "--require,$HOME/.katacode/service-env.cjs,$package_root/dist/bin.mjs,serve,--host,127.0.0.1,--port,8080,--base-dir,$HOME/.katacode" \
  --dir "$HOME" \
  --no-stream
`;

export function makeSetupInvocation(input: {
  readonly target: SpriteTarget;
  readonly environment?: Environment;
  readonly packageSpec: string;
}): SpriteInvocation {
  if (input.environment) validateEnvironment(input.environment);
  assertSpriteEnvValue("--package", input.packageSpec);
  return execInvocation(input.target, ["sh", "-lc", setupScript], {
    tty: true,
    env: {
      KATACODE_SPRITE_PACKAGE: input.packageSpec,
      ...(input.environment
        ? { KATACODE_SPRITE_ENV_B64: encodeEnvironment(input.environment) }
        : {}),
    },
  });
}

export function makeWakeInvocation(target: SpriteTarget): SpriteInvocation {
  return execInvocation(target, [
    "sh",
    "-lc",
    `set -eu
sprite-env curl --fail-with-body --silent --show-error \\
  -X PUT /v1/tasks/${TASK_NAME} \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({ expire: BOOTSTRAP_TASK_TTL })}' \\
  >/dev/null
sprite-env services restart katacode >/dev/null`,
  ]);
}

function taskHttpScript(url: string, method = "GET"): string {
  const methodArgs = method === "GET" ? "" : `-X ${method}`;
  return `set -eu
response=$(mktemp)
errors=$(mktemp)
trap 'rm -f "$response" "$errors"' EXIT
sprite-env curl -sS -w '\\n%{http_code}' ${methodArgs} ${url} > "$response" 2> "$errors" || true
code=$(tail -n 1 "$response")
case "$code" in
  404) echo inactive ;;
  2??) sed '$d' "$response" ;;
  *)
    cat "$errors" >&2
    sed '$d' "$response" >&2
    echo "Sprite task request failed\${code:+ (HTTP $code)}." >&2
    exit 1
    ;;
esac`;
}

export function makeStatusInvocation(target: SpriteTarget): SpriteInvocation {
  return execInvocation(target, [
    "sh",
    "-lc",
    `sprite-env services list
printf '\\nActivity task:\\n'
${taskHttpScript(`/v1/tasks/${TASK_NAME}`)}`,
  ]);
}

export function makeReleaseInvocation(target: SpriteTarget): SpriteInvocation {
  return execInvocation(target, [
    "sh",
    "-lc",
    `(${taskHttpScript(`/v1/tasks/${TASK_NAME}`, "DELETE")}) >/dev/null`,
  ]);
}

const cloneScript = `
set -eu
GH_TOKEN=$(node -e '
const fs = require("node:fs");
const path = process.env.HOME + "/.katacode/service-env.json";
const saved = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
const supplied = process.env.KATACODE_SPRITE_ENV_B64
  ? JSON.parse(Buffer.from(process.env.KATACODE_SPRITE_ENV_B64, "base64"))
  : {};
process.stdout.write(supplied.GH_TOKEN ?? saved.GH_TOKEN ?? "");
')
export GH_TOKEN GIT_TERMINAL_PROMPT=0
destination=\${KATACODE_SPRITE_REPO_DIR:-"$HOME/workspaces/$KATACODE_SPRITE_REPO_NAME"}

normalize_git_url() {
  url=$(printf '%s\\n' "$1" | tr '[:upper:]' '[:lower:]')
  url=\${url#"\${url%%[![:space:]]*}"}
  url=\${url%"\${url##*[![:space:]]}"}
  case "$url" in
    *.git) url=\${url%.git} ;;
  esac
  while [ "$url" != "\${url%/}" ]; do
    url=\${url%/}
  done
  case "$url" in
    *://*)
      rest=\${url#*://}
      rest=\${rest%%[?#]*}
      authority=\${rest%%/*}
      path=\${rest#"$authority"}
      path=\${path#/}
      case "$authority" in
        *@*) hostport=\${authority##*@} ;;
        *) hostport=$authority ;;
      esac
      printf '%s/%s\\n' "\${hostport%%:*}" "$path"
      ;;
    *:*)
      left=\${url%%:*}
      path=\${url#*:}
      case "$left" in
        *@*) host=\${left##*@} ;;
        *) host=$left ;;
      esac
      printf '%s/%s\\n' "$host" "$path"
      ;;
    *)
      printf '%s\\n' "$url"
      ;;
  esac
}

is_github_http_url() {
  url=$(printf '%s\\n' "$1" | tr '[:upper:]' '[:lower:]')
  case "$url" in
    http://*|https://*) ;;
    *) return 1 ;;
  esac
  rest=\${url#*://}
  rest=\${rest%%[/?#]*}
  case "$rest" in
    *@*) rest=\${rest##*@} ;;
  esac
  host=\${rest%%:*}
  [ "$host" = github.com ] || [ "\${host%.github.com}" != "$host" ]
}

run_git() {
  target_url=$1
  shift
  if [ -n "\${GH_TOKEN:-}" ] && is_github_http_url "$target_url"; then
    auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\\n')
    git -c http.extraHeader="Authorization: Basic $auth" "$@"
  else
    git "$@"
  fi
}

run_git_or_explain() {
  target_url=$1
  shift
  if run_git "$target_url" "$@"; then
    return
  fi
  if [ -z "\${GH_TOKEN:-}" ] && is_github_http_url "$target_url"; then
    echo "No GH_TOKEN is available for this private GitHub repository. Run Sprite setup with --env PATH, or pass --env PATH to clone." >&2
  fi
  return 1
}

if [ -d "$destination/.git" ]; then
  branch=$(git -C "$destination" symbolic-ref --short HEAD 2>/dev/null || true)
  remote=origin
  if [ -n "$branch" ]; then
    configured=$(git -C "$destination" config --get "branch.\${branch}.remote" || true)
    if [ -n "$configured" ]; then
      remote=$configured
    fi
  fi
  fetch_url=$(git -C "$destination" remote get-url "$remote")
  requested=$(normalize_git_url "$KATACODE_SPRITE_REPO")
  existing=$(normalize_git_url "$fetch_url")
  if [ "$requested" != "$existing" ]; then
    echo "Existing checkout remote '$fetch_url' does not match --repo '$KATACODE_SPRITE_REPO'." >&2
    exit 1
  fi
  run_git_or_explain "$fetch_url" -C "$destination" pull --ff-only --no-recurse-submodules
elif [ -e "$destination" ]; then
  echo "Destination exists and is not a Git repository: $destination" >&2
  exit 1
else
  mkdir -p "$(dirname "$destination")"
  run_git_or_explain "$KATACODE_SPRITE_REPO" clone "$KATACODE_SPRITE_REPO" "$destination"
fi
`;

function repositoryName(repository: string): string {
  const name = repository
    .split(/[/:]/)
    .at(-1)
    ?.replace(/\.git$/, "");
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new SpriteCliError({ cause: "--repo must end in a valid repository name." });
  }
  return name;
}

export function makeCloneInvocation(input: {
  readonly target: SpriteTarget;
  readonly repository: string;
  readonly directory?: string;
  readonly environment: Environment;
}): SpriteInvocation {
  validateEnvironment(input.environment);
  assertSpriteEnvValue("--repo", input.repository);
  if (input.directory !== undefined) {
    if (!input.directory.startsWith("/")) {
      throw new SpriteCliError({ cause: "--dir must be an absolute path." });
    }
    assertSpriteEnvValue("--dir", input.directory);
  }
  return execInvocation(input.target, ["sh", "-lc", cloneScript], {
    env: {
      KATACODE_SPRITE_REPO: input.repository,
      KATACODE_SPRITE_REPO_DIR: input.directory ?? "",
      KATACODE_SPRITE_REPO_NAME: repositoryName(input.repository),
      KATACODE_SPRITE_ENV_B64: encodeEnvironment(input.environment),
    },
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const ensureSpriteExists = Effect.fn("cli.sprite.ensureExists")(function* (target: SpriteTarget) {
  const child = yield* ChildProcess.make("sprite", [...targetArgs(target), "exec", "--", "true"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = yield* Effect.all(
    [
      child.exitCode,
      child.stderr.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (output, chunk) => output + chunk,
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );
  if (exitCode === 0) return true;

  const createCommand = [
    "sprite create --skip-console --sprite",
    shellQuote(target.sprite),
    ...(target.org ? ["--org", shellQuote(target.org)] : []),
  ].join(" ");
  const message = stderr.includes("sprite not found")
    ? `Sprite '${target.sprite}' does not exist.\n\nCreate it, then rerun setup:\n\n  ${createCommand}`
    : stderr.trim() || `Could not access Sprite '${target.sprite}'.`;
  yield* Console.error(message);
  yield* Effect.sync(() => {
    process.exitCode = 1;
  });
  return false;
});

const runInvocation = Effect.fn("cli.sprite.run")(function* (invocation: SpriteInvocation) {
  const child = yield* ChildProcess.make(invocation.command, invocation.args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = yield* child.exitCode;
  if (exitCode === 0) return true;
  yield* Console.error(`Sprite command failed with exit code ${exitCode}.`);
  process.exitCode = 1;
  return false;
});

const spriteFlag = Flag.string("sprite").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Existing Sprite name. This command never creates or destroys a Sprite."),
);
const orgFlag = Flag.string("org").pipe(
  Flag.withAlias("o"),
  Flag.optional,
  Flag.withDescription("Fly organization that owns the Sprite."),
);
const environmentFileFlag = Flag.string("env").pipe(
  Flag.optional,
  Flag.withDescription(
    "Path to a .env file. Setup saves it across wake-ups; clone reuses saved values by default.",
  ),
);
const targetFlags = { sprite: spriteFlag, org: orgFlag };

function targetFromFlags(flags: {
  readonly sprite: string;
  readonly org: Option.Option<string>;
}): SpriteTarget {
  return {
    sprite: flags.sprite,
    ...(Option.isSome(flags.org) ? { org: flags.org.value } : {}),
  };
}

const readEnvironmentFile = Effect.fn("cli.sprite.readEnvironmentFile")(function* (
  path: Option.Option<string>,
) {
  if (Option.isNone(path)) return {};
  const fs = yield* FileSystem.FileSystem;
  const contents = yield* fs
    .readFileString(path.value)
    .pipe(
      Effect.mapError(
        () => new SpriteCliError({ cause: `Could not read environment file: ${path.value}` }),
      ),
    );
  return yield* Effect.try({
    try: () =>
      Object.fromEntries(
        Object.entries(NodeUtil.parseEnv(contents)).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    catch: () => new SpriteCliError({ cause: `Could not parse environment file: ${path.value}` }),
  });
});

const setupCommand = Command.make("setup", {
  ...targetFlags,
  env: environmentFileFlag,
  package: Flag.string("package").pipe(
    Flag.withDefault(`@kata-sh/code-cli@${packageJson.version}`),
    Flag.withDescription("Kata Code package spec to install inside the existing Sprite."),
  ),
}).pipe(
  Command.withDescription(
    "Install or update Kata Code and replace only its service definition. Files and the Sprite remain intact.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const target = targetFromFlags(flags);
      if (!(yield* ensureSpriteExists(target))) return;
      const environment = Option.isSome(flags.env)
        ? yield* readEnvironmentFile(flags.env)
        : undefined;
      yield* runInvocation(
        makeSetupInvocation({
          target,
          ...(environment ? { environment } : {}),
          packageSpec: flags.package,
        }),
      );
    }),
  ),
);

const wakeCommand = Command.make("wake", targetFlags).pipe(
  Command.withDescription(
    "Wake the Sprite, restart Kata Code and its Connect tunnel, and create a five-minute bootstrap task.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (!(yield* runInvocation(makeWakeInvocation(targetFromFlags(flags))))) return;
      yield* Console.log("Sprite awake. Kata Code is coming online....");
    }),
  ),
);

const statusCommand = Command.make("status", targetFlags).pipe(
  Command.withDescription(
    "Show the Kata Code service and automatic activity task. May wake the Sprite.",
  ),
  Command.withHandler((flags) => runInvocation(makeStatusInvocation(targetFromFlags(flags)))),
);

const releaseCommand = Command.make("release", targetFlags).pipe(
  Command.withDescription(
    "Remove the keep-awake task so the Sprite can suspend and take Kata Code offline.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (!(yield* runInvocation(makeReleaseInvocation(targetFromFlags(flags))))) return;
      yield* Console.log("Sprite released. Kata Code server shutting down...");
    }),
  ),
);

const cloneCommand = Command.make("clone", {
  ...targetFlags,
  repo: Flag.string("repo").pipe(
    Flag.withDescription("Git repository URL to clone or fast-forward."),
  ),
  dir: Flag.string("dir").pipe(
    Flag.optional,
    Flag.withDescription("Absolute destination path. Defaults to $HOME/workspaces/<repository>."),
  ),
  env: environmentFileFlag,
}).pipe(
  Command.withDescription(
    "Clone or fast-forward a repository using the environment saved by setup.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const environment = yield* readEnvironmentFile(flags.env);
      yield* runInvocation(
        makeCloneInvocation({
          target: targetFromFlags(flags),
          repository: flags.repo,
          ...(Option.isSome(flags.dir) ? { directory: flags.dir.value } : {}),
          environment,
        }),
      );
    }),
  ),
);

export const spriteConnectCommand = Command.make("sprite").pipe(
  Command.withDescription(
    [
      "Manage Kata Code Connect on an existing Fly Sprite.",
      "",
      "Common flags:",
      "  --sprite, -s NAME    Existing Sprite name; required by every subcommand.",
      "  --org, -o NAME       Fly organization that owns the Sprite.",
      "  --env PATH           Setup saves .env file values across wake-ups; clone reuses them by default.",
      "",
      "Lifecycle:",
      "  wake creates a five-minute bootstrap task. The server refreshes it while a client, agent, or terminal job is active. After 10 idle minutes it removes the task so Fly can suspend the Sprite.",
      "",
      "Examples:",
      "  katacode connect sprite setup -s kata-dev --env .env",
      "  katacode connect sprite wake -s kata-dev",
      "  katacode connect sprite status -s kata-dev",
      "  katacode connect sprite release -s kata-dev",
      "  katacode connect sprite clone -s kata-dev --repo https://github.com/owner/repo.git",
      "",
      "Run `katacode connect sprite <subcommand> --help` for exact flags.",
    ].join("\n"),
  ),
  Command.withSubcommands([setupCommand, wakeCommand, statusCommand, releaseCommand, cloneCommand]),
);
