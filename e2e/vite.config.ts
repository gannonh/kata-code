import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/src/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
