import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@kata-sh/code-contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import { CodexSetupSection } from "./CodexSetupSection";

const environmentId = EnvironmentId.make("remote-codex");
const instanceId = ProviderInstanceId.make("codex");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-30T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

function renderSetup(options?: {
  readonly readOnly?: boolean;
  readonly onModeChange?: (mode: "managed" | "existing") => void;
}) {
  hooks.beginRender();
  return CodexSetupSection({
    environmentId,
    instanceId,
    provider,
    mode: "existing",
    enabled: true,
    ...(options?.readOnly === undefined ? {} : { readOnly: options.readOnly }),
    onModeChange: options?.onModeChange ?? vi.fn(),
  });
}

function button(view: unknown, label: string) {
  return visitElements(
    view,
    (element) => element.props.children === label && typeof element.props.onClick === "function",
  );
}

describe("CodexSetupSection existing CLI settings", () => {
  beforeEach(() => hooks.reset());

  it("offers switching back to managed Codex", () => {
    const onModeChange = vi.fn();
    const action = button(renderSetup({ onModeChange }), "Use managed Codex");

    expect(action).not.toBeNull();
    const onClick = action?.props.onClick;
    if (typeof onClick !== "function") throw new Error("Managed Codex action is not clickable");
    onClick();
    expect(onModeChange).toHaveBeenCalledExactlyOnceWith("managed");
  });

  it("disables switching back to managed Codex when read only", () => {
    const action = button(renderSetup({ readOnly: true }), "Use managed Codex");

    expect(action?.props.disabled).toBe(true);
  });
});
