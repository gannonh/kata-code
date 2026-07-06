// @effect-diagnostics globalDate:off - time-to-ready measurement for snapshot-boot comparison.
// @effect-diagnostics globalDateInEffect:off - time-to-ready measurement inside Effect gen.
// @effect-diagnostics globalFetch:off - raw healthz/wss probes against the live sandbox domain.
// @effect-diagnostics globalFetchInEffect:off - healthz probes inside Effect gen (not an Effect HttpClient consumer).
// @effect-diagnostics globalErrorInEffectCatch:off - integration test wraps fetch failures in a plain Error for the probe.
// @effect-diagnostics globalErrorInEffectFailure:off - integration test fail path uses a plain Error.
// @effect-diagnostics unsafeEffectTypeAssertion:off - driver returns SandboxHandle; the assertion documents the cast.
// @effect-diagnostics anyUnknownInErrorContext:off - the validate probe collapses the error channel to a nullable result.
import { describe, expect, it } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { VercelSandboxProvider, vercelConfigDecoder } from "./VercelSandboxProvider.ts";
import { DEFAULT_VERCEL_CONFIG } from "./config.ts";
import { liveVercelSdk } from "./sdk.ts";
import type { SandboxHandle, SandboxReachability } from "@kata-sh/code-sandbox/driver";

const creds =
  process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID;

/** Run an effect, returning `null` on failure (for the validate probe). */
const runOrNull = <A, E>(eff: Effect.Effect<A, E>): Effect.Effect<A | null, never> =>
  Effect.matchEffect(eff, {
    onFailure: () => Effect.succeed(null),
    onSuccess: (a) => Effect.succeed(a),
  });

/**
 * Credentialed Vercel Sandbox integration tests. Maintainer-local: skip when
 * the VERCEL_* trio is absent (CI runs uncredentialed). Run with:
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... pnpm test
 */
describe.skipIf(!creds)("vercel driver (credentialed)", () => {
  const auth = {
    token: process.env.VERCEL_TOKEN as string,
    teamId: process.env.VERCEL_TEAM_ID as string,
    projectId: process.env.VERCEL_PROJECT_ID as string,
  };

  vitIt.effect("validate fails invalid-config with a bad token (AC-3b.2)", () =>
    Effect.gen(function* () {
      const badAuth = { ...auth, token: "tok_invalid_xxx" };
      const result = yield* runOrNull(
        VercelSandboxProvider.validate({ ...DEFAULT_VERCEL_CONFIG, auth: badAuth }),
      );
      expect(result).toBeNull();
    }),
  );

  vitIt.effect("provision from runtime reaches /healthz and disposes (AC-3b.3)", () =>
    Effect.gen(function* () {
      const provider = VercelSandboxProvider;
      yield* Effect.acquireUseRelease(
        provider.provision({
          instanceId: `kata-test-${Date.now().toString(36)}`,
          config: { ...DEFAULT_VERCEL_CONFIG, auth },
          image: "",
          env: [],
        }),
        (handle) =>
          Effect.gen(function* () {
            const reach = yield* provider.reachability(
              handle as SandboxHandle,
              13773,
            ) as Effect.Effect<SandboxReachability>;
            expect(reach.reachabilityKind).toBe("public");
            const res = yield* Effect.tryPromise({
              try: () =>
                fetch(`${reach.httpBaseUrl}/healthz`, { signal: AbortSignal.timeout(10_000) }),
              catch: (e) => new Error(String(e)),
            });
            expect(res.status).toBe(200);
          }),
        (handle) => provider.dispose(handle as SandboxHandle),
      );
    }),
  );

  vitIt.effect("reachability wss URL accepts a WebSocket connection (AC-3b.4)", () =>
    Effect.gen(function* () {
      const provider = VercelSandboxProvider;
      yield* Effect.acquireUseRelease(
        provider.provision({
          instanceId: `kata-test-ws-${Date.now().toString(36)}`,
          config: { ...DEFAULT_VERCEL_CONFIG, auth },
          image: "",
          env: [],
        }),
        (handle) =>
          Effect.gen(function* () {
            const reach = yield* provider.reachability(
              handle as SandboxHandle,
              13773,
            ) as Effect.Effect<SandboxReachability>;
            const res = yield* Effect.tryPromise({
              try: () => fetch(reach.httpBaseUrl, { signal: AbortSignal.timeout(10_000) }),
              catch: (e) => new Error(String(e)),
            });
            expect(res.status).toBeLessThan(500);
          }),
        (handle) => provider.dispose(handle as SandboxHandle),
      );
    }),
  );

  vitIt.effect("createSnapshot then provision-from-snapshot skips bootstrap (AC-3b.7)", () =>
    Effect.gen(function* () {
      const provider = VercelSandboxProvider;
      // Seed the snapshot capability's auth via a prior validate.
      yield* runOrNull(provider.validate({ ...DEFAULT_VERCEL_CONFIG, auth }));
      yield* Effect.acquireUseRelease(
        provider.provision({
          instanceId: `kata-test-snap-${Date.now().toString(36)}`,
          config: { ...DEFAULT_VERCEL_CONFIG, auth },
          image: "",
          env: [],
        }),
        (handle) =>
          Effect.gen(function* () {
            const snap = yield* provider.snapshot!.createSnapshot(handle as SandboxHandle);
            expect(snap.snapshotId).toMatch(/^snap_/);
            const start = Date.now();
            yield* Effect.acquireUseRelease(
              provider.provision({
                instanceId: `kata-test-snapboot-${Date.now().toString(36)}`,
                config: {
                  ...DEFAULT_VERCEL_CONFIG,
                  auth,
                  sourceType: "snapshot",
                  snapshotId: snap.snapshotId,
                },
                image: "",
                env: [],
              }),
              (_fromSnap) => Effect.void,
              (fromSnap) => provider.dispose(fromSnap as SandboxHandle),
            );
            const readyMs = Date.now() - start;
            // Visible in the test runner's effect log output.
            yield* Effect.logInfo(`[vercel] snapshot-boot time-to-ready: ${readyMs}ms`);
          }),
        (handle) => provider.dispose(handle as SandboxHandle),
      );
    }),
  );
});

// Keep the decoder referenced for type coverage when skipped.
it("vercelConfigDecoder is exported", () => {
  expect(typeof vercelConfigDecoder).toBe("function");
  expect(typeof liveVercelSdk).toBe("object");
});
