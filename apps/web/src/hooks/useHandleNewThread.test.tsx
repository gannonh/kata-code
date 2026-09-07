import { renderToString } from "react-dom/server";
import { EnvironmentId, ProjectId } from "@kata-sh/code-contracts";
import { scopeProjectRef } from "@kata-sh/code-client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  readDefaults: vi.fn(),
  navigate: vi.fn(),
  writeDraft: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({ defaultThreadEnvMode: "local" }) }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { matches: [] }, navigate: mocks.navigate }),
  useParams: () => ({}),
}));
vi.mock("../state/server", () => ({ primaryServerSettingsAtom: {} }));
vi.mock("../state/entities", () => ({
  useProjects: () => [{ id: "project", environmentId: "environment", workspaceRoot: "/workspace" }],
  readThreadShell: () => null,
  useThread: () => null,
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "project-key",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFileDefaultThreadEnvMode: mocks.readDefaults,
}));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  composerDraftHasUserContent: () => false,
  useComposerDraftStore: {
    getState: () => ({
      getDraftSessionByLogicalProjectKey: () => null,
      setLogicalProjectDraftThreadId: mocks.writeDraft,
    }),
  },
}));

import { useNewThreadHandler } from "./useHandleNewThread";

it("does not write a draft or navigate when closed during the remote defaults read", async () => {
  let resolveDefaults: (value: null) => void = () => {};
  const defaults = new Promise<null>((resolve) => {
    resolveDefaults = resolve;
  });
  mocks.readDefaults.mockReturnValue(defaults);
  let handler: ReturnType<typeof useNewThreadHandler> | undefined;
  function Capture() {
    handler = useNewThreadHandler();
    return null;
  }
  renderToString(<Capture />);
  const controller = new AbortController();
  if (handler === undefined) throw new Error("Hook did not render");
  const pending = handler(
    scopeProjectRef(EnvironmentId.make("environment"), ProjectId.make("project")),
    {
      signal: controller.signal,
    },
  );
  expect(mocks.readDefaults).toHaveBeenCalledOnce();
  controller.abort();
  resolveDefaults(null);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.writeDraft).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});
