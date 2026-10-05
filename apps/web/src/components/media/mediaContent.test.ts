// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { downloadMedia, readMediaPng } from "./mediaContent";

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

describe("downloadMedia ownership", () => {
  it("leaves a caller-owned blob: URL alive after the download starts", async () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadMedia("blob:katacode-dev://app/7f3c2a", "Mermaid diagram");
    vi.advanceTimersByTime(60_000);

    expect(revokeObjectURL.mock.calls).toEqual([]);
    vi.useRealTimers();
  });
});

describe("readMediaPng", () => {
  it("converts in-memory media to PNG by decoding its own blob: URL, without fetching or revoking it", async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal("fetch", (src: string) => {
      fetchCalls.push(src);
      return Promise.reject(new TypeError("Refused to connect because it violates connect-src"));
    });
    const createObjectURL = vi.fn(() => "blob:unexpected");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const decoded: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 408;
        naturalHeight = 63;
        src = "";
        async decode() {
          decoded.push(this.src);
        }
      },
    );
    const drawn: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
      drawImage: () => {},
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
    ) {
      drawn.push([this.width, this.height]);
      callback(new Blob(["png"], { type: "image/png" }));
    });

    const png = await readMediaPng("blob:katacode-dev://app/7f3c2a");

    expect(png.type).toBe("image/png");
    expect({
      fetchCalls,
      decoded,
      drawn,
      created: createObjectURL.mock.calls.length,
      revoked: revokeObjectURL.mock.calls.length,
    }).toEqual({
      fetchCalls: [],
      decoded: ["blob:katacode-dev://app/7f3c2a"],
      drawn: [[408, 63]],
      created: 0,
      revoked: 0,
    });
  });
});
