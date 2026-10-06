// Kata-owned CLI coverage: the `katacode` command identity, Kata Code Connect
// copy, and publish-only link status. Upstream removed bin.test.ts when the CLI
// moved to binCli.ts; these cases came from Kata's copy of it.
// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node filesystem boundaries.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@kata-sh/code-shared/Net";
import { HostProcessEnvironment } from "@kata-sh/code-shared/hostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CliError from "effect/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { cli, makeCli } from "./binCli.ts";
import * as ServiceLauncherClient from "./cloud/serviceLauncherClient.ts";
import {
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_LAUNCHER_PROTOCOL,
} from "./cloud/serviceProtocol.ts";
import * as ServerConfig from "./config.ts";
import * as CliState from "./cloud/CliState.ts";

import packageJson from "../package.json" with { type: "json" };

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const DisconnectedLauncherChildLayer = Layer.mergeAll(
  Layer.succeed(HostProcessEnvironment, {
    ...process.env,
    [SERVICE_LAUNCHER_CONTEXT_ENV]: JSON.stringify({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      childVersion: packageJson.version,
    }),
  }),
  Layer.succeed(ServiceLauncherClient.ServiceLauncherHostProcess, {
    connected: false,
    send: () => false,
    on: () => undefined,
    off: () => undefined,
  }),
);

const connectCli = makeCli({ cloudEnabled: true });
const noConnectCli = makeCli({ cloudEnabled: false });
const runCli = (args: ReadonlyArray<string>, command = cli) =>
  Command.runWith(command, { version: "0.0.0" })(args);
const runConnectCli = (args: ReadonlyArray<string>) => runCli(args, connectCli);
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

it.layer(NodeServices.layer)("katacode cli", (it) => {
  it.effect("accepts the built-in lowercase log-level flag values", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["--log-level", "debug", "--version"]));

      assert.include(output, "0.0.0");
    }),
  );

  it.effect("accepts canonical --no-<flag> boolean negation", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["--no-log-websocket-events", "--version"]));

      assert.include(output, "0.0.0");
    }),
  );

  it.effect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${error._tag}`);
      }
      assert.equal(error.option, "log-level");
      assert.equal(error.value, "Debug");
    }),
  );

  it.effect("rejects connect commands when public configuration is missing", () =>
    Effect.gen(function* () {
      const error = yield* runCli(["connect", "status"], noConnectCli).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["katacode", "connect"]);
      assert.include(
        error.errors[0]?.message ?? "",
        "missing Kata Code Connect public configuration",
      );

      const output = (yield* TestConsole.errorLines).join("\n");
      assert.include(output, "ERROR");
      assert.include(output, "missing Kata Code Connect public configuration");
    }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer))),
  );

  it.effect("exposes service lifecycle commands without Kata Code Connect configuration", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["service", "--help"], noConnectCli));

      assert.include(output, "Manage the Kata Code background service.");
      assert.include(output, "install");
      assert.include(output, "uninstall");
      assert.include(output, "update");
      assert.include(output, "status");
    }),
  );

  it.effect("reports fresh headless connect state without requiring local configuration", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-cli-cloud-status-test-"),
      );
      const { output } = yield* captureStdout(
        runConnectCli(["connect", "status", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off - CLI JSON output is decoded as a presentation DTO.
      const status = JSON.parse(output) as {
        readonly desired: boolean;
        readonly authenticated: boolean;
        readonly linked: boolean;
        readonly cloudUserId: string | null;
        readonly relayUrl: string | null;
        readonly desiredLinkMode: CliState.CliDesiredLinkMode | null;
      };

      assert.equal(status.desired, false);
      assert.equal(status.authenticated, false);
      assert.equal(status.linked, false);
      assert.equal(status.cloudUserId, null);
      assert.equal(status.relayUrl, null);
      assert.equal(status.desiredLinkMode, null);
    }).pipe(Effect.provide(DisconnectedLauncherChildLayer)),
  );

  it.effect("reports actionable human-readable headless connect state", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-cli-cloud-status-human-test-"),
      );
      const { output } = yield* captureStdout(
        runConnectCli(["connect", "status", "--base-dir", baseDir]),
      );

      assert.include(output, "Kata Code Connect\n  Exposure: disabled");
      assert.include(output, "  Authorization: missing");
      assert.include(output, "  Environment link: not provisioned");
      assert.include(
        output,
        "Next: Run `katacode connect link` to authorize and enable Kata Code Connect.",
      );
    }),
  );

  it.effect("reports publish-only pending links without promising a managed tunnel", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-cli-cloud-publish-only-status-test-"),
      );
      const { secretsDir } = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
      NodeFS.mkdirSync(secretsDir, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(secretsDir, "cloud-cli-oauth-token.bin"),
        // @effect-diagnostics-next-line preferSchemaOverJson:off - Test fixture matches the persisted CLI token representation.
        JSON.stringify({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        }),
      );
      NodeFS.writeFileSync(
        NodePath.join(secretsDir, `${CliState.CLOUD_CLI_DESIRED_LINK_SECRET}.bin`),
        "publish_only",
      );

      const human = yield* captureStdout(
        runConnectCli(["connect", "status", "--base-dir", baseDir]),
      );
      const json = yield* captureStdout(
        runConnectCli(["connect", "status", "--base-dir", baseDir, "--json"]),
      );

      assert.include(
        human.output,
        "Start Kata Code to provision the environment link and publish agent activity.",
      );
      assert.include(human.output, "No managed tunnel will be created.");
      assert.notInclude(human.output, "launch its managed tunnel");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - CLI JSON output is decoded as a presentation DTO.
      const decoded = JSON.parse(json.output) as {
        readonly desired: boolean;
        readonly desiredLinkMode: CliState.CliDesiredLinkMode | null;
      };
      assert.isTrue(decoded.desired);
      assert.equal(decoded.desiredLinkMode, "publish_only");
    }),
  );

  it.effect("accepts the --headless login override without enabling access", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-cli-cloud-login-test-"),
      );
      const { secretsDir } = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
      NodeFS.mkdirSync(secretsDir, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(secretsDir, "cloud-cli-oauth-token.bin"),
        // @effect-diagnostics-next-line preferSchemaOverJson:off - Test fixture matches the persisted CLI token representation.
        JSON.stringify({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        }),
      );

      const login = yield* captureStdout(
        runConnectCli(["connect", "login", "--base-dir", baseDir, "--headless"]),
      );
      const status = yield* captureStdout(
        runConnectCli(["connect", "status", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off - CLI JSON output is decoded as a presentation DTO.
      const decoded = JSON.parse(status.output) as {
        readonly desired: boolean;
        readonly authenticated: boolean;
      };

      assert.equal(login.output, "✓ Signed in");
      assert.isFalse(decoded.desired);
      assert.isTrue(decoded.authenticated);
    }),
  );

  it.effect("disables headless connect without a running server", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-cli-cloud-unlink-test-"),
      );
      const { output } = yield* captureStdout(
        runConnectCli(["connect", "unlink", "--base-dir", baseDir]),
      );

      assert.equal(output, "Kata Code Connect is disabled locally.");
    }),
  );

  it.effect("logs out of headless connect and removes the stored CLI authorization", () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-cli-cloud-logout-test-"),
      );
      const { secretsDir } = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
      const tokenPath = NodePath.join(secretsDir, "cloud-cli-oauth-token.bin");
      NodeFS.mkdirSync(secretsDir, { recursive: true });
      NodeFS.writeFileSync(tokenPath, "invalid persisted token");

      const { output } = yield* captureStdout(
        runConnectCli(["connect", "logout", "--base-dir", baseDir]),
      );

      assert.equal(
        output,
        "Signed out of Kata Code Connect locally.\nThe background service is managed separately with `katacode service`.",
      );
      assert.isFalse(NodeFS.existsSync(tokenPath));
    }),
  );
});
