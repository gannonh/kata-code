import { PROTOCOL_SCHEME_LEGACY } from "@kata-sh/code-shared/branding";
import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.t3Home), () =>
    input.joinPath(input.homeDirectory, ".katacode"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}

export function desktopLegacyUserDataDirName(isDevelopment: boolean): string {
  return isDevelopment ? "Kata Code (Dev)" : "Kata Code (Alpha)";
}

export function resolveDesktopUserDataPath(input: {
  readonly appDataDirectory: string;
  readonly exists: (path: string) => boolean;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly legacyUserDataDirName: string;
  readonly userDataDirName: string;
}): string {
  const candidateDirNames = input.isDevelopment
    ? [input.legacyUserDataDirName]
    : [input.legacyUserDataDirName, PROTOCOL_SCHEME_LEGACY];

  for (const dirName of candidateDirNames) {
    const candidatePath = input.joinPath(input.appDataDirectory, dirName);
    if (input.exists(candidatePath)) {
      return candidatePath;
    }
  }

  return input.joinPath(input.appDataDirectory, input.userDataDirName);
}
