#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts write GitHub output before an Effect runtime exists.

import * as NodeFS from "node:fs";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { relayAlchemyBaseServices } from "./alchemy-services.ts";
import {
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
  type RelayPublicConfig,
} from "./relay-public-config.ts";
import { readRelayPublicConfigFromAlchemyState } from "./read-public-config-lib.ts";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const stage = readFlag("--stage") ?? "prod";
const githubOutput = process.argv.includes("--github-output");
const githubEnvFile = readFlag("--github-env-file");

const program = Effect.gen(function* () {
  const publicConfig = yield* readRelayPublicConfigFromAlchemyState(stage).pipe(
    Effect.provide(Cloudflare.state()),
  );

  if (githubOutput) {
    const githubOutputPath = process.env.GITHUB_OUTPUT?.trim();
    if (!githubOutputPath) {
      return yield* Effect.die(new Error("GITHUB_OUTPUT is required when --github-output is set"));
    }
    NodeFS.appendFileSync(
      githubOutputPath,
      serializeGithubOutput({
        changed: false,
        result: "state",
        relay_url: publicConfig.relayUrl,
      }),
    );
  }

  if (githubEnvFile) {
    yield* Effect.sync(() => {
      process.stdout.write(`::add-mask::${publicConfig.clientTracingToken}\n`);
    });
    NodeFS.writeFileSync(githubEnvFile, serializeRelayClientTracingEnvironment(publicConfig));
  }

  yield* Effect.sync(() => {
    process.stdout.write(`relay_url=${publicConfig.relayUrl}\n`);
  });

  return publicConfig satisfies RelayPublicConfig;
});

NodeRuntime.runMain(program.pipe(Effect.provide(relayAlchemyBaseServices), Effect.scoped));
