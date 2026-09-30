// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ openUserProfile: vi.fn() }),
  useAuth: () => ({ isSignedIn: true }),
}));

import { RemoveT3ConnectEnvironmentDialog } from "./RemoveT3ConnectEnvironmentDialog";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("RemoveT3ConnectEnvironmentDialog", () => {
  it("describes the dialog with both the local-forget warning and the account note", async () => {
    await act(async () => {
      root.render(
        <RemoveT3ConnectEnvironmentDialog
          environmentLabel="Work laptop"
          onCancel={() => {}}
          onConfirm={() => {}}
        />,
      );
    });

    const popup = document.querySelector<HTMLElement>('[data-slot="alert-dialog-popup"]');
    const describedBy = popup?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const description = describedBy
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(description).toBe(
      "This forgets its pairing, credentials, and cached threads here.It stays on your Kata Code Connect account and keeps its host space. Deregister it in Kata Code Connect settings to free it.",
    );
  });
});
