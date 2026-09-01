// @effect-diagnostics nodeBuiltinImport:off - exercises clone/task shell scripts with PATH stubs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import {
  makeCloneInvocation,
  makeReleaseInvocation,
  makeSetupInvocation,
  makeStatusInvocation,
  makeWakeInvocation,
  spriteConnectCommand,
} from "./sprite.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const target = { sprite: "kata-dev", org: "example-org" } as const;

function invocationExecEnvironment(invocation: { readonly args: ReadonlyArray<string> }) {
  const envIndex = invocation.args.indexOf("--env");
  const encoded = invocation.args[envIndex + 1];
  assert.isDefined(encoded);
  return Object.fromEntries(
    encoded.split(",").map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

function decodeInvocationEnvironment(invocation: { readonly args: ReadonlyArray<string> }) {
  const encoded = invocationExecEnvironment(invocation).KATACODE_SPRITE_ENV_B64;
  assert.isDefined(encoded);
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, string>;
}

const cliTestLayer = Layer.merge(NodeServices.layer, TestConsole.layer);

type ShellResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
};

async function runShell(script: string, env: NodeJS.ProcessEnv): Promise<ShellResult> {
  try {
    const result = await execFile("sh", ["-c", script], { env, encoding: "utf8" });
    return { stdout: result.stdout, stderr: result.stderr, status: 0 };
  } catch (error) {
    const failure = error as {
      code?: number | string | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      status: typeof failure.code === "number" ? failure.code : 1,
    };
  }
}

async function withPathStub(
  fileName: string,
  contents: string,
): Promise<{ directory: string; env: NodeJS.ProcessEnv }> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-stub-"));
  await NodeFSP.writeFile(NodePath.join(directory, fileName), contents, { mode: 0o755 });
  return {
    directory,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
    },
  };
}

const spriteEnvHttpStub = `#!/bin/sh
if [ "$1" = services ]; then
  echo katacode
  exit 0
fi
while [ $# -gt 0 ]; do
  case "$1" in
    -w|--write-out) shift 2 ;;
    -sS|-s|-S|--show-error|--silent) shift ;;
    -X|-H|-d) shift 2 ;;
    curl) shift ;;
    *) shift ;;
  esac
done
code=\${SPRITE_HTTP_CODE:-200}
printf '%s\\n%s' "\${SPRITE_HTTP_BODY:-hold-ok}" "$code"
[ "$code" = 000 ] && exit 7
[ "$code" -ge 400 ] 2>/dev/null && exit 22
exit 0
`;

const recordingGitStub = `#!/bin/sh
printf '%s\\n' "$*" >> "$GIT_LOG"
cmd=""
while [ $# -gt 0 ]; do
  case "$1" in
    -C) shift 2 ;;
    -c) shift 2 ;;
    *) cmd=$1; break ;;
  esac
done
if [ "$cmd" = clone ]; then
  dest=""
  for arg in "$@"; do
    dest=$arg
  done
  mkdir -p "$dest/.git"
fi
exit 0
`;

it.effect("shows precise lifecycle help", () =>
  Command.runWith(spriteConnectCommand, { version: "0.0.0" })(["--help"]).pipe(
    Effect.provide(cliTestLayer),
    Effect.tap(() =>
      Effect.gen(function* () {
        const output = (yield* TestConsole.logLines).join("\n");
        assert.include(output, "existing Fly Sprite");
        assert.include(output, "setup");
        assert.include(output, "--sprite, -s NAME");
        assert.include(output, "--env PATH");
        assert.include(output, ".env file");
        assert.include(output, "wake creates a five-minute bootstrap task");
        assert.include(output, "After 10 idle minutes");
        assert.include(output, "status");
        assert.include(output, "release");
        assert.include(output, "clone");
      }),
    ),
  ),
);

it.effect("explains setup safety in command help", () =>
  Effect.gen(function* () {
    yield* Command.runWith(spriteConnectCommand, { version: "0.0.0" })(["setup", "--help"]);
    const output = (yield* TestConsole.logLines).join("\n");
    assert.include(output, "replace only its service definition");
    assert.include(output, "Files and the Sprite remain intact");
    assert.include(output, "--sprite");
    assert.include(output, "--env");
  }).pipe(Effect.provide(cliTestLayer)),
);

it("builds setup without exposing or recreating the Sprite", () => {
  const invocation = makeSetupInvocation({
    target,
    packageSpec: "@kata-sh/code-cli@nightly",
    environment: { OPENAI_API_KEY: "secret-value" },
  });
  const command = invocation.args.join("\n");

  assert.deepEqual(invocation.args.slice(0, 7), [
    "-s",
    "kata-dev",
    "-o",
    "example-org",
    "exec",
    "--tty",
    "--env",
  ]);
  assert.notInclude(command, "secret-value");
  assert.deepEqual(decodeInvocationEnvironment(invocation), {
    OPENAI_API_KEY: "secret-value",
  });
  assert.include(command, "--allow-scripts=msgpackr-extract,node-pty");
  assert.include(command, "katacode connect link --headless");
  assert.include(command, "sprite-env services delete katacode");
  assert.include(command, "service-env.json");
  assert.include(command, "--require");
  assert.notInclude(command, "sprite create");
  assert.notInclude(command, "sprite destroy");
});

it("installs a service environment containing commas without exposing values", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-setup-"));
  const bin = NodePath.join(directory, "bin");
  await NodeFSP.mkdir(bin);
  const serviceLog = NodePath.join(directory, "services.log");
  const stubs = {
    npm: '#!/bin/sh\n[ "$1" = root ] && printf "%s/.local/lib/node_modules\\n" "$HOME"\nexit 0\n',
    node: `#!/bin/sh\n[ "$1" = -e ] && exit 0\nexec ${process.execPath} "$@"\n`,
    katacode: "#!/bin/sh\nexit 0\n",
    "sprite-env": '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SERVICE_LOG"\nexit 0\n',
  };
  await Promise.all(
    Object.entries(stubs).map(([name, contents]) =>
      NodeFSP.writeFile(NodePath.join(bin, name), contents, { mode: 0o755 }),
    ),
  );
  const invocation = makeSetupInvocation({
    target,
    packageSpec: "@kata-sh/code-cli@nightly",
    environment: { FALLBACKS: "one,two", MULTILINE: "first\nsecond" },
  });
  const result = await runShell(`exec </dev/null\n${String(invocation.args.at(-1))}`, {
    ...process.env,
    ...invocationExecEnvironment(invocation),
    HOME: directory,
    PATH: `${bin}:${process.env.PATH}`,
    SERVICE_LOG: serviceLog,
  });
  assert.equal(result.status, 0, result.stderr);

  const environmentPath = NodePath.join(directory, ".katacode/service-env.json");
  const expectedEnvironment = {
    FALLBACKS: "one,two",
    MULTILINE: "first\nsecond",
    TUNNEL_TRANSPORT_PROTOCOL: "http2",
  };
  assert.deepEqual(
    JSON.parse(await NodeFSP.readFile(environmentPath, "utf8")),
    expectedEnvironment,
  );

  const updateInvocation = makeSetupInvocation({
    target,
    packageSpec: "@kata-sh/code-cli@nightly",
  });
  const updateResult = await runShell(`exec </dev/null\n${String(updateInvocation.args.at(-1))}`, {
    ...process.env,
    ...invocationExecEnvironment(updateInvocation),
    HOME: directory,
    PATH: `${bin}:${process.env.PATH}`,
    SERVICE_LOG: serviceLog,
  });
  assert.equal(updateResult.status, 0, updateResult.stderr);
  assert.deepEqual(
    JSON.parse(await NodeFSP.readFile(environmentPath, "utf8")),
    expectedEnvironment,
  );
  assert.include(await NodeFSP.readFile(serviceLog, "utf8"), "--require");
  const loaded = await execFile(
    process.execPath,
    [
      "--require",
      NodePath.join(directory, ".katacode/service-env.cjs"),
      "-e",
      'process.stdout.write(process.env.FALLBACKS + "|" + process.env.MULTILINE)',
    ],
    { env: { ...process.env, HOME: directory } },
  );
  assert.equal(loaded.stdout, "one,two|first\nsecond");

  const replacementInvocation = makeSetupInvocation({
    target,
    packageSpec: "@kata-sh/code-cli@nightly",
    environment: { REPLACED: "yes" },
  });
  const replacementResult = await runShell(
    `exec </dev/null\n${String(replacementInvocation.args.at(-1))}`,
    {
      ...process.env,
      ...invocationExecEnvironment(replacementInvocation),
      HOME: directory,
      PATH: `${bin}:${process.env.PATH}`,
      SERVICE_LOG: serviceLog,
    },
  );
  assert.equal(replacementResult.status, 0, replacementResult.stderr);
  assert.deepEqual(JSON.parse(await NodeFSP.readFile(environmentPath, "utf8")), {
    REPLACED: "yes",
    TUNNEL_TRANSPORT_PROTOCOL: "http2",
  });
});

it("builds safe task operations", () => {
  const wake = makeWakeInvocation(target).args.join("\n");
  assert.include(wake, "--fail-with-body");
  assert.include(wake, "PUT");
  assert.include(wake, '{"expire":"5m"}');
  assert.include(wake, ">/dev/null");
  assert.include(wake, "services restart katacode");

  const status = makeStatusInvocation(target).args.at(-1) ?? "";
  assert.include(status, "/v1/tasks/kata-session");
  assert.notInclude(status, " -o ");
  assert.include(status, "-w '\\n%{http_code}'");
  assert.include(status, "404) echo inactive");
  assert.notInclude(status, "2>/dev/null || echo inactive");

  const release = makeReleaseInvocation(target).args.at(-1) ?? "";
  assert.include(release, "-w '\\n%{http_code}'");
  assert.include(release, "DELETE /v1/tasks/kata-session");
  assert.include(release, "404) echo inactive");
  assert.include(release, "Sprite task request failed");
});

it("clones or fast-forwards repositories without persisting a GitHub token in the URL", () => {
  const invocation = makeCloneInvocation({
    target,
    repository: "https://github.com/gannonh/kata-code.git",
    environment: { GH_TOKEN: "secret,value\nsecond-line" },
  });
  const command = invocation.args.join("\n");

  assert.include(command, "KATACODE_SPRITE_REPO_NAME=kata-code");
  assert.include(command, "$HOME/workspaces/$KATACODE_SPRITE_REPO_NAME");
  assert.include(command, "pull --ff-only");
  assert.include(command, "http.extraHeader");
  assert.include(command, "is_github_http_url");
  assert.include(command, "does not match --repo");
  assert.notInclude(command, "secret,value");
  assert.equal(decodeInvocationEnvironment(invocation).GH_TOKEN, "secret,value\nsecond-line");
  assert.throws(
    () =>
      makeCloneInvocation({
        target,
        repository: "https://github.com/gannonh/kata-code.git",
        directory: "relative/path",
        environment: {},
      }),
    /absolute path/,
  );
  assert.throws(
    () =>
      makeCloneInvocation({
        target,
        repository: "https://github.com/gan,non/kata-code.git",
        environment: {},
      }),
    /comma or newline/,
  );
  assert.throws(
    () =>
      makeCloneInvocation({
        target,
        repository: "https://github.com/gannonh/kata-code.git",
        directory: "/tmp/foo,bar",
        environment: {},
      }),
    /comma or newline/,
  );
  assert.throws(
    () =>
      makeSetupInvocation({
        target,
        packageSpec: "@kata-sh/code-cli@1.0,nightly",
        environment: {},
      }),
    /comma or newline/,
  );
});

it("maps a missing task to inactive and fails other task HTTP errors", async () => {
  const stub = await withPathStub("sprite-env", spriteEnvHttpStub);
  const wakeScript = String(makeWakeInvocation(target).args.at(-1));
  const statusScript = String(makeStatusInvocation(target).args.at(-1));
  const releaseScript = String(makeReleaseInvocation(target).args.at(-1));

  const failedWake = await runShell(wakeScript, { ...stub.env, SPRITE_HTTP_CODE: "500" });
  assert.notEqual(failedWake.status, 0);

  const missingStatus = await runShell(statusScript, { ...stub.env, SPRITE_HTTP_CODE: "404" });
  assert.equal(missingStatus.status, 0);
  assert.include(missingStatus.stdout, "inactive");

  const failedStatus = await runShell(statusScript, { ...stub.env, SPRITE_HTTP_CODE: "500" });
  assert.notEqual(failedStatus.status, 0);
  assert.notInclude(failedStatus.stdout, "inactive");
  assert.include(`${failedStatus.stdout}${failedStatus.stderr}`, "HTTP 500");

  const missingRelease = await runShell(releaseScript, { ...stub.env, SPRITE_HTTP_CODE: "404" });
  assert.equal(missingRelease.status, 0, missingRelease.stderr);
  assert.equal(missingRelease.stdout, "");

  const failedRelease = await runShell(releaseScript, { ...stub.env, SPRITE_HTTP_CODE: "503" });
  assert.notEqual(failedRelease.status, 0);
  assert.include(`${failedRelease.stdout}${failedRelease.stderr}`, "HTTP 503");
});

it("attaches GH_TOKEN only to github.com HTTP remotes and rejects a mismatched checkout", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-clone-"));
  const dest = NodePath.join(directory, "checkout");
  await execFile("git", ["init", dest]);
  await execFile("git", [
    "-C",
    dest,
    "remote",
    "add",
    "origin",
    "https://evil.example/kata-code.git",
  ]);
  const mismatch = makeCloneInvocation({
    target,
    repository: "https://github.com/gannonh/kata-code.git",
    directory: dest,
    environment: { GH_TOKEN: "secret-value" },
  });
  const mismatchResult = await runShell(String(mismatch.args.at(-1)), {
    ...process.env,
    KATACODE_SPRITE_REPO: "https://github.com/gannonh/kata-code.git",
    KATACODE_SPRITE_REPO_DIR: dest,
    KATACODE_SPRITE_REPO_NAME: "kata-code",
    GH_TOKEN: "secret-value",
    HOME: directory,
  });
  assert.notEqual(mismatchResult.status, 0);
  assert.include(mismatchResult.stderr, "does not match --repo");

  const stub = await withPathStub("git", recordingGitStub);
  const gitLog = NodePath.join(stub.directory, "git.log");
  await NodeFSP.mkdir(NodePath.join(stub.directory, ".katacode"));
  await NodeFSP.writeFile(
    NodePath.join(stub.directory, ".katacode/service-env.json"),
    JSON.stringify({ GH_TOKEN: "saved-token" }),
  );
  const cloneEnv = {
    ...stub.env,
    GIT_LOG: gitLog,
    HOME: stub.directory,
  };

  const githubDest = NodePath.join(stub.directory, "github-repo");
  const github = makeCloneInvocation({
    target,
    repository: "https://github.com/gannonh/kata-code.git",
    directory: githubDest,
    environment: {},
  });
  const githubResult = await runShell(String(github.args.at(-1)), {
    ...cloneEnv,
    ...invocationExecEnvironment(github),
    KATACODE_SPRITE_REPO: "https://github.com/gannonh/kata-code.git",
    KATACODE_SPRITE_REPO_DIR: githubDest,
    KATACODE_SPRITE_REPO_NAME: "kata-code",
  });
  assert.equal(githubResult.status, 0, githubResult.stderr);
  assert.include(await NodeFSP.readFile(gitLog, "utf8"), "http.extraHeader");

  await NodeFSP.writeFile(gitLog, "");
  const lookalikeDest = NodePath.join(stub.directory, "lookalike-repo");
  const lookalike = makeCloneInvocation({
    target,
    repository: "https://github.com.evil.test/gannonh/kata-code.git",
    directory: lookalikeDest,
    environment: {},
  });
  const lookalikeResult = await runShell(String(lookalike.args.at(-1)), {
    ...cloneEnv,
    ...invocationExecEnvironment(lookalike),
    KATACODE_SPRITE_REPO: "https://github.com.evil.test/gannonh/kata-code.git",
    KATACODE_SPRITE_REPO_DIR: lookalikeDest,
    KATACODE_SPRITE_REPO_NAME: "kata-code",
  });
  assert.equal(lookalikeResult.status, 0, lookalikeResult.stderr);
  assert.notInclude(await NodeFSP.readFile(gitLog, "utf8"), "http.extraHeader");
});
