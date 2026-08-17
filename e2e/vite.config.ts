import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Pin the root to this directory so `test:e2e-unit` finds the same files
  // whether it runs from the repo root or from `e2e/`. Without it the include
  // pattern resolved against the caller's cwd and silently matched nothing.
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
