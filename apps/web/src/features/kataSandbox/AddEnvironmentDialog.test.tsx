import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { createInitialDockerDraft } from "./AddEnvironmentDialog.logic";
vi.mock("./SandboxGitHubSourcePicker", () => ({
  SandboxGitHubSourcePicker: () => <div>Repository and branch picker</div>,
}));
import { DockerCreateFields, OperationProgress } from "./AddEnvironmentDialog";
it("renders one form with an optional label and all overrides under Advanced", () => {
  const html = renderToStaticMarkup(
    <DockerCreateFields
      draft={createInitialDockerDraft({ serverVersion: "0.0.42" })}
      isSubmitting={false}
      offerSandboxImageOverride={false}
      codexProviders={[]}
      dispatch={() => {}}
    />,
  );
  expect(html).toContain("Repository and branch picker");
  expect(html).toContain("Label (optional)");
  expect(html).not.toContain("Docker profile");
  expect(html).not.toContain("profileId");
  const advanced = html.slice(html.indexOf("<details"));
  for (const field of ["Manual ref", "Docker socket", "Custom image"])
    expect(advanced).toContain(field);
});
it("shows elapsed progress and reconnection without operation IDs or raw bytes", () => {
  const html = renderToStaticMarkup(
    <OperationProgress
      operation={{
        operationId: "secret-operation-uuid",
        status: "Running",
        acceptedAt: "2026-09-07T00:00:00Z",
        progress: { stage: "pulling-image", downloadedBytes: 55_000_000, totalBytes: 130_000_000 },
      }}
      now={Date.parse("2026-09-07T00:01:05Z")}
      reconnecting
    />,
  );
  expect(html).toContain("42%, 55 MB of 130 MB");
  expect(html).toContain("Reconnecting");
  expect(html).toContain("1m 5s elapsed");
  expect(html).not.toContain("secret-operation-uuid");
  expect(html).not.toContain("55000000");
});
