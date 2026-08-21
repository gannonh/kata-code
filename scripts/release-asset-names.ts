import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * Release asset naming for Kata Code desktop builds.
 *
 * electron-builder emits version-encoded names (`Kata-Code-${version}-${arch}.${ext}`).
 * GitHub release downloads are nicer and stable across versions when named by
 * platform + arch (`Kata-Code-macOS-Apple-Silicon.dmg`). These rules rename the
 * installers, rewrite updater manifest `url`/`path` references to match, and
 * render a per-platform download table for the GitHub release body.
 */

export interface RenameRule {
  /** Matches the original (version-encoded) file name. */
  readonly pattern: RegExp;
  /** Replacement template; `$1` carries the optional `.blockmap` suffix. */
  readonly replace: string;
}

/** Escapes regex metacharacters in a release version before interpolation. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the rename rules for a given release version. The version is embedded
 * in the source names, so it must be escaped before regex interpolation.
 */
export function buildInstallerRenameRules(version: string): ReadonlyArray<RenameRule> {
  const prefix = `Kata-Code-${escapeRegExp(version)}`;
  return [
    // macOS — arm64 (Apple Silicon)
    {
      pattern: new RegExp(`^${prefix}-arm64\\.dmg(\\.blockmap)?$`),
      replace: "Kata-Code-macOS-Apple-Silicon.dmg$1",
    },
    {
      pattern: new RegExp(`^${prefix}-arm64\\.zip(\\.blockmap)?$`),
      replace: "Kata-Code-macOS-Apple-Silicon.zip$1",
    },
    // macOS — x64 (Intel)
    {
      pattern: new RegExp(`^${prefix}-x64\\.dmg(\\.blockmap)?$`),
      replace: "Kata-Code-macOS-Intel.dmg$1",
    },
    {
      pattern: new RegExp(`^${prefix}-x64\\.zip(\\.blockmap)?$`),
      replace: "Kata-Code-macOS-Intel.zip$1",
    },
    // Linux — AppImage
    {
      pattern: new RegExp(`^${prefix}-arm64\\.AppImage$`),
      replace: "Kata-Code-Linux-arm64.AppImage",
    },
    { pattern: new RegExp(`^${prefix}-x64\\.AppImage$`), replace: "Kata-Code-Linux-x64.AppImage" },
    // Linux — Debian
    { pattern: new RegExp(`^${prefix}-arm64\\.deb$`), replace: "Kata-Code-Linux-arm64.deb" },
    { pattern: new RegExp(`^${prefix}-x64\\.deb$`), replace: "Kata-Code-Linux-x64.deb" },
    // Windows — NSIS installer
    {
      pattern: new RegExp(`^${prefix}-arm64\\.exe(\\.blockmap)?$`),
      replace: "Kata-Code-Windows-arm64.exe$1",
    },
    {
      pattern: new RegExp(`^${prefix}-x64\\.exe(\\.blockmap)?$`),
      replace: "Kata-Code-Windows-x64.exe$1",
    },
  ];
}

/** Returns the friendly name for an installer file, or null if no rule applies. */
export function suggestReleaseFileName(fileName: string, version: string): string | null {
  for (const rule of buildInstallerRenameRules(version)) {
    if (rule.pattern.test(fileName)) {
      return fileName.replace(rule.pattern, rule.replace);
    }
  }
  return null;
}

/** Builds a map of original file name → friendly name for every matching file. */
export function buildInstallerRenameMap(
  fileNames: readonly string[],
  version: string,
): Map<string, string> {
  const renameMap = new Map<string, string>();
  for (const fileName of fileNames) {
    const nextName = suggestReleaseFileName(fileName, version);
    if (nextName !== null) {
      renameMap.set(fileName, nextName);
    }
  }
  return renameMap;
}

/** Rewrites a manifest's contents so every renamed file references its new name. */
export function rewriteManifestContent(content: string, renameMap: Map<string, string>): string {
  let updated = content;
  for (const [oldName, newName] of renameMap) {
    updated = updated.split(oldName).join(newName);
  }
  return updated;
}

export function releaseDownloadUrl(repository: string, tag: string, fileName: string): string {
  return `https://github.com/${repository}/releases/download/${tag}/${fileName}`;
}

function link(repository: string, tag: string, fileName: string | undefined): string {
  return fileName ? `[Download](${releaseDownloadUrl(repository, tag, fileName)})` : "—";
}

export function renderReleaseBody(input: {
  version: string;
  tag: string;
  repository: string;
  fileNames: readonly string[];
}): string {
  const names = new Set(input.fileNames);
  const pick = (...candidates: string[]) => candidates.find((candidate) => names.has(candidate));

  const macAppleSiliconDmg = pick("Kata-Code-macOS-Apple-Silicon.dmg");
  const macIntelDmg = pick("Kata-Code-macOS-Intel.dmg");
  const macAppleSiliconZip = pick("Kata-Code-macOS-Apple-Silicon.zip");
  const macIntelZip = pick("Kata-Code-macOS-Intel.zip");
  const linuxX64AppImage = pick("Kata-Code-Linux-x64.AppImage");
  const linuxArm64AppImage = pick("Kata-Code-Linux-arm64.AppImage");
  const linuxX64Deb = pick("Kata-Code-Linux-x64.deb");
  const linuxArm64Deb = pick("Kata-Code-Linux-arm64.deb");
  const windowsX64Exe = pick("Kata-Code-Windows-x64.exe");
  const windowsArm64Exe = pick("Kata-Code-Windows-arm64.exe");

  const lines = [
    `## Kata Code ${input.version}`,
    "",
    "### macOS",
    "",
    "| | Apple Silicon | Intel |",
    "|---|---|---|",
    `| Installer (.dmg) | ${link(input.repository, input.tag, macAppleSiliconDmg)} | ${link(input.repository, input.tag, macIntelDmg)} |`,
    `| Auto-update (.zip) | ${link(input.repository, input.tag, macAppleSiliconZip)} | ${link(input.repository, input.tag, macIntelZip)} |`,
    "",
    "### Linux",
    "",
    "| | x64 | arm64 |",
    "|---|---|---|",
    `| AppImage | ${link(input.repository, input.tag, linuxX64AppImage)} | ${link(input.repository, input.tag, linuxArm64AppImage)} |`,
    `| Debian (.deb) | ${link(input.repository, input.tag, linuxX64Deb)} | ${link(input.repository, input.tag, linuxArm64Deb)} |`,
    "",
    "### Windows",
    "",
    "| | x64 | arm64 |",
    "|---|---|---|",
    `| Installer (.exe) | ${link(input.repository, input.tag, windowsX64Exe)} | ${link(input.repository, input.tag, windowsArm64Exe)} |`,
    "",
    "> AppImage, `.deb`, and Windows `.exe` installs do not support in-app auto-updates; macOS and the auto-update manifests below do.",
    "",
    "All release assets, including auto-update metadata, are attached below.",
  ];

  return `${lines.join("\n")}\n`;
}

export interface PrepareReleaseAssetsOptions {
  readonly distDir: string;
  readonly repository: string;
  readonly tag: string;
  readonly version: string;
}

export interface PrepareReleaseAssetsResult {
  readonly fileNames: ReadonlyArray<string>;
  readonly body: string;
  readonly bodyPath: string;
}

/** Updater manifest extensions that should have their `url`/`path` rewritten. */
const MANIFEST_EXTENSIONS = [".yml", ".yaml"] as const;
/** electron-builder debug artifacts to strip before publishing. */
const BUILDER_DEBUG_FILES = ["builder-debug.yml", "builder-effective-config.yaml"] as const;

/**
 * Renames installers to friendly names, rewrites updater manifests to match,
 * strips electron-builder debug output, and renders the release body.
 */
export const prepareReleaseAssets = Effect.fn("prepareReleaseAssets")(function* (
  options: PrepareReleaseAssetsOptions,
) {
  const { distDir, repository, tag, version } = options;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const initialNames = yield* fs.readDirectory(distDir);
  const renameMap = buildInstallerRenameMap(initialNames, version);

  // Rewrite updater manifests first so their `url`/`path` fields reference the
  // friendly names before the files move on disk.
  for (const fileName of initialNames) {
    if (!MANIFEST_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
      continue;
    }
    if ((BUILDER_DEBUG_FILES as readonly string[]).includes(fileName)) {
      continue;
    }

    const sourcePath = path.join(distDir, fileName);
    const content = yield* fs.readFileString(sourcePath);
    const updated = rewriteManifestContent(content, renameMap);
    yield* fs.writeFileString(sourcePath, updated);
  }

  for (const [oldName, newName] of renameMap) {
    yield* fs.rename(path.join(distDir, oldName), path.join(distDir, newName));
  }

  // Drop electron-builder debug artifacts so they are not published.
  for (const debugFile of BUILDER_DEBUG_FILES) {
    const debugPath = path.join(distDir, debugFile);
    const exists = yield* fs.exists(debugPath).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      yield* fs.remove(debugPath);
    }
  }

  const fileNames = (yield* fs.readDirectory(distDir)).sort();
  const body = renderReleaseBody({ version, tag, repository, fileNames });
  const bodyPath = path.join(distDir, "release-body.md");
  yield* fs.writeFileString(bodyPath, body);

  return { fileNames, body, bodyPath };
});
