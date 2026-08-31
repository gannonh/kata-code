import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  ManagedImageResolutionError,
  managedImageTag,
  parseManagedImageManifest,
  resolveManagedImage,
} from "./managedImage.ts";

const digest = "sha256:" + "a".repeat(64);
const manifest = {
  digest,
  manifests: [
    { digest: "sha256:" + "b".repeat(64), platform: { os: "linux", architecture: "amd64" } },
    { digest: "sha256:" + "c".repeat(64), platform: { os: "linux", architecture: "arm64" } },
  ],
};

describe("managed image resolution", () => {
  it("uses the channel in the nightly release tag", () => {
    expect(managedImageTag({ serverVersion: "v0.0.43", channel: "stable" })).toBe("0.0.43");
    expect(managedImageTag({ serverVersion: "v0.0.43", channel: "nightly" })).toBe(
      "0.0.43-nightly",
    );
  });

  it("returns immutable index and platform references", () => {
    expect(
      parseManagedImageManifest("vcr.vercel.com/team/project/kata-sandbox", "0.0.43", manifest),
    ).toEqual({
      immutableReference: `vcr.vercel.com/team/project/kata-sandbox@${digest}`,
      indexDigest: digest,
      platformDigests: {
        "linux/amd64": "sha256:" + "b".repeat(64),
        "linux/arm64": "sha256:" + "c".repeat(64),
      },
    });
  });

  it("keeps registry diagnostics separate from malformed indexes", async () => {
    const error = new ManagedImageResolutionError({
      kind: "registry-failure",
      message: "registry unavailable",
    });
    await expect(
      Effect.runPromise(
        resolveManagedImage(
          { serverVersion: "0.0.43", channel: "stable" },
          {
            repository: "vcr.vercel.com/team/project/kata-sandbox",
            readManifest: () => Effect.fail(error),
          },
        ),
      ),
    ).rejects.toMatchObject({ kind: "registry-failure" });
    expect(() => parseManagedImageManifest("registry", "0.0.43", {})).toThrow(
      "has no index digest",
    );
  });

  it("rejects an index without both supported platforms", () => {
    expect(() =>
      parseManagedImageManifest("registry", "0.0.43", { ...manifest, manifests: [] }),
    ).toThrow("linux/amd64");
  });
});
