import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ProjectReadFileResult,
  T3_PROJECT_FILE_NAME,
} from "@kata-sh/code-contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const environmentId = EnvironmentId.make("environment-settings-scope-test");
const workspaceRoot = "/repo";

const readFileAtoms = vi.hoisted(() => new Map<string, unknown>());

vi.mock("../../state/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/projects")>();
  return {
    projectEnvironment: {
      ...actual.projectEnvironment,
      readFile: ({ input }: { input: { cwd: string; relativePath: string } }) =>
        readFileAtoms.get(`${input.cwd}:${input.relativePath}`),
    },
  };
});

vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: EnvironmentId.make("environment-settings-scope-test"),
        label: "Laptop",
        connection: { phase: "connected" },
        serverConfig: { settings: DEFAULT_SERVER_SETTINGS },
      },
    ],
  }),
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-settings-scope-test"),
}));

vi.mock("./useSettingsProjectGroups", () => {
  const member = {
    id: ProjectId.make("project-1"),
    environmentId: EnvironmentId.make("environment-settings-scope-test"),
    workspaceRoot: "/repo",
    physicalProjectKey: "environment-settings-scope-test:/repo",
  };
  const groups = [{ projectKey: "repo", displayName: "repo", memberProjects: [member] }];
  return { useSettingsProjectGroups: () => groups };
});

import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import {
  clearProjectFileQueryData,
  setProjectFileQueryData,
} from "../files/projectFilesQueryState";
import { SettingsScopeProvider, useSettingsScope } from "./SettingsScopeContext";

function t3File(contents: string): ProjectReadFileResult {
  return {
    relativePath: T3_PROJECT_FILE_NAME,
    contents,
    byteLength: contents.length,
    truncated: false,
  };
}

function ScopeProbe() {
  const { target } = useSettingsScope();
  return `${target?.settings.defaultThreadEnvMode ?? "unset"} from ${target?.sources.defaultThreadEnvMode}`;
}

function renderProjectScope(): string {
  return renderToStaticMarkup(
    <AppAtomRegistryProvider>
      <SettingsScopeProvider search={{ project: "repo" }} onChange={() => {}}>
        <ScopeProbe />
      </SettingsScopeProvider>
    </AppAtomRegistryProvider>,
  );
}

describe("SettingsScopeProvider project files", () => {
  afterEach(() => {
    clearProjectFileQueryData(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME);
    readFileAtoms.clear();
  });

  it("keeps a saved t3.json in the chain while its confirming read is in flight", () => {
    // The last settled read still has the old file and is refreshing after the save.
    readFileAtoms.set(
      `${workspaceRoot}:${T3_PROJECT_FILE_NAME}`,
      Atom.make(AsyncResult.success(t3File('{"defaultThreadEnvMode":"local"}'), { waiting: true })),
    );
    setProjectFileQueryData(
      environmentId,
      workspaceRoot,
      T3_PROJECT_FILE_NAME,
      '{"defaultThreadEnvMode":"worktree"}',
    );

    expect(renderProjectScope()).toBe("worktree from t3.json");
  });

  it("leaves the file layer out while a first read is in flight with no saved file", () => {
    readFileAtoms.set(
      `${workspaceRoot}:${T3_PROJECT_FILE_NAME}`,
      Atom.make(AsyncResult.initial(true)),
    );

    expect(renderProjectScope()).toBe("unset from environment");
  });
});
