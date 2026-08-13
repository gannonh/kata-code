import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ProviderEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
} from "./provider.ts";
import {
  PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_CHARS,
  PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_ENTRIES,
  ProviderSessionEnvironment,
} from "./providerEnvironment.ts";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(ProviderSessionStartInput);
const decodeProviderSendTurnInput = Schema.decodeUnknownSync(ProviderSendTurnInput);
const decodeProviderSession = Schema.decodeUnknownSync(ProviderSession);
const decodeProviderEvent = Schema.decodeUnknownSync(ProviderEvent);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}

describe("ProviderSessionEnvironment", () => {
  it("accepts bounded generic variables, executable path, and PATH prepend", () => {
    const decode = Schema.decodeUnknownSync(ProviderSessionEnvironment);
    const parsed = decode({
      variables: { KATACODE_TASK_CLI_ENDPOINT: "http://127.0.0.1:1234" },
      executablePath: "/usr/local/bin/katacode",
      pathPrepend: ["/usr/local/bin"],
    });
    expect(parsed.variables.KATACODE_TASK_CLI_ENDPOINT).toBe("http://127.0.0.1:1234");
  });

  it("rejects unallowlisted names and NUL-containing values", () => {
    const decode = Schema.decodeUnknownSync(ProviderSessionEnvironment);
    expect(() =>
      decode({ variables: { OPENAI_API_KEY: "secret" }, executablePath: null, pathPrepend: [] }),
    ).toThrow();
    expect(() =>
      decode({ variables: { PATH: "/bin\u0000:/usr/bin" }, executablePath: null, pathPrepend: [] }),
    ).toThrow();
  });

  it("rejects oversized PATH budgets and malformed variable names", () => {
    const decode = Schema.decodeUnknownSync(ProviderSessionEnvironment);
    expect(() =>
      decode({
        variables: { "not-a-shell-name": "secret" },
        executablePath: null,
        pathPrepend: ["x".repeat(PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_CHARS + 1)],
      }),
    ).toThrow();
    expect(() =>
      decode({
        variables: {},
        executablePath: null,
        pathPrepend: Array.from(
          { length: PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_ENTRIES + 1 },
          () => "/bin",
        ),
      }),
    ).toThrow();
  });
});

describe("ProviderSessionStartInput", () => {
  it("accepts codex-compatible payloads", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      cwd: "/tmp/workspace",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "full-access",
    });
    expect(parsed.runtimeMode).toBe("full-access");
    expect(parsed.modelSelection?.instanceId).toBe("codex");
    expect(parsed.modelSelection?.model).toBe("gpt-5.3-codex");
    expect(getOptionValue(parsed.modelSelection?.options, "reasoningEffort")).toBe("high");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("rejects payloads without runtime mode", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
      }),
    ).toThrow();
  });

  it("accepts claude runtime knobs", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "claudeAgent",
      cwd: "/tmp/workspace",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [
          { id: "thinking", value: true },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "full-access",
    });
    expect(parsed.provider).toBe("claudeAgent");
    expect(parsed.modelSelection?.instanceId).toBe("claudeAgent");
    expect(parsed.modelSelection?.model).toBe("claude-sonnet-4-6");
    expect(getOptionValue(parsed.modelSelection?.options, "thinking")).toBe(true);
    expect(getOptionValue(parsed.modelSelection?.options, "effort")).toBe("max");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
    expect(parsed.runtimeMode).toBe("full-access");
  });

  it("accepts cursor provider", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "cursor",
      cwd: "/tmp/workspace",
      runtimeMode: "full-access",
      modelSelection: {
        provider: "cursor",
        model: "composer-2",
        options: [{ id: "fastMode", value: true }],
      },
    });
    expect(parsed.provider).toBe("cursor");
    expect(parsed.modelSelection?.instanceId).toBe("cursor");
    expect(parsed.modelSelection?.model).toBe("composer-2");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("accepts fork-provided driver kinds as branded slugs", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "ollama",
      providerInstanceId: "ollama_local",
      cwd: "/tmp/workspace",
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: "ollama_local",
        model: "llama3.3",
      },
    });

    expect(parsed.provider).toBe("ollama");
    expect(parsed.providerInstanceId).toBe("ollama_local");
    expect(parsed.modelSelection?.instanceId).toBe("ollama_local");
  });
});

describe("ProviderSendTurnInput", () => {
  it("accepts codex modelSelection", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "xhigh" },
          { id: "fastMode", value: true },
        ],
      },
    });

    expect(parsed.modelSelection?.instanceId).toBe("codex");
    expect(parsed.modelSelection?.model).toBe("gpt-5.3-codex");
    expect(getOptionValue(parsed.modelSelection?.options, "reasoningEffort")).toBe("xhigh");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("accepts claude modelSelection including ultrathink", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [
          { id: "effort", value: "ultrathink" },
          { id: "fastMode", value: true },
        ],
      },
    });

    expect(parsed.modelSelection?.instanceId).toBe("claudeAgent");
    expect(getOptionValue(parsed.modelSelection?.options, "effort")).toBe("ultrathink");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });
});

describe("providerInstanceId routing key (slice-2 invariant)", () => {
  it("decodes a ProviderSessionStartInput without providerInstanceId (legacy producer)", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      runtimeMode: "full-access",
    });
    expect(parsed.providerInstanceId).toBeUndefined();
  });

  it("decodes a ProviderSessionStartInput with providerInstanceId (post-migration producer)", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      providerInstanceId: "codex_personal",
      runtimeMode: "full-access",
    });
    expect(parsed.providerInstanceId).toBe("codex_personal");
  });

  it("propagates providerInstanceId through ProviderSession decode", () => {
    const session = decodeProviderSession({
      provider: "codex",
      providerInstanceId: "codex_work",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    expect(session.providerInstanceId).toBe("codex_work");
  });

  it("decodes ProviderSession for fork-provided driver kinds", () => {
    const session = decodeProviderSession({
      provider: "ollama",
      providerInstanceId: "ollama_local",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    expect(session.provider).toBe("ollama");
    expect(session.providerInstanceId).toBe("ollama_local");
  });

  it("decodes a ProviderEvent carrying both legacy provider and new instance routing", () => {
    const event = decodeProviderEvent({
      id: "event-1",
      kind: "notification",
      provider: "codex",
      providerInstanceId: "codex_personal",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      method: "session.created",
    });
    expect(event.provider).toBe("codex");
    expect(event.providerInstanceId).toBe("codex_personal");
  });

  it("rejects providerInstanceId values that fail the slug pattern (defense in depth)", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
        providerInstanceId: "1bad",
        runtimeMode: "full-access",
      }),
    ).toThrow();
  });
});
