import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../shared/src/testing/longTempDir.ts"],
    // Generated-schema tests take about half a second locally but exceeded
    // the 5 s default on shared CI runners (KAT-3545).
    testTimeout: 30_000,
  },
});
