import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  findIncompleteReleaseProblems,
  manifestReferences,
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

describe("manifestReferences", () => {
  it("lists every file entry and the top-level path once", () => {
    assert.deepStrictEqual(manifestReferences(NIGHTLY_MAC_MANIFEST), [
      "Kata-Code-macOS-Apple-Silicon-arm64.zip",
      "Kata-Code-macOS-Apple-Silicon.dmg",
    ]);
    assert.deepStrictEqual(manifestReferences(NIGHTLY_LINUX_MANIFEST), [
      "Kata-Code-Linux-x64.AppImage",
    ]);
  });

  it("strips quotes around a name", () => {
    assert.deepStrictEqual(
      manifestReferences(`files:\n  - url: 'A b.zip'\n    size: 1\npath: "A b.zip"\n`),
      ["A b.zip"],
    );
  });
});

describe("findIncompleteReleaseProblems", () => {
  const localSizes = new Map([
    ["nightly-mac.yml", 733],
    ["Kata-Code-macOS-Apple-Silicon-arm64.zip", 152111146],
    ["Kata-Code-macOS-Apple-Silicon.dmg", 157786161],
  ]);
  const manifests = [{ name: "nightly-mac.yml", text: NIGHTLY_MAC_MANIFEST }];

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

  it("has nothing to check on a release without updater manifests", () => {
    assert.deepStrictEqual(
      findIncompleteReleaseProblems({
        manifests: [],
        localSizes: new Map(),
        assets: [{ name: "SHA256SUMS", state: "uploaded", size: 368 }],
      }),
      [],
    );
  });
});

interface FakeRelease {
  draft: boolean;
  assets: Array<{ name: string; state: string; size: number }>;
  readonly patches: Array<unknown>;
}

const RELEASE_PATH = "/repos/gannonh/kata-code/releases/42";

const serveFakeGitHub = (release: FakeRelease) =>
  HttpRouter.serve(
    HttpRouter.add(
      "*",
      "*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "http://github.test");
        const htmlUrl = "https://github.com/gannonh/kata-code/releases/tag/v1";
        if (request.method === "GET" && url.pathname === RELEASE_PATH) {
          return HttpServerResponse.jsonUnsafe({ draft: release.draft, html_url: htmlUrl });
        }
        if (request.method === "GET" && url.pathname === `${RELEASE_PATH}/assets`) {
          return HttpServerResponse.jsonUnsafe(
            url.searchParams.get("page") === "1" ? release.assets : [],
          );
        }
        if (request.method === "PATCH" && url.pathname === RELEASE_PATH) {
          release.patches.push(yield* request.json);
          release.draft = false;
          return HttpServerResponse.jsonUnsafe({ draft: false, html_url: htmlUrl });
        }
        return HttpServerResponse.text("Not Found", { status: 404 });
      }),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it.layer(NodeServices.layer)("publishGitHubRelease", (it) => {
  const writeDist = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const distDir = yield* fs.makeTempDirectoryScoped({ prefix: "publish-github-release-" });
    yield* fs.writeFileString(path.join(distDir, "nightly-mac.yml"), NIGHTLY_MAC_MANIFEST);
    yield* fs.writeFileString(path.join(distDir, "Kata-Code-macOS-Apple-Silicon-arm64.zip"), "zip");
    yield* fs.writeFileString(path.join(distDir, "Kata-Code-macOS-Apple-Silicon.dmg"), "dmg!");
    yield* fs.writeFileString(path.join(distDir, "release-body.md"), "notes");
    return distDir;
  });
  const manifestSize = new TextEncoder().encode(NIGHTLY_MAC_MANIFEST).length;
  const completeAssets = [
    { name: "nightly-mac.yml", state: "uploaded", size: manifestSize },
    { name: "Kata-Code-macOS-Apple-Silicon-arm64.zip", state: "uploaded", size: 3 },
    { name: "Kata-Code-macOS-Apple-Silicon.dmg", state: "uploaded", size: 4 },
  ];
  const publish = (distDir: string, makeLatest: "true" | "false" = "false") =>
    publishGitHubRelease({
      repository: "gannonh/kata-code",
      releaseId: 42,
      distDir,
      makeLatest,
    });

  it.effect("publishes a draft whose manifest files are all uploaded", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist;
      const release: FakeRelease = { draft: true, assets: completeAssets, patches: [] };

      yield* publish(distDir).pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "false" }]);
      assert.equal(release.draft, false);
    }),
  );

  it.effect("sends make_latest through for a stable release", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist;
      const release: FakeRelease = { draft: true, assets: completeAssets, patches: [] };

      yield* publish(distDir, "true").pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, [{ draft: false, make_latest: "true" }]);
    }),
  );

  it.effect("leaves the release a draft when a binary the manifest names is missing", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist;
      const release: FakeRelease = {
        draft: true,
        assets: [
          completeAssets[0]!,
          { ...completeAssets[2]!, name: "Kata-Code-macOS-Apple-Silicon.dmg" },
        ],
        patches: [],
      };

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
      const distDir = yield* writeDist;
      const release: FakeRelease = {
        draft: true,
        assets: [
          completeAssets[0]!,
          completeAssets[1]!,
          { ...completeAssets[2]!, state: "open", size: 1 },
        ],
        patches: [],
      };

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

  it.effect("does nothing to a release that is already published", () =>
    Effect.gen(function* () {
      const distDir = yield* writeDist;
      const release: FakeRelease = { draft: false, assets: [], patches: [] };

      yield* publish(distDir, "true").pipe(Effect.provide(serveFakeGitHub(release)));

      assert.deepStrictEqual(release.patches, []);
    }),
  );
});
