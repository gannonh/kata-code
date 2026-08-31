import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { OciImageDigest, SandboxImageChannel } from "@kata-sh/code-kata-sandbox-contracts/domain";

export const ManagedImageResolution = Schema.Struct({
  immutableReference: OciImageDigest,
  indexDigest: OciImageDigest,
  platformDigests: Schema.Record(Schema.String, OciImageDigest),
});
export type ManagedImageResolution = typeof ManagedImageResolution.Type;

export type ManagedImageDiagnosticKind =
  | "missing-tag"
  | "malformed-index"
  | "missing-platform"
  | "registry-failure";

export class ManagedImageResolutionError extends Data.TaggedError("ManagedImageResolutionError")<{
  readonly kind: ManagedImageDiagnosticKind;
  readonly message: string;
}> {}

export interface ManagedImageRegistry {
  readonly repository: string;
  readonly readManifest: (tag: string) => Effect.Effect<unknown, ManagedImageResolutionError>;
}

const digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/i));
const manifestSchema = Schema.Struct({
  digest: Schema.optional(digest),
  manifests: Schema.optional(
    Schema.Array(
      Schema.Struct({
        digest,
        platform: Schema.optional(
          Schema.Struct({ architecture: Schema.String, os: Schema.String }),
        ),
      }),
    ),
  ),
});

const decodeManifest = Schema.decodeUnknownSync(manifestSchema);

type Manifest = typeof manifestSchema.Type;

function diagnostic(
  kind: ManagedImageDiagnosticKind,
  message: string,
): ManagedImageResolutionError {
  return new ManagedImageResolutionError({ kind, message });
}

export function managedImageTag(input: {
  readonly serverVersion: string;
  readonly channel: SandboxImageChannel;
}): string {
  const version = input.serverVersion.trim().replace(/^v/, "");
  return input.channel === "nightly" && !version.includes("nightly")
    ? `${version}-nightly`
    : version;
}

export function parseManagedImageManifest(
  repository: string,
  tag: string,
  value: unknown,
): ManagedImageResolution {
  let manifest: Manifest;
  try {
    manifest = decodeManifest(value);
  } catch {
    throw diagnostic(
      "malformed-index",
      `The managed image tag '${tag}' returned an invalid index.`,
    );
  }
  if (manifest.digest === undefined) {
    throw diagnostic("malformed-index", `The managed image tag '${tag}' has no index digest.`);
  }
  const platformDigests: Record<string, string> = {};
  for (const entry of manifest.manifests ?? []) {
    if (entry.platform === undefined) continue;
    platformDigests[`${entry.platform.os}/${entry.platform.architecture}`] = entry.digest;
  }
  if (platformDigests["linux/amd64"] === undefined) {
    throw diagnostic("missing-platform", "The managed image index has no linux/amd64 manifest.");
  }
  if (platformDigests["linux/arm64"] === undefined) {
    throw diagnostic("missing-platform", "The managed image index has no linux/arm64 manifest.");
  }
  return {
    immutableReference: `${repository}@${manifest.digest}`,
    indexDigest: manifest.digest,
    platformDigests,
  };
}

export function resolveManagedImage(
  input: { readonly serverVersion: string; readonly channel: SandboxImageChannel },
  registry: ManagedImageRegistry,
): Effect.Effect<ManagedImageResolution, ManagedImageResolutionError> {
  const tag = managedImageTag(input);
  return registry.readManifest(tag).pipe(
    Effect.flatMap((manifest) =>
      Effect.try({
        try: () => parseManagedImageManifest(registry.repository, tag, manifest),
        catch: (cause) =>
          cause instanceof ManagedImageResolutionError
            ? cause
            : diagnostic("malformed-index", String(cause)),
      }),
    ),
  );
}
