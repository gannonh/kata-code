import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  DEFAULT_VCR_IMAGE_REPOSITORY,
  ManagedImageResolutionError,
  makeVcrOciRegistry,
  managedImageTag,
  parseManagedImageManifest,
  resolveManagedImage,
} from "./managedImage.ts";

const digest = "sha256:" + "a".repeat(64);
const manifest = {
  digest,
  manifests: [
    { digest: "sha256:" + "b".repeat(64), platform: { os: "linux", architecture: "amd64" } },
    { digest: "sha256:" + "c".repeat(64), platform: { os: "linux", architecture: "arm64" } },
  ],
};

function failed<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    const result = yield* Effect.result(effect);
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") return undefined as never;
    return result.failure;
  });
}

describe("managed image resolution", () => {
  it("uses the public repository owned by the deployed Vercel project", () => {
    expect(DEFAULT_VCR_IMAGE_REPOSITORY).toBe("ghcr.io/gannonh/kata-sandbox");
  });

  it("uses the channel in the nightly release tag", () => {
    expect(managedImageTag({ serverVersion: "v0.0.43", channel: "stable" })).toBe("0.0.43");
    expect(managedImageTag({ serverVersion: "v0.0.43", channel: "nightly" })).toBe(
      "0.0.43-nightly",
    );
  });

  it("returns immutable index and platform references", () => {
    expect(
      parseManagedImageManifest("vcr.vercel.com/team/project/kata-sandbox", "0.0.43", manifest),
    ).toEqual({
      immutableReference: `vcr.vercel.com/team/project/kata-sandbox@${digest}`,
      indexDigest: digest,
      platformDigests: {
        "linux/amd64": "sha256:" + "b".repeat(64),
        "linux/arm64": "sha256:" + "c".repeat(64),
      },
    });
  });

  it.effect("keeps registry diagnostics separate from malformed indexes", () =>
    Effect.gen(function* () {
      const error = new ManagedImageResolutionError({
        kind: "registry-failure",
        message: "registry unavailable",
      });
      const failed = yield* Effect.result(
        resolveManagedImage(
          { serverVersion: "0.0.43", channel: "stable" },
          {
            repository: "vcr.vercel.com/team/project/kata-sandbox",
            readManifest: () => Effect.fail(error),
          },
        ),
      );
      expect(failed._tag).toBe("Failure");
      if (failed._tag === "Failure") {
        expect(failed.failure).toMatchObject({ kind: "registry-failure" });
      }
      expect(() => parseManagedImageManifest("registry/image", "0.0.43", {})).toThrow(
        "has no index digest",
      );
    }),
  );

  it("rejects an index without both supported platforms", () => {
    expect(() =>
      parseManagedImageManifest("registry/image", "0.0.43", { ...manifest, manifests: [] }),
    ).toThrow("linux/amd64");
  });

  it.effect("reads VCR manifests and honors Docker-Content-Digest", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const client = HttpClient.make((request) => {
        requests.push(request.url);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ manifests: manifest.manifests }), {
              status: 200,
              headers: { "docker-content-digest": digest },
            }),
          ),
        );
      });
      const resolution = yield* resolveManagedImage(
        { serverVersion: "0.0.43", channel: "stable" },
        makeVcrOciRegistry({
          repository: "vcr.vercel.com/team/project/kata-sandbox",
          httpClient: client,
        }),
      );
      expect(requests[0]).toBe(
        "https://vcr.vercel.com/v2/team/project/kata-sandbox/manifests/0.0.43",
      );
      expect(resolution.indexDigest).toBe(digest);
    }),
  );

  it.effect("completes an anonymous OCI bearer challenge before reading a manifest", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly authorization?: string }> = [];
      const manifestUrl = "https://ghcr.io/v2/gannonh/kata-sandbox/manifests/0.0.43";
      const client = HttpClient.make((request) => {
        requests.push({
          url: request.url,
          authorization: request.headers.authorization,
        });
        if (request.url.startsWith("https://ghcr.io/token?")) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ token: "anonymous-token" }), { status: 200 }),
            ),
          );
        }
        if (request.headers.authorization === "Bearer anonymous-token") {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ manifests: manifest.manifests }), {
                status: 200,
                headers: { "docker-content-digest": digest },
              }),
            ),
          );
        }
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              status: 401,
              headers: {
                "www-authenticate":
                  'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:gannonh/kata-sandbox:pull"',
              },
            }),
          ),
        );
      });

      const resolution = yield* resolveManagedImage(
        { serverVersion: "0.0.43", channel: "stable" },
        makeVcrOciRegistry({ repository: "ghcr.io/gannonh/kata-sandbox", httpClient: client }),
      );

      expect(requests).toEqual([
        { url: manifestUrl, authorization: undefined },
        {
          url: "https://ghcr.io/token?service=ghcr.io&scope=repository%3Agannonh%2Fkata-sandbox%3Apull",
          authorization: undefined,
        },
        { url: manifestUrl, authorization: "Bearer anonymous-token" },
      ]);
      expect(resolution.indexDigest).toBe(digest);
    }),
  );

  it.effect("reports malformed repository and digest responses as typed diagnostics", () =>
    Effect.gen(function* () {
      const invalidRepository = makeVcrOciRegistry({ repository: "https://registry/image" });
      expect(yield* failed(invalidRepository.readManifest("0.0.43"))).toMatchObject({
        kind: "invalid-repository",
      });
      const invalidDigestClient = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(manifest), {
              status: 200,
              headers: { "docker-content-digest": "sha256:not-a-digest" },
            }),
          ),
        ),
      );
      expect(
        yield* failed(
          makeVcrOciRegistry({
            repository: "vcr.vercel.com/team/image",
            httpClient: invalidDigestClient,
          }).readManifest("0.0.43"),
        ),
      ).toMatchObject({ kind: "invalid-digest" });
    }),
  );

  it.effect("rejects a conflicting OCI body and header digest", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify({ ...manifest, digest: "sha256:" + "d".repeat(64) }), {
              status: 200,
              headers: { "docker-content-digest": digest },
            }),
          ),
        ),
      );
      expect(
        yield* failed(
          makeVcrOciRegistry({
            repository: "vcr.vercel.com/team/image",
            httpClient: client,
          }).readManifest("0.0.43"),
        ),
      ).toMatchObject({ kind: "invalid-digest" });
    }),
  );

  it.effect("reports a missing managed tag as a typed registry diagnostic", () =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
      );
      expect(
        yield* failed(
          makeVcrOciRegistry({
            repository: "vcr.vercel.com/team/image",
            httpClient: client,
          }).readManifest("0.0.43"),
        ),
      ).toMatchObject({ kind: "missing-tag", status: 404 });
    }),
  );
});
