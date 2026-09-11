#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { AdoptPolicy } from "alchemy/AdoptPolicy";
import { AlchemyContext, AlchemyContextLive } from "alchemy/AlchemyContext";
import * as Apply from "alchemy/Apply";
import { ArtifactStore, createArtifactStore, provideFreshArtifactStore } from "alchemy/Artifacts";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileLive } from "alchemy/Auth/Profile";
import * as Cloudflare from "alchemy/Cloudflare";
import { Cli } from "alchemy/Cli/Cli";
import { LoggingCli } from "alchemy/Cli/LoggingCli";
import * as Plan from "alchemy/Plan";
import * as Stage from "alchemy/Stage";
import * as State from "alchemy/State/State";
import { isActionState } from "alchemy/State/State";
import { TelemetryLive } from "alchemy/Telemetry/Layer";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Command, Flag, Prompt } from "effect/unstable/cli";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";
import RelayStack from "../alchemy.run.ts";
import {
  abortInFlightPostgresReplace,
  alchemyPostgresReplaceActors,
  pickPostgresIdentity,
  postgresStateIdentity,
  type PostgresReplaceCensus,
} from "../src/postgres-replace-census.ts";

const relayDeployOutputFields = [
  "url",
  "mobileTracingUrl",
  "mobileTracingDataset",
  "mobileTracingToken",
  "clientTracingUrl",
  "clientTracingDataset",
  "clientTracingToken",
] as const;

export const RelayDeployOutputField = Schema.Literals(relayDeployOutputFields);
export type RelayDeployOutputField = typeof RelayDeployOutputField.Type;

export const RelayDeployResult = Schema.Literals([
  "applied",
  "noop",
  "dry-run",
  "cancelled",
  "state",
]);
export type RelayDeployResult = typeof RelayDeployResult.Type;

export class RelayDeployError extends Schema.TaggedError<RelayDeployError>()("RelayDeployError", {
  source: Schema.Literals(["alchemy_state", "alchemy_apply"]),
  stage: Schema.String,
  missingFields: Schema.Array(RelayDeployOutputField),
}) {
  override get message(): string {
    return `Relay deploy output from '${this.source}' for stage '${this.stage}' is missing required public config fields: ${this.missingFields.join(", ")}`;
  }
}

export class RelayPostgresReplaceAbortError extends Schema.TaggedError<RelayPostgresReplaceAbortError>()(
  "RelayPostgresReplaceAbortError",
  {
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Refused to abort RelayPostgresDatabase replace: ${this.reason}`;
  }
}

export class RelayDeployPublicConfigUnavailableError extends Schema.TaggedError<RelayDeployPublicConfigUnavailableError>()(
  "RelayDeployPublicConfigUnavailableError",
  {
    result: RelayDeployResult,
    stage: Schema.String,
    outputPath: Schema.String,
  },
) {
  override get message(): string {
    return `Relay deploy result '${this.result}' for stage '${this.stage}' did not produce public config required by GitHub environment output '${this.outputPath}'.`;
  }
}

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
  readonly inspectPostgresState: boolean;
  readonly abortPostgresReplace: boolean;
}

export interface RelayPublicConfig {
  readonly relayUrl: string;
  readonly mobileTracingUrl: string;
  readonly mobileTracingDataset: string;
  readonly mobileTracingToken: string;
  readonly clientTracingUrl: string;
  readonly clientTracingDataset: string;
  readonly clientTracingToken: string;
}

export function postgresReplaceCensusFromPlan(plan: Plan.Plan): PostgresReplaceCensus | undefined {
  for (const node of Object.values(plan.resources)) {
    if (!("resource" in node) || node.resource.LogicalId !== "RelayPostgresDatabase") {
      continue;
    }
    if (node.action !== "replace") {
      continue;
    }
    const live =
      node.state.status === "updating" || node.state.status === "replacing"
        ? node.state.old
        : node.state;
    const olds = live.props;
    const output = "attr" in live ? live.attr : undefined;
    return {
      actors: alchemyPostgresReplaceActors({
        news: node.props,
        olds,
        output,
        status: node.state.status,
        providerMode: node.state.providerMode,
        planMode: node.mode,
      }),
      status: node.state.status,
      providerMode: node.state.providerMode,
      planMode: node.mode,
      news: pickPostgresIdentity(node.props),
      olds: pickPostgresIdentity(olds),
      output: pickPostgresIdentity(output),
    };
  }
  return undefined;
}

const encodeUnknownJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const logJson = (value: unknown) =>
  encodeUnknownJson(value).pipe(Effect.flatMap((json) => Console.log(json)));

export function hasDeployChanges(plan: Plan.Plan): boolean {
  return (
    Object.keys(plan.deletions).length > 0 ||
    Object.values(plan.resources).some(
      (node) =>
        node.action !== "noop" || node.bindings.some((binding) => binding.action !== "noop"),
    )
  );
}

export interface RelayDeployOutcome {
  readonly result: RelayDeployResult;
  readonly changed: boolean;
  readonly publicConfig: Option.Option<RelayPublicConfig>;
}

export function serializeGithubOutput(entries: Readonly<Record<string, string | boolean>>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}

export function serializeRelayClientTracingEnvironment(config: RelayPublicConfig): string {
  return serializeGithubOutput({
    KATACODE_RELAY_CLIENT_OTLP_TRACES_URL: config.clientTracingUrl,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: config.clientTracingDataset,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: config.clientTracingToken,
  });
}

const relayRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);

const loadDeployConfigProvider = Effect.fn("relay.deploy.loadConfigProvider")(function* (
  envFileOverride: Option.Option<string>,
) {
  const path = yield* Path.Path;
  const root = yield* relayRoot;

  if (Option.isSome(envFileOverride)) {
    return yield* ConfigProvider.fromDotEnv({ path: path.resolve(root, envFileOverride.value) });
  }

  Object.assign(process.env, loadRepoEnv());
  return ConfigProvider.fromEnv();
});

const relayDeployStage = Config.nonEmptyString("stage").pipe(
  Config.option,
  Config.map(
    Option.getOrElse(() => `dev_${process.env.USER ?? process.env.USERNAME ?? "unknown"}`),
  ),
);

const reportDeployedRelayUrl = Effect.fn("relay.deploy.reportRelayUrl")(function* (
  config: RelayPublicConfig,
) {
  yield* Console.log(
    `Relay URL ${config.relayUrl}. Set KATACODE_RELAY_URL in the 1Password Environment if this stage should be the source-build default.`,
  );
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
  stage: string,
) {
  if (Option.isNone(outcome.publicConfig)) {
    return yield* new RelayDeployPublicConfigUnavailableError({
      result: outcome.result,
      stage,
      outputPath,
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
  Layer.succeed(ArtifactStore, createArtifactStore()),
  Layer.provideMerge(AlchemyContextLive, PlatformServices),
  Layer.provide(ProfileLive, PlatformServices),
  Layer.provide(CredentialsStoreLive, PlatformServices),
  FetchHttpClient.layer,
  TelemetryLive,
  LoggingCli,
);
const deployServices = deployBaseServices;

function relayPublicConfigValues(
  output: unknown,
): Readonly<Record<RelayDeployOutputField, string | undefined>> {
  if (typeof output !== "object" || output === null) {
    return {
      url: undefined,
      mobileTracingUrl: undefined,
      mobileTracingDataset: undefined,
      mobileTracingToken: undefined,
      clientTracingUrl: undefined,
      clientTracingDataset: undefined,
      clientTracingToken: undefined,
    };
  }
  const value = output as Record<string, unknown>;
  const text = (name: string) => {
    const candidate = value[name];
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
  };
  const secret = (name: string): string | undefined => {
    const candidate = value[name];
    if (!Redacted.isRedacted(candidate)) {
      return text(name);
    }
    const redacted = Redacted.value(candidate);
    return typeof redacted === "string" && redacted.length > 0 ? redacted : undefined;
  };
  return {
    url: text("url"),
    mobileTracingUrl: text("mobileTracingUrl"),
    mobileTracingDataset: text("mobileTracingDataset"),
    mobileTracingToken: secret("mobileTracingToken"),
    clientTracingUrl: text("clientTracingUrl"),
    clientTracingDataset: text("clientTracingDataset"),
    clientTracingToken: secret("clientTracingToken"),
  };
}

export function missingRelayPublicConfigFields(
  output: unknown,
): ReadonlyArray<RelayDeployOutputField> {
  const values = relayPublicConfigValues(output);
  return relayDeployOutputFields.filter((field) => values[field] === undefined);
}

function hasCompleteRelayPublicConfigValues(
  values: Readonly<Record<RelayDeployOutputField, string | undefined>>,
): values is Readonly<Record<RelayDeployOutputField, string>> {
  return relayDeployOutputFields.every((field) => values[field] !== undefined);
}

export function publicConfigFromOutput(output: unknown): RelayPublicConfig | null {
  const values = relayPublicConfigValues(output);
  if (!hasCompleteRelayPublicConfigValues(values)) {
    return null;
  }
  return {
    relayUrl: values.url,
    mobileTracingUrl: values.mobileTracingUrl,
    mobileTracingDataset: values.mobileTracingDataset,
    mobileTracingToken: values.mobileTracingToken,
    clientTracingUrl: values.clientTracingUrl,
    clientTracingDataset: values.clientTracingDataset,
    clientTracingToken: values.clientTracingToken,
  };
}

const abortRelayPostgresReplace = Effect.fn("relay.deploy.abortPostgresReplace")(function* (
  stage: string,
) {
  const state = yield* State.State;
  const service = yield* state;
  const fqn = "RelayPostgresDatabase";
  const row = yield* service.get({ stack: "T3CodeRelay", stage, fqn });
  const result = abortInFlightPostgresReplace(row);
  if (result.kind === "refuse") {
    return yield* new RelayPostgresReplaceAbortError({ reason: result.reason });
  }
  if (result.kind === "restored") {
    if (row === undefined || isActionState(row) || row.status !== "replacing") {
      return yield* new RelayPostgresReplaceAbortError({
        reason: "old generation disappeared",
      });
    }
    yield* service.set({
      stack: "T3CodeRelay",
      stage,
      fqn,
      value: row.old,
    });
  }
  const after = yield* service.get({ stack: "T3CodeRelay", stage, fqn });
  yield* logJson({
    abort: result.kind,
    reason: result.kind === "noop" ? result.reason : undefined,
    restoredId: result.kind === "restored" ? result.restoredId : undefined,
    after: postgresStateIdentity(after),
  });
  return {
    result: "state",
    changed: result.kind === "restored",
    publicConfig: Option.none<RelayPublicConfig>(),
  } satisfies RelayDeployOutcome;
});

const inspectRelayPostgresState = Effect.fn("relay.deploy.inspectPostgresState")(function* (
  stage: string,
) {
  const state = yield* State.State;
  const service = yield* state;
  const fqns = yield* service.list({ stack: "T3CodeRelay", stage });
  const replaced = yield* service.getReplacedResources({ stack: "T3CodeRelay", stage });
  const resources = [];
  const databases = [];
  for (const fqn of fqns) {
    const row = yield* service.get({ stack: "T3CodeRelay", stage, fqn });
    if (row === undefined) {
      resources.push({ fqn, missing: true });
      continue;
    }
    if (isActionState(row)) {
      resources.push({ fqn, kind: "action", status: row.status });
      continue;
    }
    resources.push({
      fqn,
      logicalId: row.logicalId,
      resourceType: row.resourceType,
      status: row.status,
      providerMode: row.providerMode,
      oldStatus:
        row.status === "replacing" || row.status === "replaced" ? row.old.status : undefined,
    });
    if (
      row.resourceType === "Planetscale.PostgresDatabase" ||
      row.logicalId === "RelayPostgresDatabase" ||
      fqn.includes("RelayPostgresDatabase")
    ) {
      databases.push(postgresStateIdentity(row));
    }
  }
  yield* logJson({
    stack: "T3CodeRelay",
    stage,
    postgresFqns: fqns.filter((fqn) => fqn.includes("Postgres") || fqn.includes("RelayPostgres")),
    replaced: replaced.map((row) => ({
      fqn: row.fqn,
      logicalId: row.logicalId,
      status: row.status,
    })),
    resources,
    databases,
  });
  return {
    result: "state",
    changed: false,
    publicConfig: Option.none<RelayPublicConfig>(),
  } satisfies RelayDeployOutcome;
});

const readRelayPublicConfig = Effect.fn("relay.deploy.readState")(function* (stage: string) {
  const state = yield* State.State;
  const service = yield* state;
  const output = yield* service.getOutput({ stack: "T3CodeRelay", stage });
  const publicConfig = publicConfigFromOutput(output);
  if (publicConfig === null) {
    return yield* new RelayDeployError({
      source: "alchemy_state",
      stage,
      missingFields: missingRelayPublicConfigFields(output),
    });
  }
  return {
    result: "state",
    changed: false,
    publicConfig: Option.some(publicConfig),
  } satisfies RelayDeployOutcome;
});

const runRelayDeploy = Effect.fn("relay.deploy.run")(
  function* (
    options: RelayDeployOptions,
    _configProvider: ConfigProvider.ConfigProvider,
    stage: string,
  ) {
    const stack = yield* RelayStack;
    const cli = yield* Cli;
    const plan = yield* Plan.make(stack, { force: options.force }).pipe(
      Effect.provide(stack.services),
    );
    const changed = hasDeployChanges(plan);
    if (options.dryRun) {
      yield* cli.displayPlan(plan);
      const census = postgresReplaceCensusFromPlan(plan);
      if (census !== undefined) {
        const json = yield* encodeUnknownJson(census);
        yield* Console.log(`RelayPostgresDatabase replace census ${json}`);
      }
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
    const publicConfig = publicConfigFromOutput(output);
    if (publicConfig === null) {
      return yield* new RelayDeployError({
        source: "alchemy_apply",
        stage,
        missingFields: missingRelayPublicConfigFields(output),
      });
    }
    return {
      result: changed ? "applied" : "noop",
      changed,
      publicConfig: Option.some(publicConfig),
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
  const configProvider = yield* loadDeployConfigProvider(options.envFile);
  const configuredStage = yield* relayDeployStage.pipe(
    Effect.provide(ConfigProvider.layer(configProvider)),
  );
  const stage = Option.getOrElse(options.stage, () => configuredStage);
  const outcome = options.abortPostgresReplace
    ? yield* abortRelayPostgresReplace(stage).pipe(Effect.provide(Cloudflare.state()))
    : options.inspectPostgresState
      ? yield* inspectRelayPostgresState(stage).pipe(Effect.provide(Cloudflare.state()))
      : options.readState
        ? yield* readRelayPublicConfig(stage).pipe(Effect.provide(Cloudflare.state()))
        : yield* runRelayDeploy(options, configProvider, stage);
  if (Option.isSome(outcome.publicConfig)) {
    yield* reportDeployedRelayUrl(outcome.publicConfig.value);
  }
  if (options.githubOutput) {
    yield* writeGithubOutput(outcome);
  }
  if (Option.isSome(options.githubEnvFile)) {
    yield* writeGithubEnvFile(outcome, options.githubEnvFile.value, stage);
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
        "Optional dotenv file. Omit this and set OP_SERVICE_ACCOUNT_TOKEN so deploy loads the 1Password Environment.",
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
    inspectPostgresState: Flag.boolean("inspect-postgres-state").pipe(
      Flag.withDescription(
        "Print Alchemy identity fields for RelayPostgresDatabase without planning or applying.",
      ),
      Flag.withDefault(false),
    ),
    abortPostgresReplace: Flag.boolean("abort-postgres-replace").pipe(
      Flag.withDescription(
        "Restore the live katacoderelay generation if Alchemy state is stuck mid-replace.",
      ),
      Flag.withDefault(false),
    ),
  },
  deploy,
).pipe(Command.withDescription("Deploy the Kata Code relay through Alchemy."));

if (import.meta.main) {
  Command.run(relayDeployCommand, { version: "0.0.0" }).pipe(
    Effect.provide(deployServices),
    Effect.scoped,
    NodeRuntime.runMain,
  );
}
