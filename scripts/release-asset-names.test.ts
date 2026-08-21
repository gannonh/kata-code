import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  buildInstallerRenameMap,
  buildInstallerRenameRules,
  prepareReleaseAssets,
  renderReleaseBody,
  rewriteManifestContent,
  suggestReleaseFileName,
} from "./release-asset-names.ts";

const VERSION = "1.2.3";

describe("release-asset-names / suggestReleaseFileName", () => {
  it("renames macOS arm64 installers and blockmaps to Apple Silicon names", () => {
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-arm64.dmg", VERSION),
      "Kata-Code-macOS-Apple-Silicon.dmg",
    );
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-arm64.dmg.blockmap", VERSION),
      "Kata-Code-macOS-Apple-Silicon.dmg.blockmap",
    );
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-arm64.zip", VERSION),
      "Kata-Code-macOS-Apple-Silicon.zip",
    );
  });

  it("renames macOS x64 installers to Intel names", () => {
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-x64.dmg", VERSION),
      "Kata-Code-macOS-Intel.dmg",
    );
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-x64.zip.blockmap", VERSION),
      "Kata-Code-macOS-Intel.zip.blockmap",
    );
  });

  it("renames Linux AppImage and deb artifacts by arch", () => {
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-x64.AppImage", VERSION),
      "Kata-Code-Linux-x64.AppImage",
    );
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-arm64.deb", VERSION),
      "Kata-Code-Linux-arm64.deb",
    );
  });

  it("renames Windows NSIS installers and blockmaps by arch", () => {
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-x64.exe", VERSION),
      "Kata-Code-Windows-x64.exe",
    );
    assert.equal(
      suggestReleaseFileName("Kata-Code-1.2.3-arm64.exe.blockmap", VERSION),
      "Kata-Code-Windows-arm64.exe.blockmap",
    );
  });

  it("escapes regex metacharacters in the version before matching", () => {
    // A version with a `+` prerelease segment must not be treated as a regex
    // quantifier and must still match its installer.
    const pre = "1.2.3-beta.4+build.9";
    assert.equal(
      suggestReleaseFileName(`Kata-Code-${pre}-arm64.dmg`, pre),
      "Kata-Code-macOS-Apple-Silicon.dmg",
    );
  });

  it("returns null for non-installer files like updater manifests", () => {
    assert.isNull(suggestReleaseFileName("latest-mac.yml", VERSION));
    assert.isNull(suggestReleaseFileName("builder-debug.yml", VERSION));
    assert.isNull(suggestReleaseFileName("release-body.md", VERSION));
  });

  it("only matches the configured version, not an unrelated version in the name", () => {
    // A stale artifact from a different version should not be renamed when
    // preparing a release for VERSION.
    assert.isNull(suggestReleaseFileName("Kata-Code-1.2.2-arm64.dmg", VERSION));
  });
});

describe("release-asset-names / buildInstallerRenameMap", () => {
  it("maps every recognized installer and skips the rest", () => {
    const names = [
      "Kata-Code-1.2.3-arm64.dmg",
      "Kata-Code-1.2.3-arm64.dmg.blockmap",
      "Kata-Code-1.2.3-x64.AppImage",
      "latest-mac.yml",
      "builder-debug.yml",
    ];
    const map = buildInstallerRenameMap(names, VERSION);
    assert.deepEqual(
      [...map.keys()],
      [
        "Kata-Code-1.2.3-arm64.dmg",
        "Kata-Code-1.2.3-arm64.dmg.blockmap",
        "Kata-Code-1.2.3-x64.AppImage",
      ],
    );
    assert.equal(map.get("Kata-Code-1.2.3-arm64.dmg"), "Kata-Code-macOS-Apple-Silicon.dmg");
    assert.equal(map.get("Kata-Code-1.2.3-x64.AppImage"), "Kata-Code-Linux-x64.AppImage");
  });
});

describe("release-asset-names / rewriteManifestContent", () => {
  it("replaces every renamed file reference inside manifest text", () => {
    const renameMap = new Map([
      ["Kata-Code-1.2.3-arm64.dmg", "Kata-Code-macOS-Apple-Silicon.dmg"],
      ["Kata-Code-1.2.3-arm64.zip", "Kata-Code-macOS-Apple-Silicon.zip"],
    ]);
    const manifest = [
      "version: 1.2.3",
      "files:",
      "  - url: Kata-Code-1.2.3-arm64.zip",
      "    sha512: ziphash",
      "    size: 125621344",
      "  - url: Kata-Code-1.2.3-arm64.dmg",
      "    sha512: dmghash",
      "    size: 131754935",
      "path: Kata-Code-1.2.3-arm64.zip",
      "sha512: ziphash",
      "releaseDate: '2026-06-23T00:00:00Z'",
      "",
    ].join("\n");

    const rewritten = rewriteManifestContent(manifest, renameMap);
    assert.ok(rewritten.includes("Kata-Code-macOS-Apple-Silicon.zip"));
    assert.ok(rewritten.includes("Kata-Code-macOS-Apple-Silicon.dmg"));
    assert.ok(!rewritten.includes("Kata-Code-1.2.3-arm64.zip"));
    assert.ok(!rewritten.includes("Kata-Code-1.2.3-arm64.dmg"));
    // path: field is rewritten too, not just url: fields.
    assert.ok(rewritten.startsWith("path: Kata-Code-macOS-Apple-Silicon.zip") === false);
    assert.ok(rewritten.includes("path: Kata-Code-macOS-Apple-Silicon.zip"));
  });
});

describe("release-asset-names / renderReleaseBody", () => {
  it("renders download links for every present platform and em-dashes for missing ones", () => {
    const body = renderReleaseBody({
      version: VERSION,
      tag: "v1.2.3",
      repository: "gannonh/kata-code",
      fileNames: [
        "Kata-Code-macOS-Apple-Silicon.dmg",
        "Kata-Code-macOS-Intel.dmg",
        "Kata-Code-Linux-x64.AppImage",
        "Kata-Code-Windows-x64.exe",
        "latest-mac.yml",
      ],
    });

    const expectedAppleDmg =
      "https://github.com/gannonh/kata-code/releases/download/v1.2.3/Kata-Code-macOS-Apple-Silicon.dmg";
    const expectedLinux =
      "https://github.com/gannonh/kata-code/releases/download/v1.2.3/Kata-Code-Linux-x64.AppImage";
    const expectedWindows =
      "https://github.com/gannonh/kata-code/releases/download/v1.2.3/Kata-Code-Windows-x64.exe";

    assert.ok(body.includes(`## Kata Code ${VERSION}`));
    assert.ok(body.includes(`[Download](${expectedAppleDmg})`));
    assert.ok(body.includes(`[Download](${expectedLinux})`));
    assert.ok(body.includes(`[Download](${expectedWindows})`));
    // Missing assets render as em-dash placeholders, not links.
    assert.ok(body.includes("| Auto-update (.zip) | — | — |"));
    assert.ok(body.includes("| Debian (.deb) | — | — |"));
    assert.ok(body.includes("| Installer (.exe) | [Download]"));
  });
});

describe("release-asset-names / buildInstallerRenameRules", () => {
  it("escapes regex metacharacters so a dot-separated version matches literally", () => {
    // The rules must not let `.` in the version match arbitrary characters,
    // otherwise `Kata-Code-1A2B3-arm64.dmg` would be mis-matched.
    const rules = buildInstallerRenameRules("1.2.3");
    const match = (name: string) => rules.some((rule) => rule.pattern.test(name));
    assert.isTrue(match("Kata-Code-1.2.3-arm64.dmg"));
    assert.isFalse(match("Kata-Code-1A2B3-arm64.dmg"));
  });
});

it.layer(NodeServices.layer)("release-asset-names / prepareReleaseAssets", (it) => {
  it.effect(
    "renames installers, rewrites manifests, drops debug files, and writes release-body.md",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const distDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "kata-release-assets-",
        });

        const arm64Dmg = "Kata-Code-1.2.3-arm64.dmg";
        const arm64DmgBlockmap = "Kata-Code-1.2.3-arm64.dmg.blockmap";
        const arm64Zip = "Kata-Code-1.2.3-arm64.zip";
        const x64AppImage = "Kata-Code-1.2.3-x64.AppImage";
        const x64Exe = "Kata-Code-1.2.3-x64.exe";
        const macManifest = "latest-mac.yml";

        const writeManifest = () =>
          [
            "version: 1.2.3",
            "files:",
            "  - url: Kata-Code-1.2.3-arm64.zip",
            "    sha512: ziphash",
            "    size: 125621344",
            "  - url: Kata-Code-1.2.3-arm64.dmg",
            "    sha512: dmghash",
            "    size: 131754935",
            "path: Kata-Code-1.2.3-arm64.zip",
            "sha512: ziphash",
            "releaseDate: '2026-06-23T00:00:00Z'",
            "",
          ].join("\n");

        yield* fileSystem.writeFileString(path.join(distDir, arm64Dmg), "dmg");
        yield* fileSystem.writeFileString(path.join(distDir, arm64DmgBlockmap), "blockmap");
        yield* fileSystem.writeFileString(path.join(distDir, arm64Zip), "zip");
        yield* fileSystem.writeFileString(path.join(distDir, x64AppImage), "appimage");
        yield* fileSystem.writeFileString(path.join(distDir, x64Exe), "exe");
        yield* fileSystem.writeFileString(path.join(distDir, macManifest), writeManifest());
        yield* fileSystem.writeFileString(path.join(distDir, "builder-debug.yml"), "debug: true\n");
        yield* fileSystem.writeFileString(
          path.join(distDir, "builder-effective-config.yaml"),
          "config: true\n",
        );

        const result = yield* prepareReleaseAssets({
          distDir,
          repository: "gannonh/kata-code",
          tag: "v1.2.3",
          version: VERSION,
        });

        // Installers renamed to friendly names.
        assert.ok(result.fileNames.includes("Kata-Code-macOS-Apple-Silicon.dmg"));
        assert.ok(result.fileNames.includes("Kata-Code-macOS-Apple-Silicon.dmg.blockmap"));
        assert.ok(result.fileNames.includes("Kata-Code-macOS-Apple-Silicon.zip"));
        assert.ok(result.fileNames.includes("Kata-Code-Linux-x64.AppImage"));
        assert.ok(result.fileNames.includes("Kata-Code-Windows-x64.exe"));

        // Version-encoded installer names are gone.
        assert.isFalse(result.fileNames.includes(arm64Dmg));
        assert.isFalse(result.fileNames.includes(x64AppImage));
        assert.isFalse(result.fileNames.includes(x64Exe));

        // Manifest contents rewritten to reference the new names.
        const rewrittenManifest = yield* fileSystem.readFileString(path.join(distDir, macManifest));
        assert.ok(rewrittenManifest.includes("Kata-Code-macOS-Apple-Silicon.zip"));
        assert.ok(rewrittenManifest.includes("Kata-Code-macOS-Apple-Silicon.dmg"));
        assert.ok(!rewrittenManifest.includes("Kata-Code-1.2.3-arm64.zip"));
        assert.ok(!rewrittenManifest.includes("Kata-Code-1.2.3-arm64.dmg"));

        // Debug artifacts removed.
        const exists = (name: string) =>
          fileSystem.exists(path.join(distDir, name)).pipe(Effect.orElseSucceed(() => false));
        assert.isFalse(yield* exists("builder-debug.yml"));
        assert.isFalse(yield* exists("builder-effective-config.yaml"));

        // Release body written and references the new asset names.
        const body = yield* fileSystem.readFileString(result.bodyPath);
        assert.ok(body.includes("## Kata Code 1.2.3"));
        assert.ok(
          body.includes(
            "https://github.com/gannonh/kata-code/releases/download/v1.2.3/Kata-Code-macOS-Apple-Silicon.dmg",
          ),
        );
      }),
  );
});
