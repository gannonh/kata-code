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
            headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
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
            args: ["--stdio"],
            env: { TOKEN: "${SECRET_TOKEN}", MODE: "read" },
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

    const servers = discoverCursorPluginMcpServers(cwd, { env: { CURSOR_DATA_DIR: dataDir } });
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
      headers: [],
    });
    const stdio = servers.find((server) => server.name === "plugin-stdio-stdio");
    expect(stdio).toMatchObject({
      name: "plugin-stdio-stdio",
      args: ["--stdio"],
      env: [{ name: "MODE", value: "read" }],
    });
    if (stdio && "command" in stdio) {
      expect(stdio.command.endsWith(`${NodePath.sep}bin${NodePath.sep}server`)).toBe(true);
      expect(stdio.command.includes("${")).toBe(false);
    }
    expect(servers.some((server) => server.name === "cursor-ide-browser")).toBe(false);
  });

  it("returns no servers when the project has no installed plugin metadata", () => {
    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-empty-"));
    expect(
      discoverCursorPluginMcpServers("/tmp/empty-workspace", { env: { CURSOR_DATA_DIR: dataDir } }),
    ).toEqual([]);
  });

  it("prefers CURSOR_DATA_DIR over the default ~/.cursor", () => {
    expect(cursorDataDir({ CURSOR_DATA_DIR: "/tmp/cursor-data" }, "/home/dev")).toBe(
      "/tmp/cursor-data",
    );
    expect(cursorDataDir({}, "/home/dev")).toBe(NodePath.join("/home/dev", ".cursor"));
  });
});
