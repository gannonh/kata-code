// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  cursorDataDir,
  cursorWorkspaceSlug,
  discoverCursorPluginMcpServers,
} from "./CursorPluginMcp.ts";

function writeFile(filePath: string, contents: string): void {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  NodeFS.writeFileSync(filePath, contents);
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
  it("emits ACP http/stdio servers for installed plugins from cache mcp.json, not tool schemas", () => {
    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-"));
    const cwd = "/Volumes/EVO/dev/open-pstack";
    const projectMcps = NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd), "mcps");
    writeFile(
      NodePath.join(projectMcps, "plugin-linear-linear", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-linear-linear", serverName: "linear" }),
    );
    writeFile(
      NodePath.join(projectMcps, "plugin-linear-linear", "tools", "get_issue.json"),
      JSON.stringify({ name: "get_issue", description: "not launch config" }),
    );
    writeFile(
      NodePath.join(projectMcps, "plugin-github-github", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-github-github", serverName: "github" }),
    );
    writeFile(
      NodePath.join(projectMcps, "cursor-ide-browser", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "cursor-ide-browser", serverName: "cursor-ide-browser" }),
    );
    writeFile(
      NodePath.join(projectMcps, "plugin-stdio-stdio", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-stdio-stdio", serverName: "stdio" }),
    );

    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/linear/aaa111/mcp.json"),
      JSON.stringify({
        mcpServers: { linear: { type: "streamable-http", url: "https://mcp.linear.app/mcp" } },
      }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/github/bbb222/mcp.json"),
      JSON.stringify({
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
      }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/stdio/ccc333/mcp.json"),
      JSON.stringify({
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
      }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/512/oldsha/mcp.json"),
      JSON.stringify({
        mcpServers: { linear: { type: "http", url: "https://example.invalid/not-used" } },
      }),
    );

    const pluginRoot = NodePath.join(dataDir, "plugins/cache/cursor-public/stdio/ccc333");
    const servers = discoverCursorPluginMcpServers(cwd, {
      env: {
        CURSOR_DATA_DIR: dataDir,
        GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test",
        SECRET_TOKEN: "s3cret",
      },
    });
    expect(servers.map((server) => server.name).sort()).toEqual([
      "plugin-github-github",
      "plugin-linear-linear",
      "plugin-stdio-stdio",
    ]);
    expect(servers).toContainEqual({
      type: "http",
      name: "plugin-linear-linear",
      url: "https://mcp.linear.app/mcp",
      headers: [],
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
      args: ["--stdio", `--root=${pluginRoot}`],
      env: [
        { name: "TOKEN", value: "s3cret" },
        { name: "MODE", value: "read" },
        { name: "DATA", value: `${pluginRoot}/data` },
      ],
    });
    if (stdio && "command" in stdio) {
      expect(stdio.command.endsWith(`${NodePath.sep}bin${NodePath.sep}server`)).toBe(true);
      expect(stdio.command.includes("${")).toBe(false);
    }
    expect(servers.some((server) => server.name === "cursor-ide-browser")).toBe(false);
  });

  it("drops unresolved placeholder entries and honors :-defaults from the provider environment", () => {
    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-env-"));
    const cwd = "/Volumes/EVO/dev/open-pstack";
    const projectMcps = NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd), "mcps");
    writeFile(
      NodePath.join(projectMcps, "plugin-github-github", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-github-github" }),
    );
    writeFile(
      NodePath.join(projectMcps, "plugin-stdio-stdio", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-stdio-stdio" }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/github/bbb222/mcp.json"),
      JSON.stringify({
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
      }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/stdio/ccc333/mcp.json"),
      JSON.stringify({
        mcpServers: {
          stdio: {
            command: "node",
            args: ["${MISSING_ARG}"],
            env: { MISSING: "${MISSING_TOKEN}", FALLBACK: "${MISSING_TOKEN:-local}" },
          },
        },
      }),
    );

    const servers = discoverCursorPluginMcpServers(cwd, {
      env: { CURSOR_DATA_DIR: dataDir, APP_MODE: "live" },
    });
    expect(servers).toContainEqual({
      type: "http",
      name: "plugin-github-github",
      url: "https://api.githubcopilot.com/mcp/",
      headers: [{ name: "X-Mode", value: "live" }],
    });
    expect(servers).toContainEqual({
      name: "plugin-stdio-stdio",
      command: "node",
      args: [],
      env: [{ name: "FALLBACK", value: "local" }],
    });
  });

  it("uses the provider environment's home when CURSOR_DATA_DIR is unset", () => {
    const home = NodePath.join(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-home-")),
      "home",
    );
    const cwd = "/Volumes/EVO/dev/open-pstack";
    const projectMcps = NodePath.join(
      home,
      ".cursor",
      "projects",
      cursorWorkspaceSlug(cwd),
      "mcps",
    );
    writeFile(
      NodePath.join(projectMcps, "plugin-linear-linear", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-linear-linear" }),
    );
    writeFile(
      NodePath.join(home, ".cursor", "plugins/cache/cursor-public/linear/aaa111/mcp.json"),
      JSON.stringify({
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
      }),
    );

    expect(discoverCursorPluginMcpServers(cwd, { env: { HOME: home } })).toContainEqual({
      type: "http",
      name: "plugin-linear-linear",
      url: "https://mcp.linear.app/mcp",
      headers: [],
    });
    expect(discoverCursorPluginMcpServers(cwd, { env: { USERPROFILE: home } })).toContainEqual({
      type: "http",
      name: "plugin-linear-linear",
      url: "https://mcp.linear.app/mcp",
      headers: [],
    });
  });

  it("returns no servers when the project has no installed plugin metadata", () => {
    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-empty-"));
    expect(
      discoverCursorPluginMcpServers("/tmp/empty-workspace", { env: { CURSOR_DATA_DIR: dataDir } }),
    ).toEqual([]);
  });

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
