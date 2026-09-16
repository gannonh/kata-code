import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CodexApiKeyAuth,
  PROVIDER_AUTH_MODE_ENV,
  codexApiKeyFromEnvironment,
  managedCodexAuthHome,
  resolveProviderAuthMode,
  writeCodexApiKeyAuth,
} from "./providerAuthMode.ts";

const decodeCodexApiKeyAuth = Schema.decodeUnknownSync(Schema.fromJsonString(CodexApiKeyAuth));

it("reads the E2E mode names", () => {
  assert.equal(PROVIDER_AUTH_MODE_ENV.codex, "KATACODE_E2E_CODEX_AUTH_MODE");
  assert.equal(PROVIDER_AUTH_MODE_ENV.claude, "KATACODE_E2E_CLAUDE_AUTH_MODE");
});

it("treats oauth-or-api-key and api-key as API key preference", () => {
  assert.equal(resolveProviderAuthMode("oauth-or-api-key"), "prefer-api-key");
  assert.equal(resolveProviderAuthMode(" api_key "), "prefer-api-key");
  assert.equal(resolveProviderAuthMode("oauth"), "unchanged");
  assert.equal(resolveProviderAuthMode(undefined), "unchanged");
});

it("reads the Codex API key only when the mode prefers it", () => {
  const base = {
    [PROVIDER_AUTH_MODE_ENV.codex]: "oauth-or-api-key",
    OPENAI_API_KEY: "openai-key",
  } satisfies NodeJS.ProcessEnv;

  assert.equal(codexApiKeyFromEnvironment(base), "openai-key");
  assert.equal(codexApiKeyFromEnvironment({ ...base, CODEX_API_KEY: "codex-key" }), "codex-key");
  assert.equal(
    codexApiKeyFromEnvironment({ ...base, [PROVIDER_AUTH_MODE_ENV.codex]: "oauth" }),
    undefined,
  );
  assert.equal(
    codexApiKeyFromEnvironment({ [PROVIDER_AUTH_MODE_ENV.codex]: "oauth-or-api-key" }),
    undefined,
  );
});

it.layer(NodeServices.layer)("Codex API-key auth file", (it) => {
  it.effect("writes a private auth.json that selects API-key auth", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "codex-auth-home-" });
      const authHome = managedCodexAuthHome(homePath, "codex_personal");

      yield* writeCodexApiKeyAuth({ homePath: authHome, apiKey: "rolled-key" });

      const authPath = path.join(authHome, "auth.json");
      const written = decodeCodexApiKeyAuth(yield* fileSystem.readFileString(authPath));
      assert.deepEqual(written, { auth_mode: "apikey", OPENAI_API_KEY: "rolled-key" });
      const permissions = (yield* fileSystem.stat(authPath)).mode & 0o777;
      assert.equal(permissions, 0o600);
    }),
  );
});
