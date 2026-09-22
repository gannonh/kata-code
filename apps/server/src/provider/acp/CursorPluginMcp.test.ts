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
      NodePath.join(projectMcps, "plugin-linear-linear", "tools", "mcp_auth.json"),
      JSON.stringify({ name: "mcp_auth" }),
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
      NodePath.join(projectMcps, "plugin-stdio-stdio", "tools", "mcp_auth.json"),
      JSON.stringify({ name: "mcp_auth" }),
    );
    writeFile(
      NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd), "mcp-auth.json"),
      JSON.stringify({
        "plugin-linear-linear": { tokens: { access_token: "fake-linear-token" } },
        "plugin-stdio-stdio": { tokens: { access_token: "fake-stdio-token" } },
      }),
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
    const discovery = discoverCursorPluginMcpServers(cwd, {
      env: {
        CURSOR_DATA_DIR: dataDir,
        GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test",
        SECRET_TOKEN: "s3cret",
      },
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
    expect(discovery.authRequired).toEqual([]);
  });

  it("adds stored OAuth to SSE and preserves configured Authorization case-insensitively", () => {
    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-auth-"));
    const cwd = "/Volumes/EVO/dev/open-pstack";
    const projectDir = NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd));
    writeFile(
      NodePath.join(projectDir, "mcps", "plugin-linear-events", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-linear-events" }),
    );
    writeFile(
      NodePath.join(projectDir, "mcps", "plugin-linear-configured", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-linear-configured" }),
    );
    writeFile(
      NodePath.join(projectDir, "mcps", "plugin-linear-events", "tools", "mcp_auth.json"),
      JSON.stringify({ name: "mcp_auth" }),
    );
    writeFile(
      NodePath.join(projectDir, "mcps", "plugin-linear-configured", "tools", "mcp_auth.json"),
      JSON.stringify({ name: "mcp_auth" }),
    );
    writeFile(
      NodePath.join(projectDir, "mcp-auth.json"),
      JSON.stringify({
        "plugin-linear-events": { tokens: { access_token: "fake-events-token" } },
        "plugin-linear-configured": { tokens: { access_token: "fake-stored-token" } },
      }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/linear/aaa111/mcp.json"),
      JSON.stringify({
        mcpServers: {
          events: { type: "sse", url: "https://mcp.linear.app/events" },
          configured: {
            type: "http",
            url: "https://mcp.linear.app/configured",
            headers: { authorization: "Bearer ${MISSING_TOKEN}" },
          },
        },
      }),
    );

    expect(discoverCursorPluginMcpServers(cwd, { env: { CURSOR_DATA_DIR: dataDir } })).toEqual({
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
          headers: [],
        },
      ],
      authRequired: [
        {
          identifier: "plugin-linear-configured",
          displayName: "plugin-linear-configured",
        },
      ],
    });
  });

  it("marks OAuth-capable HTTP plugins auth-required for missing or malformed tokens", () => {
    const dataDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-invalid-auth-"),
    );
    const cwd = "/Volumes/EVO/dev/open-pstack";
    const projectDir = NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd));
    writeFile(
      NodePath.join(projectDir, "mcps", "plugin-linear-linear", "SERVER_METADATA.json"),
      JSON.stringify({ serverIdentifier: "plugin-linear-linear", serverName: "Linear" }),
    );
    writeFile(
      NodePath.join(projectDir, "mcps", "plugin-linear-linear", "tools", "mcp_auth.json"),
      JSON.stringify({ name: "mcp_auth" }),
    );
    writeFile(
      NodePath.join(dataDir, "plugins/cache/cursor-public/linear/aaa111/mcp.json"),
      JSON.stringify({
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
      }),
    );
    const authPath = NodePath.join(projectDir, "mcp-auth.json");
    const expected = {
      servers: [
        {
          type: "http",
          name: "plugin-linear-linear",
          url: "https://mcp.linear.app/mcp",
          headers: [],
        },
      ],
      authRequired: [{ identifier: "plugin-linear-linear", displayName: "Linear" }],
    };
    const malformedAuthFiles = [
      "{",
      JSON.stringify({ "plugin-linear-linear": "invalid" }),
      JSON.stringify({ "plugin-linear-linear": {} }),
      JSON.stringify({ "plugin-linear-linear": { tokens: {} } }),
      JSON.stringify({ "plugin-linear-linear": { tokens: { access_token: "" } } }),
      JSON.stringify({ "plugin-linear-linear": { tokens: { access_token: 42 } } }),
    ];

    expect(discoverCursorPluginMcpServers(cwd, { env: { CURSOR_DATA_DIR: dataDir } })).toEqual(
      expected,
    );
    for (const contents of malformedAuthFiles) {
      writeFile(authPath, contents);
      expect(discoverCursorPluginMcpServers(cwd, { env: { CURSOR_DATA_DIR: dataDir } })).toEqual(
        expected,
      );
    }
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

    const discovery = discoverCursorPluginMcpServers(cwd, {
      env: { CURSOR_DATA_DIR: dataDir, APP_MODE: "live" },
    });
    const { servers } = discovery;
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
    expect(discovery.authRequired).toEqual([]);
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
    expect(discoverCursorPluginMcpServers(cwd, { env: { HOME: home } })).toEqual(expected);
    expect(discoverCursorPluginMcpServers(cwd, { env: { USERPROFILE: home } })).toEqual(expected);
  });

  it("returns no servers when the project has no installed plugin metadata", () => {
    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cursor-plugin-mcp-empty-"));
    expect(
      discoverCursorPluginMcpServers("/tmp/empty-workspace", { env: { CURSOR_DATA_DIR: dataDir } }),
    ).toEqual({ servers: [], authRequired: [] });
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
