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

const target = { sprite: "kata-dev", org: "example-org" } as const;
const cliTestLayer = Layer.merge(NodeServices.layer, TestConsole.layer);

it.effect("shows precise lifecycle help", () =>
  Command.runWith(spriteConnectCommand, { version: "0.0.0" })(["--help"]).pipe(
    Effect.provide(cliTestLayer),
    Effect.tap(() =>
      Effect.gen(function* () {
        const output = (yield* TestConsole.logLines).join("\n");
        assert.include(output, "existing Fly Sprite");
        assert.include(output, "setup");
        assert.include(output, "wake");
        assert.include(output, "status");
        assert.include(output, "release");
        assert.include(output, "clone");
      }),
    ),
  ),
);

it.effect("explains setup and release safety in command help", () =>
  Effect.gen(function* () {
    yield* Command.runWith(spriteConnectCommand, { version: "0.0.0" })(["setup", "--help"]);
    yield* Command.runWith(spriteConnectCommand, { version: "0.0.0" })(["release", "--help"]);
    const output = (yield* TestConsole.logLines).join("\n");
    assert.include(output, "replace only its service definition");
    assert.include(output, "Files and the Sprite remain intact");
    assert.include(output, "Delete only the bounded task hold");
    assert.include(output, "Keep the Sprite, files, service, and Connect link");
  }).pipe(Effect.provide(cliTestLayer)),
);

it("builds setup without exposing or recreating the Sprite", () => {
  const invocation = makeSetupInvocation({
    target,
    packageSpec: "@kata-sh/code-cli@nightly",
    environment: { OPENAI_API_KEY: "secret-value" },
  });
  const command = invocation.args.join("\n");

  assert.deepEqual(invocation.args.slice(0, 8), [
    "-s",
    "kata-dev",
    "-o",
    "example-org",
    "exec",
    "--tty",
    "--env",
    "KATACODE_SPRITE_PACKAGE=@kata-sh/code-cli@nightly,KATACODE_SPRITE_ENV_KEYS=OPENAI_API_KEY,OPENAI_API_KEY=secret-value",
  ]);
  assert.include(command, "sprite-env services delete katacode");
  assert.include(command, "TUNNEL_TRANSPORT_PROTOCOL=http2");
  assert.notInclude(command, "sprite create");
  assert.notInclude(command, "sprite destroy");
});

it("builds bounded task operations", () => {
  assert.deepEqual(makeWakeInvocation({ target, holdMinutes: 30 }).args.slice(-9), [
    "sprite-env",
    "curl",
    "-X",
    "PUT",
    "/v1/tasks/kata-session",
    "-H",
    "Content-Type: application/json",
    "-d",
    '{"expire":"30m"}',
  ]);
  assert.include(makeStatusInvocation(target).args.at(-1) ?? "", "/v1/tasks/kata-session");
  const release = makeReleaseInvocation(target).args.at(-1) ?? "";
  assert.include(release, "DELETE /v1/tasks/kata-session");
  assert.include(release, "echo inactive");
  assert.throws(() => makeWakeInvocation({ target, holdMinutes: 61 }), /1 through 60/);
});

it("clones or fast-forwards repositories without persisting a GitHub token in the URL", () => {
  const invocation = makeCloneInvocation({
    target,
    repository: "https://github.com/gannonh/kata-code.git",
    environment: { GH_TOKEN: "secret-value" },
  });
  const command = invocation.args.join("\n");

  assert.include(command, "KATACODE_SPRITE_REPO_NAME=kata-code");
  assert.include(command, "$HOME/src/$KATACODE_SPRITE_REPO_NAME");
  assert.include(command, "pull --ff-only");
  assert.include(command, "http.extraHeader");
  assert.notInclude(command, "x-access-token:secret-value@");
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
});
