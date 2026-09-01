// @effect-diagnostics nodeBuiltinImport:off - exercises the packaged CLI process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { assert, it } from "@effect/vitest";

import { makeReleaseInvocation } from "./sprite.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const cli = NodePath.resolve(import.meta.dirname, "../bin.ts");

it("runs Sprite help and wake through the CLI process", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-cli-test-"));
  const spriteLog = NodePath.join(directory, "sprite-argv");
  const sprite = NodePath.join(directory, "sprite");
  await NodeFSP.writeFile(sprite, '#!/bin/sh\nprintf "%s\\n" "$@" > "$SPRITE_LOG"\n');
  await NodeFSP.chmod(sprite, 0o755);
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    SPRITE_LOG: spriteLog,
    KATACODE_RELAY_URL: "https://relay.example.test",
    KATACODE_CLERK_PUBLISHABLE_KEY: "pk_test_sprite_cli",
    KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "sprite-cli-test",
  };

  const help = await execFile(process.execPath, [cli, "connect", "sprite", "--help"], { env });
  assert.include(help.stdout, "Manage Kata Code Connect on an existing Fly Sprite.");
  assert.include(help.stdout, "--sprite, -s NAME");
  assert.include(help.stdout, "--env PATH");
  assert.include(help.stdout, ".env file");
  assert.include(help.stdout, "After 10 idle minutes");

  const envFile = NodePath.join(directory, ".env");
  await NodeFSP.writeFile(
    envFile,
    'OPENAI_API_KEY="secret value"\nKATACODE_E2E_PI_MODEL_FALLBACKS="one,two"\n',
  );
  const setup = await execFile(
    process.execPath,
    [cli, "connect", "sprite", "setup", "--sprite", "kata-dev", "--env", envFile],
    { env },
  );
  assert.notInclude(setup.stdout, "secret value");
  const setupArgs = await NodeFSP.readFile(spriteLog, "utf8");
  assert.notInclude(setupArgs, "secret value");
  const encodedEnvironment = setupArgs
    .split(/[\n,]/)
    .find((entry) => entry.startsWith("KATACODE_SPRITE_ENV_B64="))
    ?.slice("KATACODE_SPRITE_ENV_B64=".length);
  assert.isDefined(encodedEnvironment);
  assert.deepInclude(JSON.parse(Buffer.from(encodedEnvironment, "base64").toString("utf8")), {
    OPENAI_API_KEY: "secret value",
    KATACODE_E2E_PI_MODEL_FALLBACKS: "one,two",
  });

  const wake = await execFile(
    process.execPath,
    [cli, "connect", "sprite", "wake", "--sprite", "kata-dev"],
    { env },
  );
  assert.include(wake.stdout, "Sprite awake");
  assert.include(wake.stdout, "10 idle minutes");
  assert.deepEqual((await NodeFSP.readFile(spriteLog, "utf8")).trim().split("\n"), [
    "-s",
    "kata-dev",
    "exec",
    "--",
    "sprite-env",
    "curl",
    "--fail-with-body",
    "--silent",
    "--show-error",
    "-X",
    "PUT",
    "/v1/tasks/kata-session",
    "-H",
    "Content-Type: application/json",
    "-d",
    '{"expire":"5m"}',
  ]);
});

it("prints a copyable create command when setup targets a missing Sprite", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-missing-test-"));
  const sprite = NodePath.join(directory, "sprite");
  const envFile = NodePath.join(directory, ".env");
  await NodeFSP.writeFile(
    sprite,
    '#!/bin/sh\necho "Error: failed to start sprite command: sprite not found" >&2\nexit 1\n',
  );
  await NodeFSP.chmod(sprite, 0o755);
  await NodeFSP.writeFile(envFile, "OPENAI_API_KEY=secret\n");
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    KATACODE_RELAY_URL: "https://relay.example.test",
    KATACODE_CLERK_PUBLISHABLE_KEY: "pk_test_sprite_cli",
    KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "sprite-cli-test",
  };

  let failure:
    | { readonly code?: number | string | null; readonly stdout?: string; readonly stderr?: string }
    | undefined;
  try {
    await execFile(
      process.execPath,
      [
        cli,
        "connect",
        "sprite",
        "setup",
        "--sprite",
        "missing-sprite",
        "--org",
        "example-org",
        "--env",
        envFile,
      ],
      { env },
    );
  } catch (cause) {
    failure = cause as typeof failure;
  }

  assert.equal(failure?.code, 1);
  const output = `${failure?.stdout ?? ""}${failure?.stderr ?? ""}`;
  assert.include(output, "Sprite 'missing-sprite' does not exist.");
  assert.include(
    output,
    "sprite create --skip-console --sprite 'missing-sprite' --org 'example-org'",
  );
  assert.notInclude(output, "CliError");
  assert.notInclude(output, "at ensureSpriteExists");
});

it("reports a failed Sprite wake when the child exits non-zero", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-cli-fail-"));
  const sprite = NodePath.join(directory, "sprite");
  await NodeFSP.writeFile(sprite, "#!/bin/sh\nexit 22\n");
  await NodeFSP.chmod(sprite, 0o755);
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    KATACODE_RELAY_URL: "https://relay.example.test",
    KATACODE_CLERK_PUBLISHABLE_KEY: "pk_test_sprite_cli",
    KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "sprite-cli-test",
  };

  try {
    await execFile(process.execPath, [cli, "connect", "sprite", "wake", "--sprite", "kata-dev"], {
      env,
      encoding: "utf8",
    });
    assert.fail("wake should fail when sprite-env curl exits 22");
  } catch (error) {
    const failure = error as {
      code?: number | string | null;
      stdout?: string;
      stderr?: string;
    };
    assert.equal(failure.code, 1);
    assert.include(`${failure.stdout ?? ""}${failure.stderr ?? ""}`, "exit code 22");
  }
});

it("distinguishes an absent Sprite task from release failures", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "sprite-release-test-"));
  const spriteEnv = NodePath.join(directory, "sprite-env");
  await NodeFSP.writeFile(
    spriteEnv,
    '#!/bin/sh\nstatus=${SPRITE_HTTP_STATUS:-204}\n[ "${SPRITE_EXIT_CODE:-0}" != 0 ] && status=${SPRITE_HTTP_STATUS:-000}\nprintf "\\n%s" "$status"\nexit "${SPRITE_EXIT_CODE:-0}"\n',
  );
  await NodeFSP.chmod(spriteEnv, 0o755);
  const script = makeReleaseInvocation({ sprite: "kata-dev" }).args.at(-1);
  assert.isDefined(script);
  const run = (overrides: NodeJS.ProcessEnv) =>
    execFile("sh", ["-c", script], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ...overrides },
    });

  assert.equal((await run({ SPRITE_HTTP_STATUS: "204" })).stdout.trim(), "");
  assert.equal((await run({ SPRITE_HTTP_STATUS: "404" })).stdout.trim(), "inactive");

  for (const overrides of [
    { SPRITE_HTTP_STATUS: "503" },
    { SPRITE_HTTP_STATUS: "", SPRITE_EXIT_CODE: "7" },
  ]) {
    let failure: unknown;
    try {
      await run(overrides);
    } catch (cause) {
      failure = cause;
    }
    assert.isDefined(failure);
  }
});
