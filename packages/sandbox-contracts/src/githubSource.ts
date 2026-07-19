/**
 * Canonical GitHub source selection shared by sandbox drivers that clone a
 * repository into the sandbox workspace (Docker, Vercel, and future peers).
 *
 * Schema-only — no runtime helpers. Drivers embed this under `config.source`;
 * the server resolves clone URLs / fingerprints from the decoded payload.
 *
 * @module githubSource
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "@kata-sh/code-contracts/baseSchemas";

/** `{ repository, branch }` selection persisted on a sandbox instance config. */
export const SandboxGitHubSource = Schema.Struct({
  repository: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
}).pipe(
  Schema.annotate({
    description:
      "GitHub repository (`owner/name`) and branch cloned into the sandbox workspace on create.",
  }),
);
export type SandboxGitHubSource = typeof SandboxGitHubSource.Type;
