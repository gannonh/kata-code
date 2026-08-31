import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
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

describe("managed image resolution", () => {
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

  it("keeps registry diagnostics separate from malformed indexes", async () => {
    const error = new ManagedImageResolutionError({
      kind: "registry-failure",
      message: "registry unavailable",
    });
    await expect(
      Effect.runPromise(
        resolveManagedImage(
          { serverVersion: "0.0.43", channel: "stable" },
          {
            repository: "vcr.vercel.com/team/project/kata-sandbox",
            readManifest: () => Effect.fail(error),
          },
        ),
      ),
    ).rejects.toMatchObject({ kind: "registry-failure" });
    expect(() => parseManagedImageManifest("registry/image", "0.0.43", {})).toThrow(
      "has no index digest",
    );
  });

  it("rejects an index without both supported platforms", () => {
    expect(() =>
      parseManagedImageManifest("registry/image", "0.0.43", { ...manifest, manifests: [] }),
    ).toThrow("linux/amd64");
  });

  it("reads VCR manifests and honors Docker-Content-Digest", async () => {
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
    const resolution = await Effect.runPromise(
      resolveManagedImage(
        { serverVersion: "0.0.43", channel: "stable" },
        makeVcrOciRegistry({
          repository: "vcr.vercel.com/team/project/kata-sandbox",
          httpClient: client,
        }),
      ),
    );
    expect(requests[0]).toBe(
      "https://vcr.vercel.com/v2/team/project/kata-sandbox/manifests/0.0.43",
    );
    expect(resolution.indexDigest).toBe(digest);
  });

  it("reports malformed repository and digest responses as typed diagnostics", async () => {
    const invalidRepository = makeVcrOciRegistry({ repository: "https://registry/image" });
    await expect(Effect.runPromise(invalidRepository.readManifest("0.0.43"))).rejects.toMatchObject(
      {
        kind: "invalid-repository",
      },
    );
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
    await expect(
      Effect.runPromise(
        makeVcrOciRegistry({
          repository: "vcr.vercel.com/team/image",
          httpClient: invalidDigestClient,
        }).readManifest("0.0.43"),
      ),
    ).rejects.toMatchObject({ kind: "invalid-digest" });
  });

  it("rejects a conflicting OCI body and header digest", async () => {
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
    await expect(
      Effect.runPromise(
        makeVcrOciRegistry({
          repository: "vcr.vercel.com/team/image",
          httpClient: client,
        }).readManifest("0.0.43"),
      ),
    ).rejects.toMatchObject({ kind: "invalid-digest" });
  });

  it("reports a missing managed tag as a typed registry diagnostic", async () => {
    const client = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
    );
    await expect(
      Effect.runPromise(
        makeVcrOciRegistry({
          repository: "vcr.vercel.com/team/image",
          httpClient: client,
        }).readManifest("0.0.43"),
      ),
    ).rejects.toMatchObject({ kind: "missing-tag", status: 404 });
  });
});
