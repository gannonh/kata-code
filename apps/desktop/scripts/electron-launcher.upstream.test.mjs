import { assert, describe, it } from "vite-plus/test";

import { makeDevelopmentEnvironmentScript } from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("exports captured OTLP protocol only as a fallback", () => {
    const environmentScript = makeDevelopmentEnvironmentScript({
      VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
      KATACODE_PORT: "16566",
      KATACODE_HOME: "/tmp/t3",
      KATACODE_OTLP_PROTOCOL: "http/protobuf",
    });

    assert.include(
      environmentScript,
      "if [ -z \"${KATACODE_OTLP_PROTOCOL:-}\" ]; then export KATACODE_OTLP_PROTOCOL='http/protobuf'; fi",
    );
  });
});
