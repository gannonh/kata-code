import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import {
  makeLinearOAuth,
  LINEAR_AUTHORIZE_URL,
  LINEAR_OAUTH_REQUEST_TIMEOUT_MS,
  LINEAR_OAUTH_SCOPES,
  LINEAR_REVOKE_ENDPOINT,
  LINEAR_TOKEN_ENDPOINT,
} from "./LinearOAuth.ts";

const CLIENT_SECRET = "linear-client-secret";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const makeFetch = (respond: () => Promise<Response>) => {
  const calls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { calls, fetchImpl };
};

const makeOAuth = (fetchImpl: typeof fetch) =>
  makeLinearOAuth({
    clientId: "linear-client-id",
    clientSecret: CLIENT_SECRET,
    redirectUri: "https://relay.example.com/v1/linear/oauth/callback",
    fetch: fetchImpl,
  });

describe("LinearOAuth", () => {
  it.effect("builds an authorize URL with PKCE parameters and never the client secret", () =>
    Effect.gen(function* () {
      const url = new URL(
        yield* makeOAuth(
          makeFetch(() => Promise.reject(new Error("unused"))).fetchImpl,
        ).authorizeUrl({ state: "state-token", codeChallenge: "code-challenge" }),
      );

      expect(`${url.origin}${url.pathname}`).toBe(LINEAR_AUTHORIZE_URL);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("client_id")).toBe("linear-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://relay.example.com/v1/linear/oauth/callback",
      );
      expect(url.searchParams.get("scope")).toBe(LINEAR_OAUTH_SCOPES);
      expect(url.searchParams.get("scope")).toBe("read,write,admin");
      expect(url.searchParams.get("actor")).toBe("user");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("state")).toBe("state-token");
      expect(url.searchParams.get("code_challenge")).toBe("code-challenge");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.toString()).not.toContain("client_secret");
    }),
  );

  it.effect("exchanges an authorization code with a form-encoded token request", () => {
    const { calls, fetchImpl } = makeFetch(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "linear-access-token",
          refresh_token: "linear-refresh-token",
          expires_in: 3600,
          scope: "read,admin",
        }),
      ),
    );

    return Effect.gen(function* () {
      const now = yield* DateTime.now;
      const bundle = yield* makeOAuth(fetchImpl).exchangeCode({
        code: "authorization-code",
        codeVerifier: "code-verifier",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(LINEAR_TOKEN_ENDPOINT);
      expect(calls[0]?.init?.method).toBe("POST");
      const body = new URLSearchParams(String(calls[0]?.init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe("linear-client-id");
      expect(body.get("client_secret")).toBe(CLIENT_SECRET);
      expect(body.get("redirect_uri")).toBe("https://relay.example.com/v1/linear/oauth/callback");
      expect(body.get("code")).toBe("authorization-code");
      expect(body.get("code_verifier")).toBe("code-verifier");

      expect(bundle.accessToken).toBe("linear-access-token");
      expect(bundle.refreshToken).toBe("linear-refresh-token");
      expect(bundle.scope).toBe("read,admin");
      expect(bundle.expiresAt).toBe(now.epochMilliseconds + 3_600_000);
    });
  });

  it.effect("calls injected fetch without an object receiver", () => {
    const fetchImpl = async function receiverSensitiveFetch(
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      if (this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      return jsonResponse({
        access_token: "linear-access-token",
        refresh_token: "linear-refresh-token",
        expires_in: 3600,
      });
    } as typeof fetch;

    return Effect.gen(function* () {
      const bundle = yield* makeOAuth(fetchImpl).exchangeCode({
        code: "authorization-code",
        codeVerifier: "code-verifier",
      });

      expect(bundle.accessToken).toBe("linear-access-token");
    });
  });

  it.effect("reports a rejected exchange without leaking secrets or the response body", () => {
    const { fetchImpl } = makeFetch(() =>
      Promise.resolve(jsonResponse({ error: "invalid_grant", detail: "raw-body-token" }, 400)),
    );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        makeOAuth(fetchImpl).exchangeCode({
          code: "authorization-code",
          codeVerifier: "code-verifier",
        }),
      );

      expect(error).toMatchObject({ _tag: "LinearOAuthRequestFailed", reason: "rejected" });
      expect(error.message).toContain("400");
      for (const secret of [
        CLIENT_SECRET,
        "authorization-code",
        "code-verifier",
        "raw-body-token",
      ]) {
        expect(error.message).not.toContain(secret);
      }
    });
  });

  it.effect("classifies network failures as unavailable without leaking the secret", () => {
    const { fetchImpl } = makeFetch(() => Promise.reject(new Error("socket hang up")));

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        makeOAuth(fetchImpl).exchangeCode({
          code: "authorization-code",
          codeVerifier: "code-verifier",
        }),
      );

      expect(error).toMatchObject({ _tag: "LinearOAuthRequestFailed", reason: "unavailable" });
      expect(error.message).not.toContain(CLIENT_SECRET);
    });
  });

  it.effect("classifies unparsable token responses as invalid", () => {
    const { fetchImpl } = makeFetch(() =>
      Promise.resolve(new Response("<html>not json</html>", { status: 200 })),
    );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        makeOAuth(fetchImpl).exchangeCode({
          code: "authorization-code",
          codeVerifier: "code-verifier",
        }),
      );

      expect(error).toMatchObject({
        _tag: "LinearOAuthRequestFailed",
        reason: "invalid_response",
      });
      expect(error.message).not.toContain(CLIENT_SECRET);
    });
  });

  it.effect("rotates the refresh token when the token endpoint returns a new one", () => {
    const bodies: Array<URLSearchParams> = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(new URLSearchParams(String(init?.body)));
      return jsonResponse({
        access_token: "rotated-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 1800,
        scope: "read",
      });
    }) as typeof fetch;

    return Effect.gen(function* () {
      const bundle = yield* makeOAuth(fetchImpl).refresh({
        refreshToken: "previous-refresh-token",
      });

      expect(bodies[0]?.get("grant_type")).toBe("refresh_token");
      expect(bodies[0]?.get("refresh_token")).toBe("previous-refresh-token");
      expect(bundle.accessToken).toBe("rotated-access-token");
      expect(bundle.refreshToken).toBe("rotated-refresh-token");
    });
  });

  it.effect("keeps the previous refresh token when the token endpoint omits a replacement", () => {
    const { fetchImpl } = makeFetch(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "refreshed-access-token",
          expires_in: 1800,
          scope: "read",
        }),
      ),
    );

    return Effect.gen(function* () {
      const bundle = yield* makeOAuth(fetchImpl).refresh({
        refreshToken: "previous-refresh-token",
      });

      expect(bundle.accessToken).toBe("refreshed-access-token");
      expect(bundle.refreshToken).toBe("previous-refresh-token");
    });
  });
  it.effect("rejects a code exchange that returns no refresh token", () => {
    const { fetchImpl } = makeFetch(() =>
      Promise.resolve(jsonResponse({ access_token: "linear-access-token", expires_in: 3600 })),
    );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        makeOAuth(fetchImpl).exchangeCode({
          code: "authorization-code",
          codeVerifier: "code-verifier",
        }),
      );

      expect(error).toMatchObject({
        _tag: "LinearOAuthRequestFailed",
        reason: "invalid_response",
      });
    });
  });

  it.effect("revokes the refresh token and the access token at Linear", () => {
    const { calls, fetchImpl } = makeFetch(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );

    return Effect.gen(function* () {
      yield* makeOAuth(fetchImpl).revoke({
        accessToken: "linear-access-token",
        refreshToken: "linear-refresh-token",
      });

      expect(calls.map((call) => call.url)).toEqual([
        LINEAR_REVOKE_ENDPOINT,
        LINEAR_REVOKE_ENDPOINT,
      ]);
      const bodies = calls.map((call) => new URLSearchParams(String(call.init?.body)));
      expect(bodies.map((body) => [body.get("token"), body.get("token_type_hint")])).toEqual([
        ["linear-refresh-token", "refresh_token"],
        ["linear-access-token", "access_token"],
      ]);
    });
  });

  it.effect("treats a token Linear cannot revoke as already revoked", () => {
    const { fetchImpl } = makeFetch(() => Promise.resolve(jsonResponse({ error: "invalid" }, 400)));

    return makeOAuth(fetchImpl).revoke({
      accessToken: "linear-access-token",
      refreshToken: "linear-refresh-token",
    });
  });

  it.effect("fails revocation when Linear is unavailable, without leaking the tokens", () => {
    const { fetchImpl } = makeFetch(() => Promise.resolve(new Response(null, { status: 503 })));

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        makeOAuth(fetchImpl).revoke({
          accessToken: "linear-access-token",
          refreshToken: "linear-refresh-token",
        }),
      );

      expect(error).toMatchObject({ _tag: "LinearOAuthRequestFailed", reason: "unavailable" });
      expect(error.message).not.toContain("linear-access-token");
      expect(error.message).not.toContain("linear-refresh-token");
    });
  });

  it.effect("aborts a stalled Linear request and reports it as unavailable", () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    return Effect.gen(function* () {
      const fiber = yield* makeOAuth(fetchImpl)
        .refresh({ refreshToken: "linear-refresh-token" })
        .pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(Duration.millis(LINEAR_OAUTH_REQUEST_TIMEOUT_MS));
      const error = yield* Fiber.join(fiber);

      expect(error).toMatchObject({ _tag: "LinearOAuthRequestFailed", reason: "unavailable" });
      expect(signals[0]?.aborted).toBe(true);
    });
  });
});
