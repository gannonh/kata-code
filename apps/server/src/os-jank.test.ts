import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import { HostProcessEnvironment, HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";
import { assert, it } from "vite-plus/test";

import { fixPath, hydratePosixHome } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

effectIt.effect("drops the Electron launch flag so child processes start their own runtime", () =>
  Effect.gen(function* () {
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin" };

    yield* fixPath().pipe(
      Effect.provideService(HostProcessEnvironment, env),
      Effect.provideService(HostProcessPlatform, "freebsd"),
    );

    assert.deepEqual(env, { PATH: "/usr/bin" });
  }).pipe(Effect.provide(NodeServices.layer)),
);
