import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stagePiAgentDirectory } from "./piProvider.ts";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("stagePiAgentDirectory", () => {
  it("stages only Pi auth and optional model files for non-Anthropic models", async () => {
    const sourceAgentDir = await createTemporaryDirectory("katacode-pi-source-");
    const katacodeHome = await createTemporaryDirectory("katacode-pi-home-");
    await writeFile(join(sourceAgentDir, "auth.json"), '{"token":"real-auth"}\n');
    await writeFile(join(sourceAgentDir, "models.json"), '{"models":[]}\n');
    await writeFile(join(sourceAgentDir, "settings.json"), "settings");
    await writeFile(join(sourceAgentDir, "session.jsonl"), "session");

    const stagedAgentDir = await stagePiAgentDirectory(
      { katacodeHome },
      sourceAgentDir,
      "openai/gpt-5",
    );

    await expect(readFile(join(stagedAgentDir, "auth.json"), "utf8")).resolves.toBe(
      '{"token":"real-auth"}\n',
    );
    await expect(readFile(join(stagedAgentDir, "models.json"), "utf8")).resolves.toBe(
      '{"models":[]}\n',
    );
    await expect(readdir(stagedAgentDir)).resolves.toEqual(["auth.json", "models.json"]);
  });

  it("omits source models when catalog discovery must supply the model", async () => {
    const sourceAgentDir = await createTemporaryDirectory("katacode-pi-source-");
    const katacodeHome = await createTemporaryDirectory("katacode-pi-home-");
    await writeFile(join(sourceAgentDir, "auth.json"), "auth");
    await writeFile(join(sourceAgentDir, "models.json"), '{"models":["custom/model"]}\n');

    const stagedAgentDir = await stagePiAgentDirectory(
      { katacodeHome },
      sourceAgentDir,
      "openai/gpt-5",
      { includeModels: false },
    );

    await expect(readdir(stagedAgentDir)).resolves.toEqual(["auth.json"]);
  });

  it("writes the Anthropic OAuth package settings without copying source settings", async () => {
    const sourceAgentDir = await createTemporaryDirectory("katacode-pi-source-");
    const katacodeHome = await createTemporaryDirectory("katacode-pi-home-");
    await writeFile(join(sourceAgentDir, "auth.json"), "auth");
    await writeFile(join(sourceAgentDir, "models.json"), '{"models":[]}\n');
    await writeFile(join(sourceAgentDir, "settings.json"), '{"packages":["untrusted-package"]}\n');
    await writeFile(join(sourceAgentDir, "session.jsonl"), "session");

    const stagedAgentDir = await stagePiAgentDirectory(
      { katacodeHome },
      sourceAgentDir,
      "anthropic/claude-sonnet-4-6",
    );

    await expect(readFile(join(stagedAgentDir, "settings.json"), "utf8")).resolves.toBe(
      '{\n  "packages": [\n    "npm:pi-anthropic-oauth"\n  ]\n}\n',
    );
    await expect(readdir(stagedAgentDir)).resolves.toEqual([
      "auth.json",
      "models.json",
      "settings.json",
    ]);
  });

  it("stages auth when the source has no models file", async () => {
    const sourceAgentDir = await createTemporaryDirectory("katacode-pi-source-");
    const katacodeHome = await createTemporaryDirectory("katacode-pi-home-");
    await writeFile(join(sourceAgentDir, "auth.json"), "auth");

    const stagedAgentDir = await stagePiAgentDirectory(
      { katacodeHome },
      sourceAgentDir,
      "openai/gpt-5",
    );

    await expect(readdir(stagedAgentDir)).resolves.toEqual(["auth.json"]);
  });

  it("fails loudly when the required auth file is absent", async () => {
    const sourceAgentDir = await createTemporaryDirectory("katacode-pi-source-");
    const katacodeHome = await createTemporaryDirectory("katacode-pi-home-");

    await expect(
      stagePiAgentDirectory({ katacodeHome }, sourceAgentDir, "openai/gpt-5"),
    ).rejects.toThrow(
      `Pi E2E agent credentials missing required file: ${join(sourceAgentDir, "auth.json")}`,
    );
  });
});
