import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { parseUpdateManifest } from "./lib/update-manifest.ts";
import {
  findIncompleteReleaseProblems,
  findMissingUpdaterFeedProblems,
  isUpdaterManifestName,
  newerPublishedNightlyTag,
  publishGitHubRelease,
} from "./publish-github-release.ts";

const NIGHTLY_MAC_MANIFEST = `version: '0.0.44-nightly.20261002.1602'
files:
  - url: Kata-Code-macOS-Apple-Silicon-arm64.zip
    sha512: eQkD2Z6hb8+FBz2nr9zJDbkwLkfKlMv+9cM6JPLFiEo48Lu8x5TIA0+3Kx2zrnliFxVzv3aWbqUoSw0yquu9hg==
    size: 152111146
  - url: Kata-Code-macOS-Apple-Silicon.dmg
    sha512: 1HWkzdqWicGQWL/fsn7dAzBTGnBQS56hcOaSCtb0wKRc7wtDMShZEbC0Cuv5gPx9NuqR3v6E2yrZY58reC/gTQ==
    size: 157786161
releaseDate: '2026-10-02T16:08:14.523Z'
`;

const NIGHTLY_LINUX_MANIFEST = `version: 0.0.44-nightly.20261002.1602
files:
  - url: Kata-Code-Linux-x64.AppImage
    sha512: YR7XP+kv1T0wB0Zn4ZtBbY0auUXyXV+NUL3seD7WscFAqUIij8g30qPapGvWj81JtrmjDACp7Nkywt2Jc3cmLg==
    size: 174987455
    blockMapSize: 182483
path: Kata-Code-Linux-x64.AppImage
sha512: YR7XP+kv1T0wB0Zn4ZtBbY0auUXyXV+NUL3seD7WscFAqUIij8g30qPapGvWj81JtrmjDACp7Nkywt2Jc3cmLg==
releaseDate: '2026-10-02T15:39:21.904Z'
`;

const MERGED_NIGHTLY_MAC_MANIFEST = `version: '0.0.44-nightly.20261005.1694'
files:
  - url: Kata-Code-macOS-Apple-Silicon-arm64.zip
    sha512: EAmXkJ2vrdg7Cm04rte/7GjBH490ZqdTyS2eYhV7a2kWtrwBLDYbqqqzETw5X7Rs50MVijEmyLCXzDnpQ++rrQ==
    size: 166699535
  - url: Kata-Code-macOS-Apple-Silicon.dmg
    sha512: vFPOdkcKw3tJBEXqbQkwGXVYC/Rtmkxm+VkUGel0gV/bSGFoA7AnNxt2c6of1vg8z8HufmrP0jMe+4UMQt4Aew==
    size: 173103577
  - url: Kata-Code-macOS-Intel.zip
    sha512: tu66PIImaczGTV6m4C/V1z3zkRMRjCaQWPV+bCIrBLGX/SE/l58u5Tsv2cjzzL/jzsuCev/6b7EaTyh0SAhQUw==
    size: 173250431
  - url: Kata-Code-macOS-Intel.dmg
    sha512: 8uFXsYQh9Xe/RnlCpw+hfWAV5GPAPCAMFYDOOZFsOil14XfcyPpFJk7Hj48H0VOAAuexhuRInJiAITWINgMhLg==
    size: 179712320
releaseDate: '2026-10-05T14:45:01.662Z'
`;

const INTEL_ONLY_NIGHTLY_MAC_MANIFEST = `version: '0.0.44-nightly.20261005.1694'
files:
  - url: Kata-Code-macOS-Intel.zip
    sha512: tu66PIImaczGTV6m4C/V1z3zkRMRjCaQWPV+bCIrBLGX/SE/l58u5Tsv2cjzzL/jzsuCev/6b7EaTyh0SAhQUw==
    size: 173250431
  - url: Kata-Code-macOS-Intel.dmg
    sha512: 8uFXsYQh9Xe/RnlCpw+hfWAV5GPAPCAMFYDOOZFsOil14XfcyPpFJk7Hj48H0VOAAuexhuRInJiAITWINgMhLg==
    size: 179712320
releaseDate: '2026-10-05T14:45:01.662Z'
`;

const NIGHTLY_LINUX_ARM64_MANIFEST = `version: 0.0.44-nightly.20261005.1694
files:
  - url: Kata-Code-Linux-arm64.AppImage
    sha512: Jh7k6dTWSEFM6NPOq1sBNRQD/HEb/nFv6GpQgXyQ8YsNel0XkMrOFLPAYyTj9brkc//Bdq69g30Fa+KZWnJY5w==
    size: 192292877
    blockMapSize: 201561
path: Kata-Code-Linux-arm64.AppImage
sha512: Jh7k6dTWSEFM6NPOq1sBNRQD/HEb/nFv6GpQgXyQ8YsNel0XkMrOFLPAYyTj9brkc//Bdq69g30Fa+KZWnJY5w==
releaseDate: '2026-10-05T14:35:47.429Z'
`;

const manifest = (name: string, text: string) => ({
  name,
  manifest: parseUpdateManifest(text, name, "release"),
});

describe("isUpdaterManifestName", () => {
  it("accepts the stable and nightly feeds and nothing else", () => {
    assert.deepStrictEqual(
      [
        "latest.yml",
        "latest-mac.yml",
        "latest-linux-arm64.yml",
        "nightly-mac.yml",
        "nightly-linux.yml",
        "builder-debug.yml",
        "app-update.yml",
        "latest-mac.yml.blockmap",
        "SHA256SUMS",
      ].map(isUpdaterManifestName),
      [true, true, true, true, true, false, false, false, false],
    );
  });
});

describe("newerPublishedNightlyTag", () => {
  const tag = "v0.0.44-nightly.20261002.1602";

  it("finds a published nightly with a higher run number", () => {
    assert.equal(
      newerPublishedNightlyTag(tag, [
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1601" },
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1603" },
      ]),
      "v0.0.44-nightly.20261002.1603",
    );
  });

  it("orders by date before run number and by version before date", () => {
    assert.equal(
      newerPublishedNightlyTag(tag, [{ draft: false, tag_name: "v0.0.44-nightly.20261003.7" }]),
      "v0.0.44-nightly.20261003.7",
    );
    assert.equal(
      newerPublishedNightlyTag(tag, [{ draft: false, tag_name: "v0.0.45-nightly.20260901.1" }]),
      "v0.0.45-nightly.20260901.1",
    );
    assert.equal(
      newerPublishedNightlyTag(tag, [{ draft: false, tag_name: "v0.0.43-nightly.20261009.9999" }]),
      undefined,
    );
  });

  it("returns the newest when several are newer", () => {
    assert.equal(
      newerPublishedNightlyTag(tag, [
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1604" },
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1606" },
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1605" },
      ]),
      "v0.0.44-nightly.20261002.1606",
    );
  });

  it("ignores older, equal, draft, stable, and preview releases", () => {
    assert.equal(
      newerPublishedNightlyTag(tag, [
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1601" },
        { draft: false, tag_name: tag },
        { draft: true, tag_name: "v0.0.44-nightly.20261002.1603" },
        { draft: false, tag_name: "v0.0.45" },
        { draft: false, tag_name: "v0.0.45-preview.20261002.1700" },
      ]),
      undefined,
    );
  });

  it("does not guard a tag that is not a nightly", () => {
    assert.equal(
      newerPublishedNightlyTag("v0.0.45", [
        { draft: false, tag_name: "v0.0.44-nightly.20261002.1603" },
      ]),
      undefined,
    );
  });
});

describe("findMissingUpdaterFeedProblems", () => {
  const nightlyFeeds = [
    manifest("nightly-mac.yml", MERGED_NIGHTLY_MAC_MANIFEST),
    manifest("nightly-linux.yml", NIGHTLY_LINUX_MANIFEST),
    manifest("nightly-linux-arm64.yml", NIGHTLY_LINUX_ARM64_MANIFEST),
  ];

  it("accepts a nightly carrying every platform's feed and both macOS update zips", () => {
    assert.deepStrictEqual(
      findMissingUpdaterFeedProblems("v0.0.44-nightly.20261005.1694", nightlyFeeds),
      [],
    );
  });

  it("names each nightly feed the build did not produce", () => {
    assert.deepStrictEqual(
      findMissingUpdaterFeedProblems("v0.0.44-nightly.20261005.1694", [nightlyFeeds[0]!]),
      [
        "nightly-linux.yml, the Linux x64 updater feed, was not produced by this build",
        "nightly-linux-arm64.yml, the Linux arm64 updater feed, was not produced by this build",
      ],
    );
  });

  it("names the macOS feed when only the unmerged per-arch manifest exists", () => {
    assert.deepStrictEqual(
      findMissingUpdaterFeedProblems("v0.0.44-nightly.20261005.1694", [
        manifest("nightly-mac-x64.yml", INTEL_ONLY_NIGHTLY_MAC_MANIFEST),
        nightlyFeeds[1]!,
        nightlyFeeds[2]!,
      ]),
      ["nightly-mac.yml, the macOS updater feed, was not produced by this build"],
    );
  });

  it("requires the latest feeds, not the nightly ones, on a stable release", () => {
    assert.deepStrictEqual(findMissingUpdaterFeedProblems("v0.0.45", nightlyFeeds), [
      "latest-mac.yml, the macOS updater feed, was not produced by this build",
      "latest-linux.yml, the Linux x64 updater feed, was not produced by this build",
      "latest-linux-arm64.yml, the Linux arm64 updater feed, was not produced by this build",
    ]);
    assert.deepStrictEqual(
      findMissingUpdaterFeedProblems("v0.0.45-rc.1", [
        manifest("latest-mac.yml", MERGED_NIGHTLY_MAC_MANIFEST),
        manifest("latest-linux.yml", NIGHTLY_LINUX_MANIFEST),
        manifest("latest-linux-arm64.yml", NIGHTLY_LINUX_ARM64_MANIFEST),
      ]),
      [],
    );
  });

  it("names the macOS architecture whose update zip the mac feed lacks", () => {
    assert.deepStrictEqual(
      findMissingUpdaterFeedProblems("v0.0.44-nightly.20261002.1602", [
        manifest("nightly-mac.yml", NIGHTLY_MAC_MANIFEST),
        nightlyFeeds[1]!,
        nightlyFeeds[2]!,
      ]),
      ["nightly-mac.yml does not name Kata-Code-macOS-Intel.zip, the Intel (x64) update zip"],
    );
    assert.deepStrictEqual(
      findMissingUpdaterFeedProblems("v0.0.44-nightly.20261005.1694", [
        manifest("nightly-mac.yml", INTEL_ONLY_NIGHTLY_MAC_MANIFEST),
        nightlyFeeds[1]!,
        nightlyFeeds[2]!,
      ]),
      [
        "nightly-mac.yml does not name Kata-Code-macOS-Apple-Silicon-arm64.zip, the Apple Silicon (arm64) update zip",
      ],
    );
  });

  it("requires no feed on a preview release", () => {
    assert.deepStrictEqual(findMissingUpdaterFeedProblems("v0.0.45-preview.20261005.1700", []), []);
  });
});

describe("findIncompleteReleaseProblems", () => {
  const localSizes = new Map([
    ["nightly-mac.yml", 733],
    ["Kata-Code-macOS-Apple-Silicon-arm64.zip", 152111146],
    ["Kata-Code-macOS-Apple-Silicon.dmg", 157786161],
  ]);
  const manifests = [manifest("nightly-mac.yml", NIGHTLY_MAC_MANIFEST)];

  it("accepts a release holding the manifest and every file it names", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes,
        assets: [
          { name: "nightly-mac.yml", state: "uploaded", size: 733 },
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 152111146 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 157786161 },
        ],
      }),
      [],
    );
  });

  it("reports the state of the interrupted run: manifest uploaded, binaries missing", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes,
        assets: [{ name: "nightly-mac.yml", state: "uploaded", size: 733 }],
      }),
      [
        "Kata-Code-macOS-Apple-Silicon-arm64.zip, which nightly-mac.yml references, is not on the release",
        "Kata-Code-macOS-Apple-Silicon.dmg, which nightly-mac.yml references, is not on the release",
      ],
    );
  });

  it("reports a manifest that was never uploaded", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes,
        assets: [
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 152111146 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 157786161 },
        ],
      }),
      ["nightly-mac.yml is not on the release"],
    );
  });

  it("reports an asset still uploading and one of the wrong size", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes,
        assets: [
          { name: "nightly-mac.yml", state: "uploaded", size: 733 },
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "starter", size: 0 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 100 },
        ],
      }),
      [
        "Kata-Code-macOS-Apple-Silicon-arm64.zip is starter, not uploaded",
        "Kata-Code-macOS-Apple-Silicon-arm64.zip is 0 bytes on the release, 152111146 built",
        "Kata-Code-macOS-Apple-Silicon.dmg is 100 bytes on the release, 157786161 built",
      ],
    );
  });

  it("requires the blockmap of a named file when this build produced one", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes: new Map([
          ...localSizes,
          ["Kata-Code-macOS-Apple-Silicon.dmg.blockmap", 166366],
        ]),
        assets: [
          { name: "nightly-mac.yml", state: "uploaded", size: 733 },
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 152111146 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 157786161 },
        ],
      }),
      [
        "Kata-Code-macOS-Apple-Silicon.dmg.blockmap, the blockmap of Kata-Code-macOS-Apple-Silicon.dmg, is not on the release",
      ],
    );
  });

  it("checks the blockmap's size and does not require one the build never produced", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes: new Map([
          ...localSizes,
          ["Kata-Code-macOS-Apple-Silicon.dmg.blockmap", 166366],
        ]),
        assets: [
          { name: "nightly-mac.yml", state: "uploaded", size: 733 },
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 152111146 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 157786161 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg.blockmap", state: "uploaded", size: 10 },
        ],
      }),
      ["Kata-Code-macOS-Apple-Silicon.dmg.blockmap is 10 bytes on the release, 166366 built"],
    );
  });

  it("does not let a stale asset from an earlier attempt stand in for a file this build lacks", () => {
    const withoutDmg = new Map(localSizes);
    withoutDmg.delete("Kata-Code-macOS-Apple-Silicon.dmg");
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes: withoutDmg,
        assets: [
          { name: "nightly-mac.yml", state: "uploaded", size: 733 },
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 152111146 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 157786161 },
        ],
      }),
      [
        "Kata-Code-macOS-Apple-Silicon.dmg, which nightly-mac.yml references, was not produced by this build",
      ],
    );
  });

  it("reads a Linux manifest: file entries with blockMapSize, and its path, checked once", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests: [manifest("nightly-linux.yml", NIGHTLY_LINUX_MANIFEST)],
        localSizes: new Map([
          ["nightly-linux.yml", 397],
          ["Kata-Code-Linux-x64.AppImage", 174987455],
        ]),
        assets: [{ name: "nightly-linux.yml", state: "uploaded", size: 397 }],
      }),
      ["Kata-Code-Linux-x64.AppImage, which nightly-linux.yml references, is not on the release"],
    );
  });

  it("rejects assets left on a reused draft that this build did not produce", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests,
        localSizes,
        assets: [
          { name: "nightly-mac.yml", state: "uploaded", size: 733 },
          { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 152111146 },
          { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 157786161 },
          { name: "nightly-linux.yml", state: "uploaded", size: 397 },
          { name: "Kata-Code-Linux-x64.AppImage", state: "uploaded", size: 174987455 },
        ],
      }),
      [
        "nightly-linux.yml is on the release but was not produced by this build",
        "Kata-Code-Linux-x64.AppImage is on the release but was not produced by this build",
      ],
    );
  });

  it("has nothing to check on a release without updater manifests", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests: [],
        localSizes: new Map([["SHA256SUMS", 368]]),
        assets: [{ name: "SHA256SUMS", state: "uploaded", size: 368 }],
      }),
      [],
    );
  });
});

interface FakeRelease {
  draft: boolean;
  tag: string;
  assets: Array<{ name: string; state: string; size: number }>;
  /** Every other release in the repository, newest first. */
  others: Array<{ draft: boolean; tag_name: string }>;
  readonly patches: Array<unknown>;
}

const RELEASE_PATH = "/repos/gannonh/kata-code/releases/42";

const page = <A>(all: ReadonlyArray<A>, url: URL): ReadonlyArray<A> => {
  const number = Number(url.searchParams.get("page"));
  return all.slice((number - 1) * 100, number * 100);
};

const serveFakeGitHub = (release: FakeRelease) =>
  HttpRouter.serve(
    HttpRouter.add(
      "*",
      "*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "http://github.test");
        const htmlUrl = `https://github.com/gannonh/kata-code/releases/tag/${release.tag}`;
        const body = () => ({ draft: release.draft, html_url: htmlUrl, tag_name: release.tag });
        if (request.method === "GET" && url.pathname === RELEASE_PATH) {
          return HttpServerResponse.jsonUnsafe(body());
        }
        if (request.method === "GET" && url.pathname === `${RELEASE_PATH}/assets`) {
          return HttpServerResponse.jsonUnsafe(page(release.assets, url));
        }
        if (request.method === "GET" && url.pathname === "/repos/gannonh/kata-code/releases") {
          return HttpServerResponse.jsonUnsafe(
            page([{ draft: release.draft, tag_name: release.tag }, ...release.others], url),
          );
        }
        if (request.method === "PATCH" && url.pathname === RELEASE_PATH) {
          release.patches.push(yield* request.json);
          release.draft = false;
          return HttpServerResponse.jsonUnsafe(body());
        }
        return HttpServerResponse.text("Not Found", { status: 404 });
      }),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it.layer(NodeServices.layer)("publishGitHubRelease", (it) => {
  const releaseFiles = (feed: "nightly" | "latest"): Record<string, string> => ({
    [`${feed}-mac.yml`]: MERGED_NIGHTLY_MAC_MANIFEST,
    [`${feed}-linux.yml`]: NIGHTLY_LINUX_MANIFEST,
    [`${feed}-linux-arm64.yml`]: NIGHTLY_LINUX_ARM64_MANIFEST,
    "Kata-Code-macOS-Apple-Silicon-arm64.zip": "zip",
    "Kata-Code-macOS-Apple-Silicon.dmg": "dmg!",
    "Kata-Code-macOS-Intel.zip": "intel zip",
    "Kata-Code-macOS-Intel.dmg": "intel dmg",
    "Kata-Code-Linux-x64.AppImage": "x64 AppImage",
    "Kata-Code-Linux-arm64.AppImage": "arm64 AppImage",
  });
  const writeDist = (files: Record<string, string>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const distDir = yield* fs.makeTempDirectoryScoped({ prefix: "publish-github-release-" });
      for (const [name, content] of Object.entries({
        ...files,
        "release-body.md": "notes",
        "builder-debug.yml": "not: [a manifest",
      })) {
        yield* fs.writeFileString(path.join(distDir, name), content);
      }
      return distDir;
    });
  const uploaded = (files: Record<string, string>) =>
    Object.entries(files).map(([name, content]) => ({
      name,
      state: "uploaded",
      size: new TextEncoder().encode(content).length,
    }));
  const completeAssets = uploaded(releaseFiles("nightly"));
  const draft = (overrides: Partial<FakeRelease> = {}): FakeRelease => ({
    draft: true,
    tag: "v0.0.44-nightly.20261002.1602",
    assets: completeAssets,
    others: [],
    patches: [],
    ...overrides,
  });
  const publish = (distDir: string, makeLatest: "true" | "false" = "false") =>
    publishGitHubRelease({
      repository: "gannonh/kata-code",
      releaseId: 42,
      distDir,
      makeLatest,
    });

  it.effect("publishes a draft whose manifest files are all uploaded", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const release = draft();

      yield* publish(distDir).pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "false" }]);
      assert.equal(release.draft, false);
    }),
  );

  it.effect("sends make_latest through for a stable release", () =>
    Effect.gen(function* () {
      const files = releaseFiles("latest");
      const distDir = yield* writeDist(files);
      const release = draft({ tag: "v0.0.45", assets: uploaded(files) });

      yield* publish(distDir, "true").pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "true" }]);
    }),
  );

  it.effect("leaves the release a draft when a binary the manifest names is missing", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const release = draft({
        assets: completeAssets.filter(
          (asset) => asset.name !== "Kata-Code-macOS-Apple-Silicon-arm64.zip",
        ),
      });

      const error = yield* publish(distDir).pipe(
        Effect.provide(serveFakeGitHub(release)),
        Effect.flip,
      );

      if (error._tag !== "DraftReleaseIncompleteError") {
        assert.fail(`Expected DraftReleaseIncompleteError, got ${error._tag}`);
      }
      assert.deepStrictEqual(error.problems, [
        "Kata-Code-macOS-Apple-Silicon-arm64.zip, which nightly-mac.yml references, is not on the release",
      ]);
      assert.deepStrictEqual(release.patches, []);
      assert.equal(release.draft, true);
    }),
  );

  it.effect("leaves the release a draft while an upload is still open", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const release = draft({
        assets: completeAssets.map((asset) =>
          asset.name === "Kata-Code-macOS-Apple-Silicon.dmg"
            ? { ...asset, state: "open", size: 1 }
            : asset,
        ),
      });

      const error = yield* publish(distDir).pipe(
        Effect.provide(serveFakeGitHub(release)),
        Effect.flip,
      );

      if (error._tag !== "DraftReleaseIncompleteError") {
        assert.fail(`Expected DraftReleaseIncompleteError, got ${error._tag}`);
      }
      assert.deepStrictEqual(error.problems, [
        "Kata-Code-macOS-Apple-Silicon.dmg is open, not uploaded",
        "Kata-Code-macOS-Apple-Silicon.dmg is 1 bytes on the release, 4 built",
      ]);
      assert.deepStrictEqual(release.patches, []);
    }),
  );

  it.effect("leaves a nightly a draft when a Linux job built its AppImage but no feed", () =>
    Effect.gen(function* () {
      const { "nightly-linux-arm64.yml": _feed, ...files } = releaseFiles("nightly");
      const distDir = yield* writeDist(files);
      const release = draft({ assets: uploaded(files) });

      const error = yield* publish(distDir).pipe(
        Effect.provide(serveFakeGitHub(release)),
        Effect.flip,
      );

      if (error._tag !== "DraftReleaseIncompleteError") {
        assert.fail(`Expected DraftReleaseIncompleteError, got ${error._tag}`);
      }
      assert.equal(
        error.message,
        "Release 42 stays a draft:\n  - nightly-linux-arm64.yml, the Linux arm64 updater feed, was not produced by this build",
      );
      assert.deepStrictEqual(release.patches, []);
      assert.equal(release.draft, true);
    }),
  );

  it.effect("leaves a stable release a draft when its mac feed lacks the Intel update zip", () =>
    Effect.gen(function* () {
      const files = { ...releaseFiles("latest"), "latest-mac.yml": NIGHTLY_MAC_MANIFEST };
      const distDir = yield* writeDist(files);
      const release = draft({
        tag: "v0.0.45",
        assets: uploaded(files).filter(
          (asset) =>
            asset.name !== "Kata-Code-macOS-Intel.zip" &&
            asset.name !== "Kata-Code-macOS-Intel.dmg",
        ),
      });

      const error = yield* publish(distDir, "true").pipe(
        Effect.provide(serveFakeGitHub(release)),
        Effect.flip,
      );

      if (error._tag !== "DraftReleaseIncompleteError") {
        assert.fail(`Expected DraftReleaseIncompleteError, got ${error._tag}`);
      }
      assert.deepStrictEqual(error.problems, [
        "latest-mac.yml does not name Kata-Code-macOS-Intel.zip, the Intel (x64) update zip",
      ]);
      assert.deepStrictEqual(release.patches, []);
      assert.equal(release.draft, true);
    }),
  );

  it.effect("publishes a preview release, which carries no feeds", () =>
    Effect.gen(function* () {
      const files = {
        "Kata-Code-macOS-Apple-Silicon.dmg": "dmg!",
        "Kata-Code-Linux-x64.AppImage": "x64 AppImage",
        SHA256SUMS: "sums",
      };
      const distDir = yield* writeDist(files);
      const release = draft({ tag: "v0.0.45-preview.20261005.1700", assets: uploaded(files) });

      yield* publish(distDir).pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "false" }]);
    }),
  );

  it.effect("refuses to publish a nightly older than one that is already published", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const release = draft({
        others: [
          { draft: false, tag_name: "v0.0.44-nightly.20261002.1603" },
          { draft: false, tag_name: "v0.0.44-nightly.20261001.1560" },
        ],
      });

      const error = yield* publish(distDir).pipe(
        Effect.provide(serveFakeGitHub(release)),
        Effect.flip,
      );

      if (error._tag !== "StaleNightlyDraftError") {
        assert.fail(`Expected StaleNightlyDraftError, got ${error._tag}`);
      }
      assert.equal(
        error.message,
        "Release 42 (v0.0.44-nightly.20261002.1602) stays a draft: v0.0.44-nightly.20261002.1603 is already published and newer, and publishing this one now would make it the newest nightly. Delete the draft.",
      );
      assert.deepStrictEqual(release.patches, []);
      assert.equal(release.draft, true);
    }),
  );

  it.effect("finds the newer nightly beyond the first page of releases", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const stable = Array.from({ length: 100 }, (_, index) => ({
        draft: false,
        tag_name: `v0.0.${index}`,
      }));
      const release = draft({
        others: [...stable, { draft: false, tag_name: "v0.0.44-nightly.20261002.1700" }],
      });

      const error = yield* publish(distDir).pipe(
        Effect.provide(serveFakeGitHub(release)),
        Effect.flip,
      );

      assert.equal(error._tag, "StaleNightlyDraftError");
      assert.deepStrictEqual(release.patches, []);
    }),
  );

  it.effect("publishes a nightly when only older nightlies and newer drafts exist", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const release = draft({
        others: [
          { draft: true, tag_name: "v0.0.44-nightly.20261002.1700" },
          { draft: false, tag_name: "v0.0.44-nightly.20261002.1601" },
        ],
      });

      yield* publish(distDir).pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "false" }]);
    }),
  );

  it.effect("publishes a stable draft even when a newer nightly is published", () =>
    Effect.gen(function* () {
      const files = releaseFiles("latest");
      const distDir = yield* writeDist(files);
      const release = draft({
        tag: "v0.0.45",
        assets: uploaded(files),
        others: [{ draft: false, tag_name: "v0.0.45-nightly.20261003.1" }],
      });

      yield* publish(distDir, "true").pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "true" }]);
    }),
  );

  it.effect("does nothing to a release that is already published", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist(releaseFiles("nightly"));
      const release = draft({ draft: false, assets: [] });

      yield* publish(distDir, "true").pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, []);
    }),
  );
});
