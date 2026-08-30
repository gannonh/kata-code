import { describe, expect, it } from "vite-plus/test";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

describe("mergeProviderInstanceEnvironment", () => {
  it("overrides inherited environment values and preserves empty strings", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [
          { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
        ],
        { ANTHROPIC_API_KEY: "inherited", PATH: "/bin" },
      ),
    ).toMatchObject({
      OPENROUTER_API_KEY: "sk-or-test",
      ANTHROPIC_API_KEY: "",
      PATH: "/bin",
    });
  });

  it("removes the sandbox bootstrap credential before launching a provider", () => {
    expect(
      mergeProviderInstanceEnvironment(
        [{ name: "KATACODE_SANDBOX_BOOTSTRAP_TOKEN", value: "provider-injected", sensitive: true }],
        {
          KATACODE_SANDBOX_BOOTSTRAP_TOKEN: "target-only",
          PATH: "/bin",
        },
      ),
    ).toEqual({ PATH: "/bin" });
  });
});
