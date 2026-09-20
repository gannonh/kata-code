import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Kata Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Kata Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

describe("DesktopEnvironment upstream OTLP and client assets", () => {
  it.effect("parses OTLP headers and protocol from the environment", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          KATACODE_HOME: " /tmp/t3 ",
          KATACODE_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          KATACODE_OTLP_HEADERS: "authorization=Basic%20abc%3D%3D,x-tenant=t3",
          KATACODE_OTLP_PROTOCOL: "http/protobuf",
        },
      );

      assert.deepEqual(
        environment.otlpHeaders,
        Option.some({
          authorization: "Basic abc==",
          "x-tenant": "t3",
        }),
      );
      assert.equal(environment.otlpProtocol, "http/protobuf");
    }),
  );

  it.effect("defaults OTLP protocol to http/json", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({}, { KATACODE_HOME: "/tmp/t3" });
      assert.equal(environment.otlpProtocol, "http/json");
    }),
  );

  it.effect("trims the OTLP metrics and logs signal URLs from the environment", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          KATACODE_HOME: " /tmp/t3 ",
          KATACODE_OTLP_METRICS_URL: " http://127.0.0.1:4318/v1/metrics ",
          KATACODE_OTLP_LOGS_URL: " http://127.0.0.1:4318/v1/logs ",
        },
      );

      assert.deepEqual(environment.otlpMetricsUrl, Option.some("http://127.0.0.1:4318/v1/metrics"));
      assert.deepEqual(environment.otlpLogsUrl, Option.some("http://127.0.0.1:4318/v1/logs"));
    }),
  );

  it.effect("leaves the OTLP metrics and logs URLs absent when unset", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({}, { KATACODE_HOME: "/tmp/t3" });

      assert.deepEqual(environment.otlpMetricsUrl, Option.none());
      assert.deepEqual(environment.otlpLogsUrl, Option.none());
    }),
  );

  it.effect("exposes packaged Windows client assets next to the server sidecar", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );
});
