import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { VcsProcessOutput } from "../vcs/VcsProcess.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  GitHubCliAuthenticationError,
  GitHubCliUnavailableError,
} from "../sourceControl/GitHubCli.ts";
import {
  makeSandboxGitHubAccess,
  resolveRemoteSha,
  sourceEnvironment,
  type SandboxGitHubAccessDependencies,
} from "./SandboxGitHubAccess.ts";

const processOutput = (stdout: string): VcsProcessOutput =>
  ({
    exitCode: 0,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  }) as VcsProcessOutput;

const github = {
  assertAuthenticated: () => Effect.void,
  listRepositories: () => Effect.die("unused repository discovery"),
  listBranches: () => Effect.die("unused branch discovery"),
  withAuthTokenBytes: <A, E, R>(
    _input: { readonly cwd: string },
    use: (token: Uint8Array) => Effect.Effect<A, E, R>,
  ) => use(new TextEncoder().encode("sentinel-token")),
} satisfies SandboxGitHubAccessDependencies["github"];

describe("SandboxGitHubAccess", () => {
  it("preserves only the host paths needed by Git and GitHub CLI on POSIX and Windows", () => {
    expect(
      sourceEnvironment({
        PATH: "C:\\tools",
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        USERPROFILE: "C:\\Users\\tester",
        SystemRoot: "C:\\Windows",
        COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        GH_TOKEN: "must-not-pass",
      }),
    ).toEqual({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
      PATH: "C:\\tools",
      APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      USERPROFILE: "C:\\Users\\tester",
      SystemRoot: "C:\\Windows",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    });
  });

  it("resolves lightweight tags, peeled annotated tags, and explicit refs exactly", () => {
    const directTag = "a".repeat(40);
    const tagObject = "b".repeat(40);
    const peeledTag = "c".repeat(40);
    const pullHead = "d".repeat(40);
    const output = [
      `${directTag}\trefs/tags/v1`,
      `${tagObject}\trefs/tags/v2`,
      `${peeledTag}\trefs/tags/v2^{}`,
      `${pullHead}\trefs/pull/123/head`,
    ].join("\n");

    expect(resolveRemoteSha(output, "v1")).toBe(directTag);
    expect(resolveRemoteSha(output, "v2")).toBe(peeledTag);
    expect(resolveRemoteSha(output, "refs/pull/123/head")).toBe(pullHead);
  });

  it.effect("resolves private refs with a command-scoped gh credential helper", () => {
    const run = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>(() =>
      Effect.succeed(
        processOutput("b".repeat(40) + "\trefs/heads/main\n" + "c".repeat(40) + "\trefs/tags/v1\n"),
      ),
    );
    const access = makeSandboxGitHubAccess({
      cwd: "/server",
      github,
      vcs: { run },
    });

    return Effect.gen(function* () {
      const resolved = yield* access.resolve({
        repository: "octocat/private-repo",
        ref: "main",
      });

      expect(resolved).toEqual({
        repository: "octocat/private-repo",
        ref: "main",
        resolvedCommitSha: "b".repeat(40),
      });
      expect(run).toHaveBeenCalledWith({
        operation: "kata-sandbox.resolve-source",
        command: "git",
        args: [
          "-c",
          "credential.helper=",
          "-c",
          "credential.helper=!gh auth git-credential",
          "ls-remote",
          "https://github.com/octocat/private-repo.git",
          "refs/heads/main",
          "refs/tags/main",
          "refs/tags/main^{}",
        ],
        cwd: "/server",
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "/bin/false",
          ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
          ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
          ...(process.env.XDG_CONFIG_HOME === undefined
            ? {}
            : { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }),
          ...(process.env.GH_CONFIG_DIR === undefined
            ? {}
            : { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR }),
        },
        envMode: "replace",
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
      });
      const env = run.mock.calls[0]?.[0].env ?? {};
      expect(Object.keys(env).sort()).toEqual(
        [
          "GH_CONFIG_DIR",
          "GIT_ASKPASS",
          "GIT_CONFIG_GLOBAL",
          "GIT_CONFIG_NOSYSTEM",
          "GIT_TERMINAL_PROMPT",
          "HOME",
          "PATH",
          "XDG_CONFIG_HOME",
        ]
          .filter((key) => env[key] !== undefined)
          .sort(),
      );
    });
  });

  it.effect("zeroes callback-scoped credential bytes after checkout use", () => {
    const token = new TextEncoder().encode("sentinel-token");
    const access = makeSandboxGitHubAccess({
      cwd: "/server",
      github: {
        ...github,
        withAuthTokenBytes: (_input, use) =>
          Effect.acquireUseRelease(Effect.succeed(token), use, (bytes) =>
            Effect.sync(() => bytes.fill(0)),
          ),
      },
      vcs: { run: () => Effect.succeed(processOutput("")) },
    });

    return Effect.gen(function* () {
      const seen = yield* access.checkoutCredential.withToken((bytes) =>
        Effect.succeed(new TextDecoder().decode(bytes)),
      );
      expect(seen).toBe("sentinel-token");
      expect(Array.from(token)).toEqual(Array.from({ length: token.length }, () => 0));
    });
  });

  it.effect("reports an actionable authentication error before resolving a ref", () => {
    const run = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
    const access = makeSandboxGitHubAccess({
      cwd: "/server",
      github: {
        ...github,
        assertAuthenticated: () =>
          Effect.fail(
            new GitHubCliAuthenticationError({
              command: "gh",
              cwd: "/server",
              cause: "omitted",
            }),
          ),
      },
      vcs: { run },
    });

    return Effect.gen(function* () {
      const error = yield* access
        .resolve({ repository: "octocat/private-repo", ref: "main" })
        .pipe(Effect.flip);

      expect(error.message).toBe("GitHub CLI is not authenticated. Run `gh auth login` and retry.");
      expect(run).not.toHaveBeenCalled();
    });
  });

  it.effect("reports an actionable missing CLI error before resolving a ref", () => {
    const run = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
    const access = makeSandboxGitHubAccess({
      cwd: "/server",
      github: {
        ...github,
        assertAuthenticated: () =>
          Effect.fail(
            new GitHubCliUnavailableError({
              command: "gh",
              cwd: "/server",
              cause: "omitted",
            }),
          ),
      },
      vcs: { run },
    });

    return Effect.gen(function* () {
      const error = yield* access
        .resolve({ repository: "octocat/private-repo", ref: "main" })
        .pipe(Effect.flip);

      expect(error.message).toBe("GitHub CLI (`gh`) is required but not available on PATH.");
      expect(run).not.toHaveBeenCalled();
    });
  });

  it.effect("reports actionable discovery and checkout authentication errors", () => {
    const access = makeSandboxGitHubAccess({
      cwd: "/server",
      github: {
        ...github,
        listRepositories: () =>
          Effect.fail(
            new GitHubCliAuthenticationError({
              command: "gh",
              cwd: "/server",
              cause: "omitted",
            }),
          ),
        withAuthTokenBytes: () =>
          Effect.fail(
            new GitHubCliUnavailableError({
              command: "gh",
              cwd: "/server",
              cause: "omitted",
            }),
          ),
      },
      vcs: { run: () => Effect.succeed(processOutput("")) },
    });

    return Effect.gen(function* () {
      const discovery = yield* access.listRepositories({ page: 1 }).pipe(Effect.flip);
      expect(discovery.message).toBe(
        "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      );

      const checkout = yield* access.checkoutCredential
        .withToken(() => Effect.void)
        .pipe(Effect.flip);
      expect(checkout.message).toBe("GitHub CLI (`gh`) is required but not available on PATH.");
    });
  });
});
