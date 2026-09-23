// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";

import { cursorDataDir } from "./CursorInstalledPlugins.ts";
import {
  cursorWorkspaceSlug,
  discoverCursorPluginMcpServers,
  type CursorPluginMcpDiscoveryOptions,
  type CursorPluginMcpFetch,
} from "./CursorPluginMcp.ts";

const CWD = "/Volumes/EVO/dev/open-pstack";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

function writeFile(filePath: string, contents: string): void {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  NodeFS.writeFileSync(filePath, contents);
}

function discover(cwd: string, options: CursorPluginMcpDiscoveryOptions) {
  return discoverCursorPluginMcpServers(cwd, options).pipe(Effect.provide(NodeServices.layer));
}

interface CursorFixture {
  readonly dataDir: string;
  readonly projectDir: string;
  readonly env: NodeJS.ProcessEnv;
}

/** A Cursor data dir whose `state.vscdb` installs `installedIds` for `CWD`. */
function makeCursorFixture(prefix: string, installedIds: ReadonlyArray<string>): CursorFixture {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  const dataDir = NodePath.join(root, "cursor");
  const stateDb = NodePath.join(root, "state.vscdb");
  const database = new NodeSqlite.DatabaseSync(stateDb);
  database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  database
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run(
      `cursor.plugins.installedIds.no-team|${NodeURL.pathToFileURL(CWD).href}`,
      encodeJson(installedIds.map((id) => ({ id, sources: ["user"] }))),
    );
  database.close();
  return {
    dataDir,
    projectDir: NodePath.join(dataDir, "projects", cursorWorkspaceSlug(CWD)),
    env: { HOME: root, CURSOR_DATA_DIR: dataDir, CURSOR_GLOBAL_STATE_DB: stateDb },
  };
}

/** Writes a complete plugin cache version, keyed by id as Cursor does unless `folder` is set. */
function installCachedPlugin(
  dataDir: string,
  plugin: {
    readonly id: string;
    readonly name: string;
    readonly mcpServers: unknown;
    readonly marketplace?: string;
    readonly folder?: string;
    readonly sha?: string;
  },
): string {
  const root = NodePath.join(
    dataDir,
    "plugins/cache",
    plugin.marketplace ?? "cursor-public",
    plugin.folder ?? plugin.id,
    plugin.sha ?? "sha1",
  );
  writeFile(
    NodePath.join(root, ".cursor-plugin", "plugin.json"),
    encodeJson({ name: plugin.name }),
  );
  writeFile(NodePath.join(root, "mcp.json"), encodeJson({ mcpServers: plugin.mcpServers }));
  writeFile(NodePath.join(root, ".cache-complete"), "");
  return root;
}

function writeCloudManifest(
  dataDir: string,
  plugins: ReadonlyArray<{
    readonly pluginId: string;
    readonly name: string;
    readonly marketplaceSlug: string;
    readonly resolvedCommitSha: string;
  }>,
): void {
  writeFile(
    NodePath.join(dataDir, "plugins/cache/.cloud-plugin-manifest.json"),
    encodeJson({ plugins }),
  );
}

describe("cursorWorkspaceSlug", () => {
  it("matches Cursor's project directory slugger", () => {
    expect(cursorWorkspaceSlug("/Volumes/EVO/dev/open-pstack")).toBe("Volumes-EVO-dev-open-pstack");
    expect(cursorWorkspaceSlug("/home/gannonh/.katacode/worktrees/kata-code")).toBe(
      "home-gannonh-katacode-worktrees-kata-code",
    );
  });
});

describe("discoverCursorPluginMcpServers", () => {
  effectIt.effect(
    "forwards installed plugins from Cursor's install record when the project mcps cache omits them",
    () =>
      Effect.gen(function* () {
        const fixture = makeCursorFixture("cursor-plugin-mcp-", ["512", "48677658", "900"]);
        writeFile(
          NodePath.join(fixture.projectDir, "mcps", "cursor-ide-browser", "SERVER_METADATA.json"),
          encodeJson({ serverIdentifier: "cursor-ide-browser" }),
        );
        writeFile(
          NodePath.join(fixture.projectDir, "mcp-auth.json"),
          encodeJson({
            "plugin-linear-linear": { tokens: { access_token: "fake-linear-token" } },
            "plugin-stdio-stdio": { tokens: { access_token: "fake-stdio-token" } },
          }),
        );
        installCachedPlugin(fixture.dataDir, {
          id: "512",
          name: "linear",
          mcpServers: { linear: { type: "streamable-http", url: "https://mcp.linear.app/mcp" } },
        });
        installCachedPlugin(fixture.dataDir, {
          id: "48677658",
          name: "github",
          mcpServers: {
            github: {
              type: "http",
              url: "https://api.githubcopilot.com/mcp/",
              headers: {
                Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}",
                "X-Static": "plain",
              },
            },
          },
        });
        const stdioRoot = installCachedPlugin(fixture.dataDir, {
          id: "900",
          name: "stdio",
          mcpServers: {
            stdio: {
              command: "${CURSOR_PLUGIN_ROOT}/bin/server",
              args: ["--stdio", "--root=${CURSOR_PLUGIN_ROOT}"],
              env: {
                TOKEN: "${SECRET_TOKEN}",
                MODE: "read",
                DATA: "${CLAUDE_PLUGIN_ROOT}/data",
              },
            },
          },
        });
        installCachedPlugin(fixture.dataDir, {
          id: "777",
          name: "uninstalled",
          mcpServers: { uninstalled: { type: "http", url: "https://example.invalid/not-used" } },
        });

        const discovery = yield* discover(CWD, {
          env: { ...fixture.env, GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test", SECRET_TOKEN: "s3cret" },
        });
        const { servers } = discovery;
        expect(servers.map((server) => server.name).sort()).toEqual([
          "plugin-github-github",
          "plugin-linear-linear",
          "plugin-stdio-stdio",
        ]);
        expect(servers).toContainEqual({
          type: "http",
          name: "plugin-linear-linear",
          url: "https://mcp.linear.app/mcp",
          headers: [{ name: "Authorization", value: "Bearer fake-linear-token" }],
        });
        expect(servers).toContainEqual({
          type: "http",
          name: "plugin-github-github",
          url: "https://api.githubcopilot.com/mcp/",
          headers: [
            { name: "Authorization", value: "Bearer ghp_test" },
            { name: "X-Static", value: "plain" },
          ],
        });
        const stdio = servers.find((server) => server.name === "plugin-stdio-stdio");
        expect(stdio).toMatchObject({
          name: "plugin-stdio-stdio",
          args: ["--stdio", `--root=${stdioRoot}`],
          env: [
            { name: "TOKEN", value: "s3cret" },
            { name: "MODE", value: "read" },
            { name: "DATA", value: `${stdioRoot}/data` },
          ],
        });
        if (stdio && "command" in stdio) {
          expect(stdio.command).toBe(`${stdioRoot}/bin/server`);
        }
        expect(discovery.authRequired).toEqual([]);
      }),
  );

  effectIt.effect("adds stored OAuth and replaces unusable configured Authorization", () =>
    Effect.gen(function* () {
      const fixture = makeCursorFixture("cursor-plugin-mcp-auth-", ["512"]);
      writeFile(
        NodePath.join(fixture.projectDir, "mcp-auth.json"),
        encodeJson({
          "plugin-linear-events": { tokens: { access_token: "fake-events-token" } },
          "plugin-linear-configured": { tokens: { access_token: "fake-stored-token" } },
          "plugin-linear-empty": { tokens: { access_token: "fake-empty-token" } },
          "plugin-linear-whitespace": { tokens: { access_token: "fake-whitespace-token" } },
        }),
      );
      installCachedPlugin(fixture.dataDir, {
        id: "512",
        name: "linear",
        mcpServers: {
          events: { type: "sse", url: "https://mcp.linear.app/events" },
          configured: {
            type: "http",
            url: "https://mcp.linear.app/configured",
            headers: { authorization: "Bearer ${EMPTY_TOKEN}" },
          },
          empty: {
            type: "http",
            url: "https://mcp.linear.app/empty",
            headers: { Authorization: "" },
          },
          whitespace: {
            type: "sse",
            url: "https://mcp.linear.app/whitespace",
            headers: { Authorization: " \t " },
          },
        },
      });

      expect(yield* discover(CWD, { env: { ...fixture.env, EMPTY_TOKEN: "" } })).toEqual({
        servers: [
          {
            type: "sse",
            name: "plugin-linear-events",
            url: "https://mcp.linear.app/events",
            headers: [{ name: "Authorization", value: "Bearer fake-events-token" }],
          },
          {
            type: "http",
            name: "plugin-linear-configured",
            url: "https://mcp.linear.app/configured",
            headers: [{ name: "Authorization", value: "Bearer fake-stored-token" }],
          },
          {
            type: "http",
            name: "plugin-linear-empty",
            url: "https://mcp.linear.app/empty",
            headers: [{ name: "Authorization", value: "Bearer fake-empty-token" }],
          },
          {
            type: "sse",
            name: "plugin-linear-whitespace",
            url: "https://mcp.linear.app/whitespace",
            headers: [{ name: "Authorization", value: "Bearer fake-whitespace-token" }],
          },
        ],
        authRequired: [],
      });
    }),
  );

  effectIt.effect("marks a stored OAuth token auth-required when the MCP server rejects it", () =>
    Effect.gen(function* () {
      const fixture = makeCursorFixture("cursor-plugin-mcp-rejected-", ["512"]);
      writeFile(
        NodePath.join(fixture.projectDir, "mcp-auth.json"),
        encodeJson({
          "plugin-linear-linear": { tokens: { access_token: "rejected-token" } },
        }),
      );
      installCachedPlugin(fixture.dataDir, {
        id: "512",
        name: "linear",
        mcpServers: { linear: { type: "streamable-http", url: "https://mcp.linear.app/mcp" } },
      });

      const requests: Array<{ url: string; init: RequestInit }> = [];
      const fetchFn: CursorPluginMcpFetch = async (input, init) => {
        requests.push({ url: String(input), init: init ?? {} });
        return new Response(null, { status: 401 });
      };
      const discovery = yield* discover(CWD, { env: fixture.env, fetch: fetchFn });

      expect(discovery.authRequired).toEqual([
        { identifier: "plugin-linear-linear", displayName: "linear" },
      ]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://mcp.linear.app/mcp");
      expect(requests[0]?.init.method).toBe("POST");
      expect(new Headers(requests[0]?.init.headers).get("authorization")).toBe(
        "Bearer rejected-token",
      );
      expect(decodeJson(String(requests[0]?.init.body))).toMatchObject({
        jsonrpc: "2.0",
        method: "initialize",
      });
    }),
  );

  effectIt.effect(
    "marks OAuth plugins auth-required when a missing or malformed token is rejected, but not env-credential plugins",
    () =>
      Effect.gen(function* () {
        const fixture = makeCursorFixture("cursor-plugin-mcp-invalid-auth-", ["512", "600", "700"]);
        installCachedPlugin(fixture.dataDir, {
          id: "512",
          name: "linear",
          mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
        });
        installCachedPlugin(fixture.dataDir, {
          id: "600",
          name: "open",
          mcpServers: { open: { type: "http", url: "https://open.example/mcp" } },
        });
        installCachedPlugin(fixture.dataDir, {
          id: "700",
          name: "configured",
          mcpServers: {
            configured: {
              type: "http",
              url: "https://configured.example/mcp",
              headers: { Authorization: "Bearer ${CONFIGURED_TOKEN}" },
            },
          },
        });
        const probed: string[] = [];
        const fetchFn: CursorPluginMcpFetch = async (input) => {
          probed.push(String(input));
          return new Response(null, { status: String(input).includes("open") ? 200 : 401 });
        };
        const options = { env: fixture.env, fetch: fetchFn };
        const expectedAuthRequired = [
          { identifier: "plugin-linear-linear", displayName: "linear" },
        ];
        const authPath = NodePath.join(fixture.projectDir, "mcp-auth.json");
        const malformedAuthFiles = [
          "{",
          encodeJson({ "plugin-linear-linear": "invalid" }),
          encodeJson({ "plugin-linear-linear": {} }),
          encodeJson({ "plugin-linear-linear": { tokens: {} } }),
          encodeJson({ "plugin-linear-linear": { tokens: { access_token: "" } } }),
          encodeJson({ "plugin-linear-linear": { tokens: { access_token: 42 } } }),
        ];

        const discovery = yield* discover(CWD, options);
        expect(discovery.servers).toContainEqual({
          type: "http",
          name: "plugin-linear-linear",
          url: "https://mcp.linear.app/mcp",
          headers: [],
        });
        expect(discovery.authRequired).toEqual(expectedAuthRequired);
        expect(probed.sort()).toEqual(["https://mcp.linear.app/mcp", "https://open.example/mcp"]);
        for (const contents of malformedAuthFiles) {
          writeFile(authPath, contents);
          expect(yield* discover(CWD, options)).toMatchObject({
            authRequired: expectedAuthRequired,
          });
        }
      }),
  );

  effectIt.effect(
    "drops unresolved placeholder entries and honors :-defaults from the provider environment",
    () =>
      Effect.gen(function* () {
        const fixture = makeCursorFixture("cursor-plugin-mcp-env-", ["48677658", "900"]);
        installCachedPlugin(fixture.dataDir, {
          id: "48677658",
          name: "github",
          mcpServers: {
            github: {
              type: "http",
              url: "https://api.githubcopilot.com/mcp/",
              headers: {
                Authorization: "Bearer ${MISSING_TOKEN}",
                "X-Mode": "${APP_MODE:-safe}",
              },
            },
          },
        });
        installCachedPlugin(fixture.dataDir, {
          id: "900",
          name: "stdio",
          mcpServers: {
            stdio: {
              command: "node",
              args: ["${MISSING_ARG}"],
              env: { MISSING: "${MISSING_TOKEN}", FALLBACK: "${MISSING_TOKEN:-local}" },
            },
          },
        });

        const discovery = yield* discover(CWD, { env: { ...fixture.env, APP_MODE: "live" } });
        expect(discovery.servers).toContainEqual({
          type: "http",
          name: "plugin-github-github",
          url: "https://api.githubcopilot.com/mcp/",
          headers: [{ name: "X-Mode", value: "live" }],
        });
        expect(discovery.servers).toContainEqual({
          name: "plugin-stdio-stdio",
          command: "node",
          args: [],
          env: [{ name: "FALLBACK", value: "local" }],
        });
        expect(discovery.authRequired).toEqual([]);
      }),
  );

  effectIt.effect("uses the provider environment's home when CURSOR_DATA_DIR is unset", () =>
    Effect.gen(function* () {
      const fixture = makeCursorFixture("cursor-plugin-mcp-home-", ["512"]);
      const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-home-"));
      installCachedPlugin(NodePath.join(home, ".cursor"), {
        id: "512",
        name: "linear",
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
      });
      const stateDb = fixture.env.CURSOR_GLOBAL_STATE_DB;

      const expected = {
        servers: [
          {
            type: "http",
            name: "plugin-linear-linear",
            url: "https://mcp.linear.app/mcp",
            headers: [],
          },
        ],
        authRequired: [],
      };
      expect(
        yield* discover(CWD, { env: { HOME: home, CURSOR_GLOBAL_STATE_DB: stateDb } }),
      ).toEqual(expected);
      expect(
        yield* discover(CWD, { env: { USERPROFILE: home, CURSOR_GLOBAL_STATE_DB: stateDb } }),
      ).toEqual(expected);
    }),
  );

  effectIt.effect("forwards nothing when Cursor has no install record for the workspace", () =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-no-db-"));
      const dataDir = NodePath.join(root, "cursor");
      writeCloudManifest(dataDir, [
        {
          pluginId: "512",
          name: "linear",
          marketplaceSlug: "cursor-public",
          resolvedCommitSha: "sha1",
        },
      ]);
      installCachedPlugin(dataDir, {
        id: "512",
        name: "linear",
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
      });

      expect(
        yield* discover(CWD, {
          env: {
            HOME: root,
            CURSOR_DATA_DIR: dataDir,
            CURSOR_GLOBAL_STATE_DB: NodePath.join(root, "missing.vscdb"),
          },
        }),
      ).toEqual({ servers: [], authRequired: [] });
    }),
  );

  effectIt.effect("does not forward a cache version adopted for an unmapped installed id", () =>
    Effect.gen(function* () {
      const fixture = makeCursorFixture("cursor-plugin-mcp-adopted-", ["999"]);
      writeCloudManifest(fixture.dataDir, [
        {
          pluginId: "61242178",
          name: "open-pstack",
          marketplaceSlug: "gannonh-open-pstack",
          resolvedCommitSha: "oldsha",
        },
      ]);
      installCachedPlugin(fixture.dataDir, {
        id: "61242178",
        name: "open-pstack",
        marketplace: "gannonh-open-pstack",
        folder: "open-pstack",
        sha: "newsha",
        mcpServers: { tools: { command: "node", args: ["server.js"] } },
      });

      expect(yield* discover(CWD, { env: fixture.env })).toEqual({
        servers: [],
        authRequired: [],
      });
    }),
  );

  effectIt.effect("returns no servers when the workspace has no installed plugins", () =>
    Effect.gen(function* () {
      const fixture = makeCursorFixture("cursor-plugin-mcp-empty-", []);
      installCachedPlugin(fixture.dataDir, {
        id: "512",
        name: "linear",
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
      });
      expect(yield* discover(CWD, { env: fixture.env })).toEqual({
        servers: [],
        authRequired: [],
      });
    }),
  );

  it("prefers CURSOR_DATA_DIR, then the home from the environment", () => {
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
