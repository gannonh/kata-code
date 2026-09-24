import { assert, describe, it } from "@effect/vitest";

import {
  planSandboxImagePrune,
  pruneSandboxImages,
  rateLimitWaitMs,
  selectKeptIndexes,
  type PruneResponse,
  type VcrImage,
} from "./prune-sandbox-images.ts";

const repository = "vcr.vercel.com/astro-labs/kata-code/kata-sandbox";
const now = Date.parse("2026-09-24T12:00:00.000Z");

function digest(name: string): string {
  return `sha256:${name.padEnd(64, "0")}`;
}

function index(id: string, createdAt: string, tags: ReadonlyArray<string>): VcrImage {
  return { id, manifestDigest: digest(id), kind: "index", createdAt, tags };
}

function manifest(id: string, createdAt: string): VcrImage {
  return { id, manifestDigest: digest(id), kind: "manifest", createdAt, tags: [] };
}

function respond(
  status: number,
  body: unknown = {},
  headers: Readonly<Record<string, string>> = {},
): PruneResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

const untaggedManifest = {
  id: "image_untagged",
  manifestDigest: digest("untagged"),
  kind: "manifest",
  createdAt: "2026-09-01T00:00:00.000Z",
  tags: [],
};

describe("sandbox image pruning", () => {
  it("keeps stable and moving tags plus the newest prereleases", () => {
    const images = [
      index("a1", "2026-09-01T00:00:00.000Z", ["0.0.43-nightly.20260901.1"]),
      index("a2", "2026-08-31T00:00:00.000Z", ["0.0.43", "latest"]),
      index("a3", "2026-09-03T00:00:00.000Z", ["0.0.44-nightly.20260903.3", "nightly"]),
      index("a4", "2026-09-02T00:00:00.000Z", ["0.0.43-nightly.20260902.2"]),
      index("a5", "2026-09-02T12:00:00.000Z", []),
      manifest("b1", "2026-09-01T00:00:00.000Z"),
    ];

    assert.deepStrictEqual(
      selectKeptIndexes(images, 0).map((image) => image.id),
      ["a2", "a3"],
    );
    assert.deepStrictEqual(
      selectKeptIndexes(images, 2).map((image) => image.id),
      ["a2", "a3", "a4", "a5"],
    );
  });

  it("deletes dropped indexes first and spares referenced, recent, or stable manifests", () => {
    const keptIndex = index("c1", "2026-09-23T00:00:00.000Z", ["0.0.43"]);
    const images = [
      manifest("d1", "2026-09-20T00:00:00.000Z"),
      keptIndex,
      manifest("d2", "2026-09-23T00:00:00.000Z"),
      index("c2", "2026-09-20T00:00:00.000Z", ["0.0.43-nightly.20260920.9"]),
      manifest("d3", "2026-09-24T11:00:00.000Z"),
      manifest("d4", "2026-09-24T09:59:59.000Z"),
      { ...manifest("d5", "2026-08-31T00:00:00.000Z"), tags: ["0.0.42"] },
    ];

    const doomed = planSandboxImagePrune({
      images,
      keptIndexes: [keptIndex],
      keptManifestDigests: new Set([digest("d2")]),
      now,
    });

    assert.deepStrictEqual(
      doomed.map((image) => image.id),
      ["c2", "d1", "d4"],
    );
  });

  it("pages through VCR, keeps manifests of kept indexes, and tolerates deleted images", async () => {
    const pages: Record<string, unknown> = {
      first: {
        images: [
          {
            id: "image_new",
            manifestDigest: digest("new"),
            kind: "index",
            createdAt: "2026-09-23T00:00:00.000Z",
            tags: ["0.0.43-nightly.20260923.5", "nightly"],
          },
          {
            id: "image_new_amd64",
            manifestDigest: digest("newamd64"),
            kind: "manifest",
            createdAt: "2026-09-23T00:00:00.000Z",
            tags: [],
          },
        ],
        nextCursor: "page-2",
      },
      "page-2": {
        images: [
          {
            id: "image_old",
            manifestDigest: digest("old"),
            kind: "index",
            createdAt: "2026-09-01T00:00:00.000Z",
            tags: ["0.0.43-nightly.20260901.1"],
          },
          {
            id: "image_old_amd64",
            manifestDigest: digest("oldamd64"),
            kind: "manifest",
            createdAt: "2026-09-01T00:00:00.000Z",
            tags: [],
          },
        ],
      },
    };
    const requests: Array<string> = [];
    const inspected: Array<string> = [];

    const doomed = await pruneSandboxImages({
      repository,
      projectId: "prj_registry",
      teamSlug: "astro-labs",
      token: "token",
      keepPrereleases: 0,
      now,
      sleep: async () => {},
      log: () => {},
      fetch: async (url, init) => {
        requests.push(`${init.method ?? "GET"} ${url}`);
        if (init.method === "DELETE") {
          return respond(url.includes("image_old_amd64") ? 404 : 200);
        }
        const cursor = new URL(url).searchParams.get("cursor") ?? "first";
        return respond(200, pages[cursor]);
      },
      runCommand: async (_command, args) => {
        inspected.push(args.at(-1)!);
        return { stdout: JSON.stringify({ manifests: [{ digest: digest("newamd64") }] }) };
      },
    });

    assert.deepStrictEqual(
      doomed.map((image) => image.id),
      ["image_old", "image_old_amd64"],
    );
    assert.deepStrictEqual(inspected, [`${repository}@${digest("new")}`]);
    const base = "https://api.vercel.com/v1/vcr/repository/kata-sandbox/images";
    assert.deepStrictEqual(requests, [
      `GET ${base}?projectId=prj_registry&slug=astro-labs&limit=100`,
      `GET ${base}?projectId=prj_registry&slug=astro-labs&limit=100&cursor=page-2`,
      `DELETE ${base}/image_old?projectId=prj_registry&slug=astro-labs`,
      `DELETE ${base}/image_old_amd64?projectId=prj_registry&slug=astro-labs`,
    ]);
  });

  it("fails when VCR refuses a delete", async () => {
    const result = pruneSandboxImages({
      repository,
      projectId: "prj_registry",
      token: "token",
      keepPrereleases: 0,
      now,
      log: () => {},
      sleep: async () => {},
      fetch: async (_url, init) =>
        init.method === "DELETE" ? respond(403) : respond(200, { images: [untaggedManifest] }),
      runCommand: async () => ({ stdout: "{}" }),
    });

    await result.then(
      () => assert.fail("expected the prune to reject"),
      (error: Error) =>
        assert.equal(error.message, "Deleting VCR image image_untagged returned HTTP 403."),
    );
  });

  it("waits out the VCR rate limit and retries the request", async () => {
    const sleeps: Array<number> = [];
    let deletes = 0;

    const doomed = await pruneSandboxImages({
      repository,
      projectId: "prj_registry",
      token: "token",
      keepPrereleases: 0,
      now,
      log: () => {},
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      fetch: async (_url, init) => {
        if (init.method !== "DELETE") return respond(200, { images: [untaggedManifest] });
        deletes += 1;
        return deletes === 1 ? respond(429, {}, { "retry-after": "3" }) : respond(200);
      },
      runCommand: async () => ({ stdout: "{}" }),
    });

    assert.deepStrictEqual(
      doomed.map((image) => image.id),
      ["image_untagged"],
    );
    assert.deepStrictEqual(sleeps, [3000]);
    assert.equal(deletes, 2);
  });

  it("derives the rate limit wait from the reset time and bounds it", () => {
    const headers = (values: Record<string, string>) => respond(429, {}, values).headers;

    assert.equal(rateLimitWaitMs(headers({ "x-ratelimit-reset": "1000" }), 990_000), 10_000);
    assert.equal(rateLimitWaitMs(headers({ "x-ratelimit-reset": "1000" }), 1_500_000), 1_000);
    assert.equal(rateLimitWaitMs(headers({ "retry-after": "600" }), 0), 120_000);
    assert.equal(rateLimitWaitMs(headers({}), 0), 60_000);
  });
});
