// @effect-diagnostics nodeBuiltinImport:off
/**
 * Kata coverage for Cursor plugin skill discovery (Cursor's install record,
 * enabled plugin window) and bare `$skill` invocation. Moved here from the V1
 * `CursorProvider.test.ts` when upstream rewrote that suite for the Cursor SDK.
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { cursorDataDir } from "../acp/CursorInstalledPlugins.ts";
import { cursorSkillInvocation, discoverCursorSkills, probeCursorSkills } from "./CursorSkills.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

// Skill discovery reports realpaths, and macOS puts tmpdir behind the /var -> /private/var link.
const makeSkillFixtureDirectory = Effect.fn("makeSkillFixtureDirectory")(function* (
  prefix: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectory({ directory: NodeOS.tmpdir(), prefix }),
  );
});

describe("Cursor plugin skills", () => {
  it("discovers skills from the enabled Cursor plugin install", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* makeSkillFixtureDirectory("cursor-skills-home-");
        const workspace = yield* makeSkillFixtureDirectory("cursor-skills-workspace-");
        const enabledSha = "84b6c4b36ff9b9d6b18bf784c761691d30acf4c6";
        const staleSha = "970df460f1ae6affbedab6e04f6b396917452431";
        const publicSha = "efa2a531985e0a8084d36ff3cf87233be8a9f34b";
        const cache = path.join(userHome, ".cursor", "plugins", "cache");
        const enabledRoot = path.join(cache, "gannonh-open-pstack", "open-pstack", enabledSha);
        const writeSkill = Effect.fn("writeCursorPluginSkill")(function* (
          directory: string,
          contents: string,
        ) {
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
        });

        yield* fileSystem.makeDirectory(path.join(enabledRoot, ".cursor-plugin"), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(
          path.join(enabledRoot, ".cursor-plugin", "plugin.json"),
          encodeJson({ name: "open-pstack", skills: "./skills/" }),
        );
        yield* fileSystem.writeFileString(path.join(enabledRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(enabledRoot, "skills", "poteto-mode"),
          "---\ndescription: enabled install\n---\n",
        );
        yield* writeSkill(
          path.join(enabledRoot, "skills", "secret"),
          "---\nuser-invocable: false\ndescription: hidden\n---\n",
        );
        yield* writeSkill(
          path.join(enabledRoot, "docs", "not-a-skill"),
          "---\ndescription: outside the manifest skills path\n---\n",
        );

        const staleRoot = path.join(cache, "gannonh-open-pstack", "61242178", staleSha);
        yield* fileSystem.makeDirectory(staleRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(staleRoot, ".cache-complete"), "");
        yield* fileSystem.writeFileString(
          path.join(cache, "gannonh-open-pstack", "61242178", `${staleSha}.installed`),
          "stale",
        );
        yield* writeSkill(
          path.join(staleRoot, "skills", "poteto-mode"),
          "---\ndescription: stale install\n---\n",
        );
        yield* writeSkill(
          path.join(staleRoot, "skills", "stale-only"),
          "---\ndescription: stale only\n---\n",
        );

        const publicRoot = path.join(cache, "cursor-public", "pstack", publicSha);
        yield* fileSystem.makeDirectory(publicRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(publicRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(publicRoot, "skills", "poteto-mode"),
          "---\ndescription: public copy\n---\n",
        );
        yield* writeSkill(
          path.join(publicRoot, "skills", "public-only"),
          "---\ndescription: public only\n---\n",
        );

        yield* writeSkill(
          path.join(
            userHome,
            ".cursor",
            "plugins",
            "marketplaces",
            "gannonh-open-pstack",
            "skills",
            "checkout-only",
          ),
          "---\ndescription: marketplace checkout\n---\n",
        );

        const thermos = path.join(userHome, ".cursor", "plugins", "local", "thermos");
        yield* writeSkill(
          path.join(thermos, "skills", "boil"),
          "---\ndescription: local plugin\n---\n",
        );
        yield* fileSystem.writeFileString(
          path.join(userHome, ".cursor", "settings.json"),
          encodeJson({ enabled_plugins: { thermos } }),
        );
        yield* fileSystem.writeFileString(
          path.join(cache, ".cloud-plugin-manifest.json"),
          encodeJson({
            plugins: [
              {
                pluginId: "61242178",
                name: "open-pstack",
                marketplaceSlug: "gannonh-open-pstack",
                resolvedCommitSha: staleSha,
              },
            ],
          }),
        );

        const stateDb = path.join(
          userHome,
          ".config",
          "Cursor",
          "User",
          "globalStorage",
          "state.vscdb",
        );
        yield* fileSystem.makeDirectory(path.dirname(stateDb), { recursive: true });
        const database = new NodeSqlite.DatabaseSync(stateDb);
        database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
        database
          .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
          .run(
            `cursor.plugins.installedIds.no-team|${NodeURL.pathToFileURL(workspace).href}`,
            encodeJson(["67972749"]),
          );
        database.close();

        const environment = { HOME: userHome };
        const skills = yield* discoverCursorSkills(workspace, environment);
        expect(skills.map((skill) => skill.name)).toEqual(["boil", "poteto-mode", "secret"]);
        expect(skills).toContainEqual({
          name: "poteto-mode",
          description: "enabled install",
          path: path.join(enabledRoot, "skills", "poteto-mode", "SKILL.md"),
          scope: "user",
          enabled: true,
        });
        expect(skills).toContainEqual({
          name: "secret",
          description: "hidden",
          path: path.join(enabledRoot, "skills", "secret", "SKILL.md"),
          scope: "user",
          enabled: true,
          userInvocable: false,
        });
        expect(skills).toContainEqual({
          name: "boil",
          description: "local plugin",
          path: path.join(thermos, "skills", "boil", "SKILL.md"),
          scope: "user",
          enabled: true,
        });

        yield* writeSkill(
          path.join(workspace, ".cursor", "skills", "poteto-mode"),
          "---\ndescription: project copy\n---\n",
        );
        const withProject = yield* discoverCursorSkills(workspace, environment);
        expect(withProject.find((skill) => skill.name === "poteto-mode")).toEqual({
          name: "poteto-mode",
          description: "project copy",
          path: path.join(workspace, ".cursor", "skills", "poteto-mode", "SKILL.md"),
          scope: "project",
          enabled: true,
        });
      }),
    ));

  it("uses the manifest commit under the plugin id when that id is enabled", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* makeSkillFixtureDirectory("cursor-skills-home-");
        const workspace = yield* makeSkillFixtureDirectory("cursor-skills-workspace-");
        const enabledSha = "84b6c4b36ff9b9d6b18bf784c761691d30acf4c6";
        const staleSha = "970df460f1ae6affbedab6e04f6b396917452431";
        const cache = path.join(userHome, ".cursor", "plugins", "cache");
        const enabledRoot = path.join(cache, "gannonh-open-pstack", "67972749", enabledSha);
        const staleRoot = path.join(cache, "gannonh-open-pstack", "61242178", staleSha);
        const writeSkill = Effect.fn("writeCursorPluginSkill")(function* (
          directory: string,
          contents: string,
        ) {
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
        });
        yield* fileSystem.makeDirectory(enabledRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(enabledRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(enabledRoot, "skills", "poteto-mode"),
          "---\ndescription: current id install\n---\n",
        );
        yield* fileSystem.makeDirectory(staleRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(staleRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(staleRoot, "skills", "poteto-mode"),
          "---\ndescription: old id install\n---\n",
        );
        yield* fileSystem.writeFileString(
          path.join(cache, ".cloud-plugin-manifest.json"),
          encodeJson({
            plugins: [
              {
                pluginId: "67972749",
                name: "open-pstack",
                marketplaceSlug: "gannonh-open-pstack",
                resolvedCommitSha: enabledSha,
              },
            ],
          }),
        );

        const skills = yield* discoverCursorSkills(workspace, { HOME: userHome });
        expect(skills).toEqual([
          {
            name: "poteto-mode",
            description: "current id install",
            path: path.join(enabledRoot, "skills", "poteto-mode", "SKILL.md"),
            scope: "user",
            enabled: true,
          },
        ]);
      }),
    ));

  it("reports a filesystem error when Cursor's install database is unreadable", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* makeSkillFixtureDirectory("cursor-skills-home-");
        const stateDb = path.join(userHome, "state.vscdb");
        yield* fileSystem.writeFileString(stateDb, "not a sqlite database");

        const result = yield* probeCursorSkills(userHome, {
          HOME: userHome,
          CURSOR_GLOBAL_STATE_DB: stateDb,
        }).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure.reason).toBe("filesystem-error");
      }),
    ));

  it("reads installed plugin ids from XDG_CONFIG_HOME", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* makeSkillFixtureDirectory("cursor-skills-home-");
        const configHome = yield* makeSkillFixtureDirectory("cursor-skills-xdg-");
        const workspace = yield* makeSkillFixtureDirectory("cursor-skills-workspace-");
        const enabledSha = "84b6c4b36ff9b9d6b18bf784c761691d30acf4c6";
        const staleSha = "970df460f1ae6affbedab6e04f6b396917452431";
        const cache = path.join(userHome, ".cursor", "plugins", "cache");
        const enabledRoot = path.join(cache, "gannonh-open-pstack", "67972749", enabledSha);
        const staleRoot = path.join(cache, "gannonh-open-pstack", "61242178", staleSha);
        const writeSkill = Effect.fn("writeCursorPluginSkill")(function* (
          directory: string,
          contents: string,
        ) {
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
        });
        const writeInstalledIds = (dbPath: string, ids: ReadonlyArray<string>) =>
          Effect.sync(() => {
            const database = new NodeSqlite.DatabaseSync(dbPath);
            database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
            database
              .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
              .run(
                `cursor.plugins.installedIds.no-team|${NodeURL.pathToFileURL(workspace).href}`,
                encodeJson(ids),
              );
            database.close();
          });
        yield* fileSystem.makeDirectory(enabledRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(enabledRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(enabledRoot, "skills", "poteto-mode"),
          "---\ndescription: xdg install\n---\n",
        );
        yield* fileSystem.makeDirectory(staleRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(staleRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(staleRoot, "skills", "poteto-mode"),
          "---\ndescription: home config install\n---\n",
        );
        yield* fileSystem.writeFileString(
          path.join(cache, ".cloud-plugin-manifest.json"),
          encodeJson({
            plugins: [
              {
                pluginId: "67972749",
                name: "open-pstack",
                marketplaceSlug: "gannonh-open-pstack",
                resolvedCommitSha: enabledSha,
              },
              {
                pluginId: "61242178",
                name: "open-pstack",
                marketplaceSlug: "gannonh-open-pstack",
                resolvedCommitSha: staleSha,
              },
            ],
          }),
        );
        const homeDb = path.join(
          userHome,
          ".config",
          "Cursor",
          "User",
          "globalStorage",
          "state.vscdb",
        );
        const xdgDb = path.join(configHome, "Cursor", "User", "globalStorage", "state.vscdb");
        yield* fileSystem.makeDirectory(path.dirname(homeDb), { recursive: true });
        yield* fileSystem.makeDirectory(path.dirname(xdgDb), { recursive: true });
        yield* writeInstalledIds(homeDb, ["61242178"]);
        yield* writeInstalledIds(xdgDb, ["67972749"]);

        const skills = yield* discoverCursorSkills(workspace, {
          HOME: userHome,
          XDG_CONFIG_HOME: configHome,
        });
        expect(skills).toEqual([
          {
            name: "poteto-mode",
            description: "xdg install",
            path: path.join(enabledRoot, "skills", "poteto-mode", "SKILL.md"),
            scope: "user",
            enabled: true,
          },
        ]);
      }),
    ));

  it("uses the cwd window's object plugin ids and ignores a stale window", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* makeSkillFixtureDirectory("cursor-skills-home-");
        const workspace = yield* makeSkillFixtureDirectory("cursor-skills-workspace-");
        const other = yield* makeSkillFixtureDirectory("cursor-skills-other-");
        const absent = yield* makeSkillFixtureDirectory("cursor-skills-absent-");
        const enabledSha = "84b6c4b36ff9b9d6b18bf784c761691d30acf4c6";
        const staleSha = "970df460f1ae6affbedab6e04f6b396917452431";
        const cache = path.join(userHome, ".cursor", "plugins", "cache");
        const enabledRoot = path.join(cache, "gannonh-open-pstack", "open-pstack", enabledSha);
        const staleRoot = path.join(cache, "gannonh-open-pstack", "61242178", staleSha);
        const writeSkill = Effect.fn("writeCursorPluginSkill")(function* (
          directory: string,
          contents: string,
        ) {
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
        });
        const installed = (id: string) => encodeJson([{ id, sources: ["user"] }]);
        yield* fileSystem.makeDirectory(enabledRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(enabledRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(enabledRoot, "skills", "poteto-mode"),
          "---\ndescription: enabled install\n---\n",
        );
        yield* fileSystem.makeDirectory(staleRoot, { recursive: true });
        yield* fileSystem.writeFileString(path.join(staleRoot, ".cache-complete"), "");
        yield* writeSkill(
          path.join(staleRoot, "skills", "stale-only"),
          "---\ndescription: stale install\n---\n",
        );
        yield* fileSystem.writeFileString(path.join(cache, ".DS_Store"), "");
        yield* fileSystem.writeFileString(path.join(cache, "notes.txt"), "not a marketplace");
        yield* fileSystem.writeFileString(
          path.join(cache, ".cloud-plugin-manifest.json"),
          encodeJson({
            plugins: [
              {
                pluginId: "61242178",
                name: "open-pstack",
                marketplaceSlug: "gannonh-open-pstack",
                resolvedCommitSha: staleSha,
              },
            ],
          }),
        );
        const stateDb = path.join(
          userHome,
          ".config",
          "Cursor",
          "User",
          "globalStorage",
          "state.vscdb",
        );
        const workspaceUrl = NodeURL.pathToFileURL(workspace).href;
        const otherUrl = NodeURL.pathToFileURL(other).href;
        const workspaceKey = `cursor.plugins.installedIds.no-team|${workspaceUrl}`;
        const staleWindowKey = `cursor.plugins.installedIds.no-team|${otherUrl}`;
        const multiRootKey = `cursor.plugins.installedIds.no-team|${workspaceUrl},${otherUrl}`;
        yield* fileSystem.makeDirectory(path.dirname(stateDb), { recursive: true });
        yield* Effect.sync(() => {
          const database = new NodeSqlite.DatabaseSync(stateDb);
          database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
          const insert = database.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
          insert.run(workspaceKey, installed("67972749"));
          insert.run(staleWindowKey, installed("61242178"));
          insert.run(multiRootKey, installed("61242178"));
          insert.run("cursor.plugins.installedIds.no-team", installed("61242178"));
          insert.run("cursor.plugins.installedIds.no-team|no-workspace", installed("61242178"));
          database.close();
        });

        const environment = { HOME: userHome };
        expect((yield* probeCursorSkills(workspace, environment).pipe(Effect.result))._tag).toBe(
          "Success",
        );
        const skills = yield* discoverCursorSkills(workspace, environment);
        expect(skills).toEqual([
          {
            name: "poteto-mode",
            description: "enabled install",
            path: path.join(enabledRoot, "skills", "poteto-mode", "SKILL.md"),
            scope: "user",
            enabled: true,
          },
        ]);

        const fallback = yield* discoverCursorSkills(absent, environment);
        expect(fallback).toEqual([
          {
            name: "stale-only",
            description: "stale install",
            path: path.join(staleRoot, "skills", "stale-only", "SKILL.md"),
            scope: "user",
            enabled: true,
          },
        ]);
      }),
    ));

  it("turns a chosen skill mention into Cursor's bare slash command", () => {
    expect(cursorSkillInvocation("$poteto-mode", new Set(["poteto-mode"]))).toBe("/poteto-mode");
    expect(cursorSkillInvocation("$poteto-mode ", new Set(["poteto-mode"]))).toBe("/poteto-mode");
    expect(cursorSkillInvocation("please $poteto-mode this", new Set(["poteto-mode"]))).toBe(
      undefined,
    );
    expect(cursorSkillInvocation("$poteto-mode", new Set())).toBe(undefined);
  });

  it("reads Cursor's data dir from CURSOR_DATA_DIR, then the home from the environment", () => {
    expect(cursorDataDir({ CURSOR_DATA_DIR: "/tmp/cursor-data" }, "/home/dev")).toBe(
      "/tmp/cursor-data",
    );
    expect(cursorDataDir({}, "/home/dev")).toBe(NodePath.join("/home/dev", ".cursor"));
    expect(cursorDataDir({ HOME: "/home/instance" })).toBe(
      NodePath.join("/home/instance", ".cursor"),
    );
    expect(cursorDataDir({ USERPROFILE: "/Users/instance" })).toBe(
      NodePath.join("/Users/instance", ".cursor"),
    );
  });
});
