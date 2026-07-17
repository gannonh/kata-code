import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // Keep Playwright e2e / Maestro mobile-e2e out of Vitest discovery.
    // Root `vp test run --coverage` (package.json `test`) uses this config;
    // without these excludes, Vitest loads `e2e/**/*.spec.ts` and dies on
    // Playwright `test.afterAll` hooks.
    exclude: [
      "**/.repos/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.{idea,git,cache,output,temp}/**",
      "e2e/**",
      "mobile-e2e/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // Floors sit just under measured monorepo totals so CI fails only on regressions.
    // Raise toward 75/75/70/65 after suites stabilize.
    coverage: {
      provider: "v8",
      // Summary only in default runs (CI logs); use `vp test run --coverage --reporter=verbose`
      // or inspect ./coverage for detail.
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/.repos/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/dist-electron/**",
        "**/*.{test,spec,browser}.{ts,tsx}",
        "**/integration/**",
        "e2e/**",
        "mobile-e2e/**",
        "scripts/**",
      ],
      thresholds: {
        // Floors just under measured monorepo totals; raise after suites stabilize.
        lines: 65,
        statements: 65,
        functions: 60,
        branches: 50,
      },
    },
  },
  fmt: {
    ignorePatterns: [
      ".agents",
      ".agents/skills/**",
      ".reference",
      ".repos/**",
      ".plans",
      ".alchemy",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/web/public/mockServiceWorker.js",
      "apps/web/src/lib/vendor/qrcodegen.ts",
      "apps/mobile/uniwind-types.d.ts",
      "*.icon/**",
    ],
    sortPackageJson: {},
    overrides: [
      {
        files: [".devcontainer/devcontainer.json"],
        options: {
          trailingComma: "none",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: [
      ".agents",
      ".repos",
      ".repos/**",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/uniwind-types.d.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: ["./oxlint-plugin-kata-code/index.ts"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      // Partial naming enforcement (oxlint lacks full @typescript-eslint/naming-convention).
      "react/jsx-pascal-case": "error",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "kata-code/no-global-process-runtime": "error",
      "kata-code/no-inline-schema-compile": "warn",
      "kata-code/no-manual-effect-runtime-in-tests": "error",
    },
    options: {
      // Revisit once Oxlint's tsgolint path can integrate with @effect/tsgo diagnostics.
      typeAware: false,
      typeCheck: false,
    },
  },
});
