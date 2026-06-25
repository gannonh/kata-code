import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveRepoRoot } from "../harness/artifacts.ts";
import { MOBILE_E2E_TIMEOUTS } from "../config/timeouts.ts";
import { buildMaestroEnv, resolveFlowPaths, resolveRunTimeoutMs } from "./run.ts";

const AGENT_ENV = {
  KATACODE_E2E_AGENT_PROVIDER: "openai",
  KATACODE_E2E_AGENT_MODEL: "gpt-5.4-mini",
  OPENAI_API_KEY: "test-key",
} satisfies NodeJS.ProcessEnv;

describe("resolveFlowPaths", () => {
  it("discovers the committed flows and excludes the shared subflow dir", () => {
    // The discovery contract: only runnable top-level flows are returned;
    // maestro/shared/open-add-environment.yaml is composed via runFlow, not run.
    const paths = resolveFlowPaths([]);
    const relatives = paths.map((p) => p.replace(`${resolveRepoRoot()}/mobile-e2e/maestro/`, ""));
    expect(relatives).toContain("smoke/launch.yaml");
    expect(relatives).toContain("pairing/bearer-pair.yaml");
    expect(relatives).toContain("agent/deterministic-chat.yaml");
    expect(relatives).toContain("auth/clerk-connect.yaml");
    expect(relatives.some((p) => p.startsWith("shared/"))).toBe(false);
  });

  it("filters to the selected tag", () => {
    const relatives = resolveFlowPaths(["@smoke"]).map((p) =>
      p.replace(`${resolveRepoRoot()}/mobile-e2e/maestro/`, ""),
    );
    expect(relatives).toEqual(["smoke/launch.yaml"]);
  });
});

describe("buildMaestroEnv", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(AGENT_ENV)) {
      process.env[key] = value;
    }
  });
  afterEach(() => {
    for (const key of Object.keys(AGENT_ENV)) {
      delete process.env[key];
    }
  });

  it("injects no pairing variables for a smoke-only run", () => {
    const env = buildMaestroEnv({
      selection: ["@smoke"],
      runId: "run-1",
      credentials: { googleEmail: null },
      pairing: { connectionString: "katacode://127.0.0.1:1", host: "127.0.0.1:1", token: "tok" },
    });
    expect(env).toEqual({});
  });

  it("injects only the Google email for an @auth-only run", () => {
    // @auth never pairs, so KC_HOST/KC_TOKEN must be absent even when a pairing
    // object is passed (the harness would not start a server for @auth).
    const env = buildMaestroEnv({
      selection: ["@auth"],
      runId: "run-1",
      credentials: { googleEmail: "tester@example.com" },
      pairing: { connectionString: "katacode://127.0.0.1:1", host: "127.0.0.1:1", token: "tok" },
    });
    expect(env).toEqual({ KC_GOOGLE_EMAIL: "tester@example.com" });
  });

  it("injects KC_HOST/KC_TOKEN for a pairing run", () => {
    const env = buildMaestroEnv({
      selection: ["@pairing"],
      runId: "run-1",
      credentials: { googleEmail: null },
      pairing: {
        connectionString: "katacode://127.0.0.1:3773",
        host: "127.0.0.1:3773",
        token: "abc",
      },
    });
    expect(env).toEqual({ KC_HOST: "127.0.0.1:3773", KC_TOKEN: "abc" });
  });

  it("injects no pairing env when the flow needs a server but none started", () => {
    // Defensive: if pairing is null (server failed to start), the pairing builder
    // returns {} rather than emitting undefined KC_HOST/KC_TOKEN.
    const env = buildMaestroEnv({
      selection: ["@pairing"],
      runId: "run-1",
      credentials: { googleEmail: null },
      pairing: null,
    });
    expect(env).toEqual({});
  });

  it("injects the deterministic agent token + model-picker labels for @agent", () => {
    const env = buildMaestroEnv({
      selection: ["@agent"],
      runId: "mobile-e2e-run-1",
      credentials: { googleEmail: null },
      pairing: null,
    });
    expect(env.KC_EXPECTED).toBe("E2E_AGENT_OK_mobile-e2e-run-1");
    expect(env.KC_PROMPT).toContain("E2E_AGENT_OK_mobile-e2e-run-1");
    expect(env.KC_MODEL).toBe("gpt-5.4-mini");
    // Display labels must match what the mobile picker renders.
    expect(env.KC_PROVIDER_LABEL).toBe("Codex");
    expect(env.KC_MODEL_LABEL).toBe("GPT-5.4-Mini");
  });

  it("injects KC_HOST/KC_TOKEN for @agent because it composes bearer-pair.yaml", () => {
    // deterministic-chat.yaml runFlows bearer-pair.yaml first, which reads
    // KC_HOST/KC_TOKEN; @agent must therefore receive pairing vars too.
    const env = buildMaestroEnv({
      selection: ["@agent"],
      runId: "mobile-e2e-run-1",
      credentials: { googleEmail: null },
      pairing: {
        connectionString: "katacode://127.0.0.1:3773",
        host: "127.0.0.1:3773",
        token: "abc",
      },
    });
    expect(env.KC_HOST).toBe("127.0.0.1:3773");
    expect(env.KC_TOKEN).toBe("abc");
    expect(env.KC_EXPECTED).toBe("E2E_AGENT_OK_mobile-e2e-run-1");
  });
});

describe("resolveRunTimeoutMs", () => {
  it("uses the agent round-trip budget when @agent is selected", () => {
    expect(resolveRunTimeoutMs(["@agent"])).toBe(MOBILE_E2E_TIMEOUTS.agentFlowMs);
  });

  it("uses the flow budget for a smoke-only run", () => {
    expect(resolveRunTimeoutMs(["@smoke"])).toBe(MOBILE_E2E_TIMEOUTS.maestroFlowMs);
  });

  it("picks the slowest budget when multiple tags are selected", () => {
    expect(resolveRunTimeoutMs(["@smoke", "@agent"])).toBe(MOBILE_E2E_TIMEOUTS.agentFlowMs);
  });
});
