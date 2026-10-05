import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createLocalMediaUrl, readMediaPng, revokeLocalMediaUrl } from "./mediaContent";

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local media URLs", () => {
  it("reads media the app created without fetching, as the desktop CSP blocks blob: connections", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.reject(new TypeError("Refused to connect because it violates connect-src")),
    );
    const url = createLocalMediaUrl(new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }));

    const png = await readMediaPng(url);

    expect([...new Uint8Array(await png.arrayBuffer())]).toEqual(PNG_BYTES);
    revokeLocalMediaUrl(url);
    await expect(readMediaPng(url)).rejects.toThrow(
      "The file could not be fetched. The host may block browser access (CORS), or the connection may be unavailable.",
    );
  });
});
