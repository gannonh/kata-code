#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay deploy bootstraps dotenv into process.env before Effect provider layers exist.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { AdoptPolicy } from "alchemy/AdoptPolicy";
import { AlchemyContext, AlchemyContextLive } from "alchemy/AlchemyContext";
import * as Apply from "alchemy/Apply";
import { provideFreshArtifactStore } from "alchemy/Artifacts";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileLive } from "alchemy/Auth/Profile";
import * as Cloudflare from "alchemy/Cloudflare";
import { Cli } from "alchemy/Cli/Cli";
import { LoggingCli } from "alchemy/Cli/LoggingCli";
import * as Plan from "alchemy/Plan";
import * as Stage from "alchemy/Stage";
import { TelemetryLive } from "alchemy/Telemetry/Layer";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import { Command, Flag, Prompt } from "effect/unstable/cli";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import RelayStack from "../alchemy.run.ts";
import { readRelayPublicConfigFromAlchemyState } from "./read-public-config-lib.ts";
import {
  publicConfigFromOutput,
  reconcileRootEnvPublicConfig,
  reconcileRootEnvRelayUrl,
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
  type RelayPublicConfig,
} from "./relay-public-config.ts";

export {
  publicConfigFromOutput,
  reconcileRootEnvPublicConfig,
  reconcileRootEnvRelayUrl,
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
  type RelayPublicConfig,
} from "./relay-public-config.ts";

export class RelayDeployError extends Data.TaggedError("RelayDeployError")<{
  readonly message: string;
}> {}

export interface RelayDeployOptions {
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly envFile: Option.Option<string>;
  readonly stage: Option.Option<string>;
  readonly yes: boolean;
  readonly adopt: boolean;
  readonly githubOutput: boolean;
  readonly githubEnvFile: Option.Option<string>;
  readonly readState: boolean;
}

export function hasDeployChanges(plan: Plan.Plan): boolean {
  return (
    Object.keys(plan.deletions).length > 0 ||
    Object.values(plan.resources).some(
      (node) =>
        node.action !== "noop" || node.bindings.some((binding) => binding.action !== "noop"),
    )
  );
}

export type RelayDeployResult = "applied" | "noop" | "dry-run" | "cancelled" | "state";

export interface RelayDeployOutcome {
  readonly result: RelayDeployResult;
  readonly changed: boolean;
  readonly publicConfig: Option.Option<RelayPublicConfig>;
}

const relayRootPath = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

function resolveRelayEnvFilePath(envFileOverride: Option.Option<string>): string {
  if (Option.isSome(envFileOverride)) {
    return NodePath.resolve(relayRootPath, envFileOverride.value);
  }
  return NodePath.join(relayRootPath, ".env");
}

/** Load relay `.env` into `process.env` before Alchemy builds provider auth layers. */
export function bootstrapRelayProcessEnv(envFileOverride: Option.Option<string>): void {
  const envPath = resolveRelayEnvFilePath(envFileOverride);
  if (!NodeFS.existsSync(envPath)) {
    return;
  }
  Object.assign(process.env, NodeUtil.parseEnv(NodeFS.readFileSync(envPath, "utf8")));
}

function ensureNonInteractiveAuth(options: RelayDeployOptions): void {
  if (!options.yes && !options.dryRun) {
    return;
  }
  process.env.CI = "true";
}

export function createDeployConfigProvider(
  options: RelayDeployOptions,
): ConfigProvider.ConfigProvider {
  bootstrapRelayProcessEnv(options.envFile);
  ensureNonInteractiveAuth(options);
  return ConfigProvider.fromEnv();
}

export function removeLeadingPackageManagerSeparator(argv: Array<string>): void {
  if (argv[2] === "--") {
    argv.splice(2, 1);
  }
}

const relayRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const repoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../../..", import.meta.url))),
);

const relayDeployStage = Config.nonEmptyString("stage").pipe(
  Config.option,
  Config.map(
    Option.getOrElse(() => `dev_${process.env.USER ?? process.env.USERNAME ?? "unknown"}`),
  ),
);

const reconcileRootEnv = Effect.fn("relay.deploy.reconcileRootEnv")(function* (
  config: RelayPublicConfig,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const rootEnvPath = path.join(root, ".env");
  const contents = (yield* fs.exists(rootEnvPath)) ? yield* fs.readFileString(rootEnvPath) : "";

  yield* fs.writeFileString(rootEnvPath, reconcileRootEnvPublicConfig(contents, config));
  yield* Console.log(`Updated ${rootEnvPath} with relay public client configuration`);
});

const writeGithubOutput = Effect.fn("relay.deploy.writeGithubOutput")(function* (
  outcome: RelayDeployOutcome,
) {
  const fs = yield* FileSystem.FileSystem;
  const githubOutputPath = yield* Config.nonEmptyString("GITHUB_OUTPUT");
  yield* fs.writeFileString(
    githubOutputPath,
    serializeGithubOutput({
      changed: outcome.changed,
      result: outcome.result,
      ...(Option.isSome(outcome.publicConfig)
        ? {
            relay_url: outcome.publicConfig.value.relayUrl,
          }
        : {}),
    }),
    { flag: "a" },
  );
});

const writeGithubEnvFile = Effect.fn("relay.deploy.writeGithubEnvFile")(function* (
  outcome: RelayDeployOutcome,
  outputPath: string,
) {
  if (Option.isNone(outcome.publicConfig)) {
    return yield* new RelayDeployError({
      message: "Relay public client config is unavailable for the GitHub environment file",
    });
  }
  const fs = yield* FileSystem.FileSystem;
  yield* Console.log(`::add-mask::${outcome.publicConfig.value.clientTracingToken}`);
  yield* fs.writeFileString(
    outputPath,
    serializeRelayClientTracingEnvironment(outcome.publicConfig.value),
  );
});

const deployBaseServices = Layer.mergeAll(
  Layer.succeed(AuthProviders, {}),
  Layer.provideMerge(AlchemyContextLive, PlatformServices),
  Layer.provide(ProfileLive, PlatformServices),
  Layer.provide(CredentialsStoreLive, PlatformServices),
  FetchHttpClient.layer,
  TelemetryLive,
  LoggingCli,
);
const deployServices = deployBaseServices;

const readRelayPublicConfig = Effect.fn("relay.deploy.readState")(function* (stage: string) {
  const publicConfig = yield* readRelayPublicConfigFromAlchemyState(stage).pipe(
    Effect.mapError(
      (error) =>
        new RelayDeployError({
          message: error.message,
        }),
    ),
  );
  return {
    result: "state",
    changed: false,
    publicConfig: Option.some(publicConfig),
  } satisfies RelayDeployOutcome;
});

const runRelayDeploy = Effect.fn("relay.deploy.run")(
  function* (
    options: RelayDeployOptions,
    configProvider: ConfigProvider.ConfigProvider,
    _stage: string,
  ) {
    const stack = yield* RelayStack;
    const cli = yield* Cli;
    const plan = yield* Plan.make(stack, { force: options.force }).pipe(
      Effect.provide(stack.services),
      Effect.provide(ConfigProvider.layer(configProvider)),
    );
    const changed = hasDeployChanges(plan);
    if (options.dryRun) {
      yield* cli.displayPlan(plan);
      return {
        result: "dry-run",
        changed,
        publicConfig: Option.none<RelayPublicConfig>(),
      } satisfies RelayDeployOutcome;
    }
    if (!options.yes && changed) {
      yield* cli.displayPlan(plan);
      const approved = yield* Prompt.run(
        Prompt.confirm({
          message: "Apply this relay deployment?",
        }),
      );
      if (!approved) {
        yield* Console.log("Deployment cancelled.");
        return {
          result: "cancelled",
          changed,
          publicConfig: Option.none<RelayPublicConfig>(),
        } satisfies RelayDeployOutcome;
      }
    }
    const output = yield* Apply.apply(plan).pipe(Effect.provide(stack.services));
    if (
      output.url === undefined ||
      output.mobileTracingUrl === undefined ||
      output.mobileTracingDataset === undefined ||
      output.mobileTracingToken === undefined ||
      output.clientTracingUrl === undefined ||
      output.clientTracingDataset === undefined ||
      output.clientTracingToken === undefined
    ) {
      return yield* new RelayDeployError({
        message: "Alchemy relay deploy output did not include complete public client config",
      });
    }
    return {
      result: changed ? "applied" : "noop",
      changed,
      publicConfig: Option.some({
        relayUrl: output.url,
        mobileTracingUrl: output.mobileTracingUrl,
        mobileTracingDataset: output.mobileTracingDataset,
        mobileTracingToken: Redacted.value(output.mobileTracingToken),
        clientTracingUrl: output.clientTracingUrl,
        clientTracingDataset: output.clientTracingDataset,
        clientTracingToken: Redacted.value(output.clientTracingToken),
      }),
    } satisfies RelayDeployOutcome;
  },
  (effect, options, configProvider, stage) =>
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.effect(
            AlchemyContext,
            AlchemyContext.pipe(Effect.map((context) => ({ ...context, adopt: options.adopt }))),
          ),
          Layer.succeed(AdoptPolicy, options.adopt),
          Layer.succeed(AuthProviders, {}),
          ConfigProvider.layer(configProvider),
          Layer.succeed(Stage.Stage, stage),
        ),
      ),
      provideFreshArtifactStore,
    ),
);

export const deploy = Effect.fn("relay.deploy")(function* (options: RelayDeployOptions) {
  const configProvider = createDeployConfigProvider(options);
  const configuredStage = yield* relayDeployStage.pipe(
    Effect.provide(ConfigProvider.layer(configProvider)),
  );
  const stage = Option.getOrElse(options.stage, () => configuredStage);
  const outcome = options.readState
    ? yield* readRelayPublicConfig(stage).pipe(Effect.provide(Cloudflare.state()))
    : yield* runRelayDeploy(options, configProvider, stage);
  if (Option.isSome(outcome.publicConfig)) {
    yield* reconcileRootEnv(outcome.publicConfig.value);
  }
  if (options.githubOutput) {
    yield* writeGithubOutput(outcome);
  }
  if (Option.isSome(options.githubEnvFile)) {
    yield* writeGithubEnvFile(outcome, options.githubEnvFile.value);
  }
});

export const relayDeployCommand = Command.make(
  "relay-deploy",
  {
    dryRun: Flag.boolean("dry-run").pipe(
      Flag.withDescription("Dry run the deployment without applying changes."),
      Flag.withDefault(false),
    ),
    force: Flag.boolean("force").pipe(
      Flag.withDescription("Force updates for resources that would otherwise no-op."),
      Flag.withDefault(false),
    ),
    envFile: Flag.string("env-file").pipe(
      Flag.withDescription(
        "Environment file to load. Defaults to infra/relay/.env with process env fallback.",
      ),
      Flag.optional,
    ),
    stage: Flag.string("stage").pipe(
      Flag.withDescription("Stage to deploy. Defaults to dev_${USER}."),
      Flag.optional,
    ),
    yes: Flag.boolean("yes").pipe(
      Flag.withDescription("Skip the deployment confirmation prompt."),
      Flag.withDefault(false),
    ),
    adopt: Flag.boolean("adopt").pipe(
      Flag.withDescription("Adopt pre-existing cloud resources that conflict with this stack."),
      Flag.withDefault(false),
    ),
    githubOutput: Flag.boolean("github-output").pipe(
      Flag.withDescription("Append relay deployment metadata to GITHUB_OUTPUT."),
      Flag.withDefault(false),
    ),
    githubEnvFile: Flag.string("github-env-file").pipe(
      Flag.withDescription(
        "Write relay client tracing variables to a file suitable for GITHUB_ENV.",
      ),
      Flag.optional,
    ),
    readState: Flag.boolean("read-state").pipe(
      Flag.withDescription("Read the deployed stack output without planning or applying changes."),
      Flag.withDefault(false),
    ),
  },
  deploy,
).pipe(Command.withDescription("Deploy the Kata Code relay through Alchemy."));

if (import.meta.main) {
  removeLeadingPackageManagerSeparator(process.argv);
  Command.run(relayDeployCommand, { version: "0.0.0" }).pipe(
    Effect.provide(deployServices),
    Effect.scoped,
    NodeRuntime.runMain,
  );
}
