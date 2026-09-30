import { EnvironmentId, type ServerConfig } from "@kata-sh/code-contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@kata-sh/code-contracts/settings";
import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const ENVIRONMENT_ID = EnvironmentId.make("environment-bitbucket");
const state = vi.hoisted(() => ({
  configs: new Map<string, unknown>(),
  updateSettings: vi.fn(),
}));

vi.mock("../../state/entities", () => ({ useServerConfigs: () => state.configs }));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: (
    _environmentId: string,
    select: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => unknown,
  ) => select(DEFAULT_UNIFIED_SETTINGS),
}));
vi.mock("../../state/server", () => ({ serverEnvironment: { updateSettings: {} } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.updateSettings }));

import { BitbucketCredentialsSettings } from "./BitbucketCredentialsSettings";

const serverConfig = (bitbucketCredentials: boolean | undefined) =>
  ({
    environment: {
      capabilities: bitbucketCredentials === undefined ? {} : { bitbucketCredentials },
    },
  }) as unknown as ServerConfig;

function render() {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <BitbucketCredentialsSettings environmentId={ENVIRONMENT_ID} onSaved={() => {}} />,
    );
  });
  return renderer;
}

describe("BitbucketCredentialsSettings", () => {
  beforeEach(() => {
    state.configs = new Map();
    state.updateSettings.mockReset();
  });

  it("explains the update instead of offering a save on a server that predates Bitbucket credentials", () => {
    state.configs.set(ENVIRONMENT_ID, serverConfig(undefined));
    const renderer = render();

    expect(renderer.root.findAllByType("form")).toHaveLength(0);
    expect(renderer.root.findAllByType("input")).toHaveLength(0);
    expect(renderer.root.findAllByType("button")).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain("too old to store Bitbucket credentials");
    expect(state.updateSettings).not.toHaveBeenCalled();
  });

  it("renders nothing until the server config is known", () => {
    expect(render().toJSON()).toBeNull();
  });

  it("shows the credentials form on a server that supports it", () => {
    state.configs.set(ENVIRONMENT_ID, serverConfig(true));
    const renderer = render();

    expect(renderer.root.findAllByType("form")).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("too old");
  });
});
