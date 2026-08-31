import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import {
  OciImageDigest,
  SandboxImageChannel,
  SandboxImageVersion,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

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
  | "registry-failure"
  | "http-status"
  | "invalid-digest"
  | "invalid-repository";

export class ManagedImageResolutionError extends Data.TaggedError("ManagedImageResolutionError")<{
  readonly kind: ManagedImageDiagnosticKind;
  readonly message: string;
  readonly status?: number;
  readonly repository?: string;
}> {}

export interface ManagedImageRegistry {
  readonly repository: string;
  readonly readManifest: (tag: string) => Effect.Effect<unknown, ManagedImageResolutionError>;
}

export interface OciRegistryOptions {
  readonly repository?: string;
  readonly httpClient?: HttpClient.HttpClient;
  readonly baseUrl?: string;
}

export const DEFAULT_MANAGED_IMAGE_REPOSITORY = "ghcr.io/gannonh/kata-sandbox";

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const repositorySegmentPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const manifestSchema = Schema.Struct({
  digest: Schema.optional(Schema.String),
  manifests: Schema.optional(
    Schema.Array(
      Schema.Struct({
        digest: Schema.String,
        platform: Schema.optional(
          Schema.Struct({ architecture: Schema.String, os: Schema.String }),
        ),
      }),
    ),
  ),
});
const decodeManifest = Schema.decodeUnknownSync(manifestSchema);
const tokenResponseSchema = Schema.Struct({
  token: Schema.optional(Schema.String),
  access_token: Schema.optional(Schema.String),
});
const decodeTokenResponse = Schema.decodeUnknownSync(tokenResponseSchema);
const isImageVersion = Schema.is(SandboxImageVersion);
type Manifest = typeof manifestSchema.Type;

type ParsedRepository = {
  readonly host: string;
  readonly path: string;
};

function diagnostic(
  kind: ManagedImageDiagnosticKind,
  message: string,
  details: { readonly status?: number; readonly repository?: string } = {},
): ManagedImageResolutionError {
  return new ManagedImageResolutionError({ kind, message, ...details });
}

function parseRepository(repository: string, requireHost: boolean): ParsedRepository {
  const value = repository.trim();
  const segments = value.split("/");
  const host = segments[0] ?? "";
  const pathSegments = segments.slice(1);
  const validHost =
    host.length > 0 &&
    !host.includes("@") &&
    !host.includes("://") &&
    repositorySegmentPattern.test(host.replace(/:\d+$/, ""));
  const validPath =
    pathSegments.length === 0
      ? !requireHost
      : pathSegments.every((segment) => repositorySegmentPattern.test(segment));
  if (!validHost || !validPath || (requireHost && pathSegments.length === 0)) {
    throw diagnostic("invalid-repository", `The OCI image repository '${repository}' is invalid.`, {
      repository,
    });
  }
  return { host, path: pathSegments.join("/") };
}

function validateDigest(value: string, context: string): string {
  if (!digestPattern.test(value)) {
    throw diagnostic("invalid-digest", `${context} is not a valid sha256 OCI digest.`);
  }
  return value;
}

function validateManifest(value: unknown, tag: string): Manifest {
  try {
    return decodeManifest(value);
  } catch {
    throw diagnostic(
      "malformed-index",
      `The managed image tag '${tag}' returned an invalid index.`,
    );
  }
}

export function managedImageTag(input: {
  readonly serverVersion: string;
  readonly channel: SandboxImageChannel;
}): string {
  const version = input.serverVersion.trim().replace(/^v/, "");
  if (!isImageVersion(version)) {
    throw diagnostic(
      "malformed-index",
      `The managed image version '${input.serverVersion}' is invalid.`,
    );
  }
  return input.channel === "nightly" && !version.includes("nightly")
    ? `${version}-nightly`
    : version;
}

export function parseManagedImageManifest(
  repository: string,
  tag: string,
  value: unknown,
): ManagedImageResolution {
  parseRepository(repository, true);
  const manifest = validateManifest(value, tag);
  if (manifest.digest === undefined) {
    throw diagnostic("malformed-index", `The managed image tag '${tag}' has no index digest.`);
  }
  const indexDigest = validateDigest(
    manifest.digest,
    `The managed image tag '${tag}' index digest`,
  );
  if (manifest.manifests === undefined) {
    throw diagnostic("malformed-index", `The managed image tag '${tag}' has no manifest list.`);
  }
  const platformDigests: Record<string, string> = {};
  for (const entry of manifest.manifests) {
    const entryDigest = validateDigest(
      entry.digest,
      `The managed image tag '${tag}' platform digest`,
    );
    if (entry.platform === undefined) continue;
    platformDigests[`${entry.platform.os}/${entry.platform.architecture}`] = entryDigest;
  }
  if (platformDigests["linux/amd64"] === undefined) {
    throw diagnostic("missing-platform", "The managed image index has no linux/amd64 manifest.");
  }
  if (platformDigests["linux/arm64"] === undefined) {
    throw diagnostic("missing-platform", "The managed image index has no linux/arm64 manifest.");
  }
  return {
    immutableReference: `${repository}@${indexDigest}`,
    indexDigest,
    platformDigests,
  };
}

export function resolveManagedImage(
  input: { readonly serverVersion: string; readonly channel: SandboxImageChannel },
  registry: ManagedImageRegistry,
): Effect.Effect<ManagedImageResolution, ManagedImageResolutionError> {
  return Effect.try({
    try: () => managedImageTag(input),
    catch: (cause) =>
      cause instanceof ManagedImageResolutionError
        ? cause
        : diagnostic("malformed-index", String(cause)),
  }).pipe(
    Effect.flatMap((tag) =>
      registry.readManifest(tag).pipe(
        Effect.flatMap((manifest) =>
          Effect.try({
            try: () => parseManagedImageManifest(registry.repository, tag, manifest),
            catch: (cause) =>
              cause instanceof ManagedImageResolutionError
                ? cause
                : diagnostic("malformed-index", String(cause)),
          }),
        ),
      ),
    ),
  );
}

function manifestUrl(repository: string, tag: string, baseUrl: string | undefined): string {
  const parsed = parseRepository(repository, true);
  const base = baseUrl === undefined ? `https://${parsed.host}` : baseUrl.replace(/\/$/, "");
  return `${base}/v2/${parsed.path}/manifests/${encodeURIComponent(tag)}`;
}

function bearerTokenUrl(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  const values = new Map<string, string>();
  for (const match of header.slice("Bearer ".length).matchAll(/([a-z]+)="([^"]*)"/giu)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) values.set(name.toLowerCase(), value);
  }
  const realm = values.get("realm");
  if (realm === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(realm);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  for (const name of ["service", "scope"]) {
    const value = values.get(name);
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.toString();
}

export function makeOciRegistry(options: OciRegistryOptions | string = {}): ManagedImageRegistry {
  const normalized = typeof options === "string" ? { repository: options } : options;
  const repository = normalized.repository ?? DEFAULT_MANAGED_IMAGE_REPOSITORY;
  return {
    repository,
    readManifest: (tag) =>
      Effect.gen(function* () {
        const url = yield* Effect.try({
          try: () => manifestUrl(repository, tag, normalized.baseUrl),
          catch: (cause) =>
            cause instanceof ManagedImageResolutionError
              ? cause
              : diagnostic("invalid-repository", String(cause), { repository }),
        });
        const client = normalized.httpClient ?? (yield* HttpClient.HttpClient);
        const executeManifest = (authorization?: string) =>
          client
            .execute(
              HttpClientRequest.get(url).pipe(
                HttpClientRequest.setHeader(
                  "accept",
                  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
                ),
                authorization === undefined
                  ? (request) => request
                  : HttpClientRequest.setHeader("authorization", authorization),
              ),
            )
            .pipe(
              Effect.mapError((cause) =>
                diagnostic(
                  "registry-failure",
                  cause instanceof Error ? cause.message : String(cause),
                  {
                    repository,
                  },
                ),
              ),
            );
        let response = yield* executeManifest();
        if (response.status === 401) {
          const tokenUrl = bearerTokenUrl(response.headers["www-authenticate"]);
          if (tokenUrl !== undefined) {
            const tokenResponse = yield* client
              .execute(HttpClientRequest.get(tokenUrl))
              .pipe(
                Effect.mapError((cause) =>
                  diagnostic(
                    "registry-failure",
                    cause instanceof Error ? cause.message : String(cause),
                    { repository },
                  ),
                ),
              );
            if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
              return yield* diagnostic(
                "http-status",
                `OCI registry token service returned HTTP ${tokenResponse.status}.`,
                { status: tokenResponse.status, repository },
              );
            }
            const tokenBody = yield* tokenResponse.json.pipe(
              Effect.flatMap((body) =>
                Effect.try({
                  try: () => decodeTokenResponse(body),
                  catch: () =>
                    diagnostic("registry-failure", "OCI registry returned an invalid token.", {
                      repository,
                    }),
                }),
              ),
              Effect.mapError(() =>
                diagnostic("registry-failure", "OCI registry returned an invalid token.", {
                  repository,
                }),
              ),
            );
            const token = (tokenBody.token ?? tokenBody.access_token)?.trim();
            if (!token) {
              return yield* diagnostic(
                "registry-failure",
                "OCI registry returned an invalid token.",
                { repository },
              );
            }
            response = yield* executeManifest(`Bearer ${token}`);
          }
        }
        if (response.status === 404) {
          return yield* diagnostic("missing-tag", `Managed image tag '${tag}' was not found.`, {
            status: response.status,
            repository,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* diagnostic(
            "http-status",
            `OCI registry returned HTTP ${response.status}.`,
            {
              status: response.status,
              repository,
            },
          );
        }
        const body = yield* response.json.pipe(
          Effect.mapError(() =>
            diagnostic("malformed-index", `The managed image tag '${tag}' returned invalid JSON.`, {
              repository,
            }),
          ),
        );
        const headerDigest = response.headers["docker-content-digest"]?.trim();
        if (headerDigest !== undefined) {
          yield* Effect.try({
            try: () => validateDigest(headerDigest, "Docker-Content-Digest"),
            catch: (cause) =>
              cause instanceof ManagedImageResolutionError
                ? cause
                : diagnostic("invalid-digest", String(cause), { repository }),
          });
        }
        if (headerDigest === undefined) return body;
        if (body !== null && typeof body === "object" && !Array.isArray(body)) {
          const bodyDigest = (body as Record<string, unknown>).digest;
          if (typeof bodyDigest === "string" && bodyDigest !== headerDigest) {
            return yield* diagnostic(
              "invalid-digest",
              "Docker-Content-Digest does not match the OCI manifest digest.",
              { repository },
            );
          }
          return { ...(body as Record<string, unknown>), digest: headerDigest };
        }
        return body;
      }).pipe(Effect.provide(FetchHttpClient.layer)),
  };
}
