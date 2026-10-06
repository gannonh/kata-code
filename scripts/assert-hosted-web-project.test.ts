import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Command } from "effect/cli";

import {
  assertHostedWebProject,
  assertHostedWebProjectCommand,
  deployedVercelProject,
} from "./assert-hosted-web-project.ts";

const runCli = Command.runWith(assertHostedWebProjectCommand, { version: "0.0.0" });

const deployLog = (project: string) => `Vercel CLI 53.1.1
🔍  Inspect: https://vercel.com/astro-labs/${project}/AbC123dEf [2s]
✅  Preview: https://${project}-abc123def-astro-labs.vercel.app [14s]
https://${project}-abc123def-astro-labs.vercel.app
`;

describe("deployedVercelProject", () => {
  it("reads the project segment of the Inspect URL", () => {
    assert.equal(deployedVercelProject(deployLog("katacode-web")), "katacode-web");
    assert.equal(deployedVercelProject(deployLog("kata-code")), "kata-code");
  });

  it("reads it through ANSI styling", () => {
    assert.equal(
      deployedVercelProject(
        "Inspect: \u001b[1mhttps://vercel.com/astro-labs/katacode-web/AbC123dEf\u001b[22m [2s]\n",
      ),
      "katacode-web",
    );
  });

  it("does not take the project from the deployment URL", () => {
    assert.equal(
      deployedVercelProject("https://katacode-web-abc123def-astro-labs.vercel.app\n"),
      null,
    );
  });
});

describe("assertHostedWebProject", () => {
  it.effect("accepts the exact project", () =>
    assertHostedWebProject(deployLog("katacode-web"), "katacode-web"),
  );

  it.effect("rejects a project whose name only starts with the expected one", () =>
    Effect.gen(function* () {
      const error = yield* assertHostedWebProject(
        deployLog("katacode-web-staging"),
        "katacode-web",
      ).pipe(Effect.flip);
      assert.equal(
        error.message,
        "Hosted web deploy went to Vercel project katacode-web-staging, not katacode-web.",
      );
    }),
  );

  it.effect("rejects a project that merely contains the expected name", () =>
    Effect.gen(function* () {
      for (const project of ["old-katacode-web", "katacode-web2", "katacode"]) {
        const error = yield* assertHostedWebProject(deployLog(project), "katacode-web").pipe(
          Effect.flip,
        );
        assert.equal(error.actual, project);
      }
    }),
  );

  it.effect("rejects the repo-named project with the hint to fix VERCEL_PROJECT_ID", () =>
    Effect.gen(function* () {
      const error = yield* assertHostedWebProject(deployLog("kata-code"), "katacode-web").pipe(
        Effect.flip,
      );
      assert.equal(
        error.message,
        "Hosted web deploy went to Vercel project kata-code, not katacode-web. Set VERCEL_PROJECT_ID to the hosted web project, not the repo-named VCR project.",
      );
    }),
  );

  it.effect("rejects a log that never names a project", () =>
    Effect.gen(function* () {
      const error = yield* assertHostedWebProject(
        "https://katacode-web-abc123def-astro-labs.vercel.app\n",
        "katacode-web",
      ).pipe(Effect.flip);
      assert.equal(
        error.message,
        "The Vercel deploy log has no Inspect URL, so the project it deployed to is unknown. Expected katacode-web.",
      );
    }),
  );
});

it.layer(NodeServices.layer)("assert-hosted-web-project cli", (it) => {
  const writeLog = (project: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "assert-hosted-web-project-" });
      const logPath = path.join(dir, "deploy.log");
      yield* fs.writeFileString(logPath, deployLog(project));
      return logPath;
    });

  it.effect("passes for the expected project", () =>
    Effect.gen(function* () {
      const logPath = yield* writeLog("katacode-web");
      yield* runCli(["--log", logPath, "--project", "katacode-web"]);
    }),
  );

  it.effect("fails for a project that only starts with the expected name", () =>
    Effect.gen(function* () {
      const logPath = yield* writeLog("katacode-web-staging");
      const error = yield* runCli(["--log", logPath, "--project", "katacode-web"]).pipe(
        Effect.flip,
      );
      assert.equal(
        String(error.message),
        "Hosted web deploy went to Vercel project katacode-web-staging, not katacode-web.",
      );
    }),
  );
});
