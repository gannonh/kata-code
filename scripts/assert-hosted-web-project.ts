#!/usr/bin/env node
/**
 * assert-hosted-web-project.ts — fail unless a `vercel deploy` log shows that
 * the deployment went to the named Vercel project.
 *
 * The CLI prints `Inspect: https://vercel.com/<team>/<project>/<deployment>`,
 * so the project is one exact path segment. A prefix or substring match would
 * accept `katacode-web-staging` for `katacode-web`. The deployment already
 * exists when this runs, so it stops the alias, not the deploy; the
 * `.vercel/project.json` pin is what steers the deploy to the right project.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

export class HostedWebProjectMismatchError extends Schema.TaggedError<HostedWebProjectMismatchError>()(
  "HostedWebProjectMismatchError",
  { expected: Schema.String, actual: Schema.NullOr(Schema.String) },
) {
  override get message(): string {
    if (this.actual === null) {
      return `The Vercel deploy log has no Inspect URL, so the project it deployed to is unknown. Expected ${this.expected}.`;
    }
    const hint =
      this.actual === "kata-code"
        ? " Set VERCEL_PROJECT_ID to the hosted web project, not the repo-named VCR project."
        : "";
    return `Hosted web deploy went to Vercel project ${this.actual}, not ${this.expected}.${hint}`;
  }
}

export function deployedVercelProject(log: string): string | null {
  // eslint-disable-next-line no-control-regex -- strips the CLI's ANSI styling
  const plain = log.replace(/\u001b\[[0-9;]*m/g, "");
  return /Inspect: https:\/\/vercel\.com\/[^/\s]+\/([^/\s]+)\/\S+/.exec(plain)?.[1] ?? null;
}

export const assertHostedWebProject = (log: string, expected: string) => {
  const actual = deployedVercelProject(log);
  return actual === expected
    ? Effect.void
    : Effect.fail(new HostedWebProjectMismatchError({ expected, actual }));
};

export const assertHostedWebProjectCommand = Command.make(
  "assert-hosted-web-project",
  {
    log: Flag.String("log").pipe(Flag.withDescription("Captured `vercel deploy` output.")),
    project: Flag.String("project").pipe(Flag.withDescription("Exact Vercel project name.")),
  },
  ({ log, project }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* assertHostedWebProject(yield* fs.readFileString(log), project);
    }),
).pipe(Command.withDescription("Fail unless the deploy log names the expected Vercel project."));

if (import.meta.main) {
  Command.run(assertHostedWebProjectCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
