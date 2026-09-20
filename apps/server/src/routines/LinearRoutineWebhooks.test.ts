import { assert, it } from "@effect/vitest";
import { RoutineError } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";

import type { LinearGraphqlRequest, LinearMetadataError } from "./LinearRoutineMetadata.ts";
import { type LinearWebhookAdminShape, makeLinearWebhookAdmin } from "./LinearRoutineWebhooks.ts";

interface Harness {
  readonly admin: LinearWebhookAdminShape;
  readonly requests: Array<LinearGraphqlRequest>;
}

const makeHarness = (
  respond: (request: LinearGraphqlRequest) => unknown | LinearMetadataError,
): Harness => {
  const requests: Array<LinearGraphqlRequest> = [];
  const admin = makeLinearWebhookAdmin({
    graphql: (request) => {
      requests.push(request);
      const result = respond(request);
      return typeof result === "object" && result !== null && "_tag" in result
        ? Effect.fail(result as LinearMetadataError)
        : Effect.succeed(result);
    },
  });
  return { admin, requests };
};

const createInput = {
  accessToken: "linear-access-token",
  callbackUrl: "https://env.example/api/routines/webhooks/linear/connection-1",
  allTeams: true,
  teamId: undefined,
} as const;

const createResponse = {
  data: { webhookCreate: { webhook: { id: "webhook-1", secret: "webhook-secret-1" } } },
};

it.effect("creates a webhook and returns its id and secret", () =>
  Effect.gen(function* () {
    const { admin, requests } = makeHarness(() => createResponse);

    const created = yield* admin.createWebhook(createInput);

    assert.deepEqual(created, { webhookId: "webhook-1", secret: "webhook-secret-1" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.accessToken, "linear-access-token");
  }),
);

it.effect("asks Linear for all public teams or a single team scope", () =>
  Effect.gen(function* () {
    const { admin, requests } = makeHarness(() => createResponse);

    yield* admin.createWebhook(createInput);
    yield* admin.createWebhook({ ...createInput, allTeams: false, teamId: "team-1" });

    assert.equal(requests.length, 2);
    assert.include(requests[0]!.query, "allPublicTeams: true");
    assert.notInclude(requests[0]!.query, "teamId:");
    assert.include(requests[1]!.query, 'teamId: "team-1"');
    assert.notInclude(requests[1]!.query, "allPublicTeams");
    assert.include(requests[0]!.query, '"Issue"');
    assert.include(requests[0]!.query, "enabled: true");
  }),
);

it.effect("maps an access failure to a bounded blocked error without the token", () =>
  Effect.gen(function* () {
    const { admin } = makeHarness(() => ({
      _tag: "access",
      message: "Authentication required for linear-access-token",
    }));

    const error = yield* admin.createWebhook(createInput).pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.notInclude(error.message, "linear-access-token");
  }),
);

it.effect("deletes the webhook and treats a refusal as blocked", () =>
  Effect.gen(function* () {
    const succeeded = makeHarness(() => ({ data: { webhookDelete: { success: true } } }));

    yield* succeeded.admin.deleteWebhook({
      accessToken: "linear-access-token",
      webhookId: "webhook-1",
    });
    assert.include(succeeded.requests[0]!.query, 'webhookDelete(id: "webhook-1")');

    const refused = makeHarness(() => ({ data: { webhookDelete: { success: false } } }));
    const error = yield* refused.admin
      .deleteWebhook({ accessToken: "linear-access-token", webhookId: "webhook-1" })
      .pipe(Effect.flip);
    assert.equal(error.code, "blocked");
    assert.notInclude(error.message, "linear-access-token");
  }),
);

it.effect("rejects an unexpected response without echoing it", () =>
  Effect.gen(function* () {
    const { admin } = makeHarness(() => ({ data: { webhookCreate: { webhook: null } } }));

    const error = yield* admin.createWebhook(createInput).pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.isBelow(error.message.length, 200);
    assert.notInclude(error.message, "webhook-secret-1");
  }),
);
