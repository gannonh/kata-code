import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";
import { cloneGitRepoFromTemplate, resetGitRepoTemplateCacheForTests } from "./testGitRepo.ts";

const layer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "test-git-repo-helper-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

describe("testGitRepo template helper", () => {
  it("clones distinct committed repos from a shared template", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        resetGitRepoTemplateCacheForTests();
        const first = yield* cloneGitRepoFromTemplate("test-git-repo-a-");
        const second = yield* cloneGitRepoFromTemplate("test-git-repo-b-");
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.readFileString(`${first.cwd}/README.md`)).toBe("hello\n");
        expect(first.cwd).not.toBe(second.cwd);
        expect(first.initialBranch).toBe("main");
        expect(second.initialBranch).toBe("main");
        const git = yield* GitVcsDriver.GitVcsDriver;
        const log = yield* git.execute({
          operation: "testGitRepo.log",
          cwd: first.cwd,
          args: ["log", "-1", "--pretty=%s"],
          timeoutMs: 10_000,
        });
        expect(log.stdout.trim()).toBe("initial commit");
      }).pipe(Effect.provide(layer), Effect.scoped),
    );
  });
});
