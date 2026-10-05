// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { downloadMedia } from "./mediaContent";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadMedia", () => {
  it("downloads in-memory media from its own blob: URL, since the desktop CSP blocks fetching it", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.reject(new TypeError("Refused to connect because it violates connect-src")),
    );
    const downloads: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ href: this.href, download: this.download });
    });

    await downloadMedia("blob:katacode-dev://app/7f3c2a", "Mermaid diagram");
    await expect(downloadMedia("https://example.com/diagram.svg", "Remote")).rejects.toThrow(
      "The file could not be fetched. The host may block browser access (CORS), or the connection may be unavailable.",
    );

    expect(downloads).toEqual([
      { href: "blob:katacode-dev://app/7f3c2a", download: "Mermaid diagram" },
    ]);
  });
});
