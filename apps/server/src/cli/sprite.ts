import packageJson from "../../package.json" with { type: "json" };
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

const DEFAULT_HOLD_MINUTES = 55;
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

function validateEnvironment(environment: Environment): void {
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new SpriteCliError({ cause: `Invalid environment variable name: ${key}` });
    }
    if (key === "TUNNEL_TRANSPORT_PROTOCOL" || key.startsWith(INTERNAL_ENV_PREFIX)) {
      throw new SpriteCliError({ cause: `Reserved environment variable: ${key}` });
    }
    if (value.includes(",") || value.includes("\n") || value.includes("\r")) {
      throw new SpriteCliError({
        cause: `Environment variable ${key} contains a comma or newline unsupported by Sprite --env.`,
      });
    }
  }
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
npm install --global --prefix "$HOME/.local" "$KATACODE_SPRITE_PACKAGE"
export PATH="$HOME/.local/bin:$PATH"
package_root=$(npm root --global --prefix "$HOME/.local")/@kata-sh/code-cli
node -e 'require(require.resolve("node-pty", { paths: [process.argv[1]] }))' "$package_root"
katacode connect link --headless --base-dir "$HOME/.katacode"

service_env=TUNNEL_TRANSPORT_PROTOCOL=http2
old_ifs=$IFS
IFS=,
for key in $KATACODE_SPRITE_ENV_KEYS; do
  [ -n "$key" ] || continue
  value=$(printenv "$key")
  service_env="$service_env,$key=$value"
done
IFS=$old_ifs

sprite-env services stop katacode >/dev/null 2>&1 || true
sprite-env services delete katacode >/dev/null 2>&1 || true
sprite-env services create katacode \
  --cmd "$HOME/.local/bin/katacode" \
  --args "serve,--host,127.0.0.1,--port,8080,--base-dir,$HOME/.katacode" \
  --env "$service_env" \
  --dir "$HOME" \
  --no-stream
`;

export function makeSetupInvocation(input: {
  readonly target: SpriteTarget;
  readonly environment: Environment;
  readonly packageSpec: string;
}): SpriteInvocation {
  validateEnvironment(input.environment);
  return execInvocation(input.target, ["sh", "-lc", setupScript], {
    tty: true,
    env: {
      KATACODE_SPRITE_PACKAGE: input.packageSpec,
      KATACODE_SPRITE_ENV_KEYS: Object.keys(input.environment).join(","),
      ...input.environment,
    },
  });
}

export function makeWakeInvocation(input: {
  readonly target: SpriteTarget;
  readonly holdMinutes: number;
}): SpriteInvocation {
  if (!Number.isInteger(input.holdMinutes) || input.holdMinutes < 1 || input.holdMinutes > 60) {
    throw new SpriteCliError({ cause: "--hold-minutes must be a whole number from 1 through 60." });
  }
  return execInvocation(input.target, [
    "sprite-env",
    "curl",
    "-X",
    "PUT",
    `/v1/tasks/${TASK_NAME}`,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({ expire: `${input.holdMinutes}m` }),
  ]);
}

export function makeStatusInvocation(target: SpriteTarget): SpriteInvocation {
  return execInvocation(target, [
    "sh",
    "-lc",
    `sprite-env services list
printf '\\nSession hold:\\n'
sprite-env curl /v1/tasks/${TASK_NAME} 2>/dev/null || echo inactive`,
  ]);
}

export function makeReleaseInvocation(target: SpriteTarget): SpriteInvocation {
  return execInvocation(target, [
    "sh",
    "-lc",
    `if sprite-env curl /v1/tasks/${TASK_NAME} >/dev/null 2>&1; then
  sprite-env curl -X DELETE /v1/tasks/${TASK_NAME}
else
  echo inactive
fi`,
  ]);
}

const cloneScript = `
set -eu
destination=\${KATACODE_SPRITE_REPO_DIR:-"$HOME/src/$KATACODE_SPRITE_REPO_NAME"}
run_git() {
  if [ -n "\${GH_TOKEN:-}" ]; then
    auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\\n')
    git -c http.extraHeader="Authorization: Basic $auth" "$@"
  else
    git "$@"
  fi
}
if [ -d "$destination/.git" ]; then
  run_git -C "$destination" pull --ff-only
elif [ -e "$destination" ]; then
  echo "Destination exists and is not a Git repository: $destination" >&2
  exit 1
else
  mkdir -p "$(dirname "$destination")"
  run_git clone "$KATACODE_SPRITE_REPO" "$destination"
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
  if (input.directory !== undefined && !input.directory.startsWith("/")) {
    throw new SpriteCliError({ cause: "--dir must be an absolute path." });
  }
  return execInvocation(input.target, ["sh", "-lc", cloneScript], {
    env: {
      KATACODE_SPRITE_REPO: input.repository,
      KATACODE_SPRITE_REPO_DIR: input.directory ?? "",
      KATACODE_SPRITE_REPO_NAME: repositoryName(input.repository),
      ...input.environment,
    },
  });
}

const runInvocation = Effect.fn("cli.sprite.run")(function* (invocation: SpriteInvocation) {
  const process = yield* ChildProcess.make(invocation.command, invocation.args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = yield* process.exitCode;
  if (exitCode !== 0) {
    return yield* new SpriteCliError({
      cause: `Sprite command failed with exit code ${exitCode}.`,
    });
  }
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
const environmentFlag = Flag.keyValuePair("env").pipe(
  Flag.withDefault({}),
  Flag.withDescription("Environment or secret as KEY=VALUE. Repeat for multiple values."),
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

const setupCommand = Command.make("setup", {
  ...targetFlags,
  env: environmentFlag,
  package: Flag.string("package").pipe(
    Flag.withDefault(`@kata-sh/code-cli@${packageJson.version}`),
    Flag.withDescription("Kata Code package spec to install inside the existing Sprite."),
  ),
}).pipe(
  Command.withDescription(
    "Install or update Kata Code and replace only its service definition. Files and the Sprite remain intact.",
  ),
  Command.withHandler((flags) =>
    runInvocation(
      makeSetupInvocation({
        target: targetFromFlags(flags),
        environment: flags.env,
        packageSpec: flags.package,
      }),
    ),
  ),
);

const wakeCommand = Command.make("wake", {
  ...targetFlags,
  holdMinutes: Flag.integer("hold-minutes").pipe(
    Flag.withDefault(DEFAULT_HOLD_MINUTES),
    Flag.withDescription("Task API hold duration from 1 through 60 minutes."),
  ),
}).pipe(
  Command.withDescription(
    "Wake the Sprite and create or refresh its bounded task hold. Does not create or restore the Connect link.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      yield* runInvocation(
        makeWakeInvocation({
          target: targetFromFlags(flags),
          holdMinutes: flags.holdMinutes,
        }),
      );
      yield* Console.log(
        "Sprite hold active. This does not authorize or restore the Connect link. Run `connect sprite setup` if the environment is not authorized.",
      );
    }),
  ),
);

const statusCommand = Command.make("status", targetFlags).pipe(
  Command.withDescription("Show the Kata Code service and bounded task hold. May wake the Sprite."),
  Command.withHandler((flags) => runInvocation(makeStatusInvocation(targetFromFlags(flags)))),
);

const releaseCommand = Command.make("release", targetFlags).pipe(
  Command.withDescription(
    "Delete only the bounded task hold. Keep the Sprite, files, service, and Connect link.",
  ),
  Command.withHandler((flags) => runInvocation(makeReleaseInvocation(targetFromFlags(flags)))),
);

const cloneCommand = Command.make("clone", {
  ...targetFlags,
  repo: Flag.string("repo").pipe(
    Flag.withDescription("Git repository URL to clone or fast-forward."),
  ),
  dir: Flag.string("dir").pipe(
    Flag.optional,
    Flag.withDescription("Absolute destination path. Defaults to $HOME/src/<repository>."),
  ),
  env: environmentFlag,
}).pipe(
  Command.withDescription(
    "Clone a repository into the Sprite, or fast-forward it when already cloned.",
  ),
  Command.withHandler((flags) =>
    runInvocation(
      makeCloneInvocation({
        target: targetFromFlags(flags),
        repository: flags.repo,
        ...(Option.isSome(flags.dir) ? { directory: flags.dir.value } : {}),
        environment: flags.env,
      }),
    ),
  ),
);

export const spriteConnectCommand = Command.make("sprite").pipe(
  Command.withDescription("Manage Kata Code Connect on an existing Fly Sprite."),
  Command.withSubcommands([setupCommand, wakeCommand, statusCommand, releaseCommand, cloneCommand]),
);
