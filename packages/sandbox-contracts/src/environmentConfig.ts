/**
 * `.kata/environment.json` schema — the repo-committable, team-shareable
 * environment config (Phase 2 owns the resolver + execution; Phase 1 owns the
 * schema only). Modeled on Cursor's `environment.json`.
 *
 * All fields optional; unknown fields tolerated (forward-compat). Schema only —
 * no resolver logic here.
 *
 * @module environmentConfig
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "@kata-sh/code-contracts/baseSchemas";

/**
 * Optional build step: a Dockerfile (+ context) to build the sandbox image from.
 */
export const EnvironmentBuild = Schema.Struct({
  dockerfile: TrimmedNonEmptyString,
  context: Schema.optional(TrimmedNonEmptyString),
});
export type EnvironmentBuild = typeof EnvironmentBuild.Type;

/**
 * A named long-lived process to launch inside the sandbox (e.g. a dev server).
 */
export const EnvironmentTerminal = Schema.Struct({
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
});
export type EnvironmentTerminal = typeof EnvironmentTerminal.Type;

/**
 * Schema for `.kata/environment.json`. Secrets never live here (stored via
 * `ServerSecretStore` and injected as env vars in Phase 2).
 */
export const EnvironmentConfig = Schema.Struct({
  build: Schema.optionalKey(EnvironmentBuild),
  snapshot: Schema.optional(TrimmedNonEmptyString),
  install: Schema.optional(TrimmedNonEmptyString),
  start: Schema.optional(TrimmedNonEmptyString),
  terminals: Schema.optionalKey(Schema.Array(EnvironmentTerminal)),
});
export type EnvironmentConfig = typeof EnvironmentConfig.Type;
