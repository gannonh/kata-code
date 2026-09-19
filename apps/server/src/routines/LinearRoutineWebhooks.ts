import { RoutineError } from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  makeLinearGraphqlRequest,
  type LinearGraphqlRequest,
  type LinearMetadataError,
} from "./LinearRoutineMetadata.ts";

const MAX_ERROR_TEXT = 200;

const bounded = (value: string): string =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_TEXT);

const blocked = (message: string): RoutineError =>
  new RoutineError({ code: "blocked", message: bounded(message) });

export interface LinearWebhookAdminShape {
  readonly createWebhook: (input: {
    readonly accessToken: string;
    readonly callbackUrl: string;
    readonly allTeams: boolean;
    readonly teamId: string | undefined;
  }) => Effect.Effect<{ readonly webhookId: string; readonly secret: string }, RoutineError>;
  readonly deleteWebhook: (input: {
    readonly accessToken: string;
    readonly webhookId: string;
  }) => Effect.Effect<void, RoutineError>;
}

export class LinearWebhookAdmin extends Context.Service<
  LinearWebhookAdmin,
  LinearWebhookAdminShape
>()("@kata-sh/code-cli/routines/LinearRoutineWebhooks/LinearWebhookAdmin") {}

const CreateWebhookJson = Schema.Struct({
  data: Schema.Struct({
    webhookCreate: Schema.Struct({
      webhook: Schema.NullOr(Schema.Struct({ id: Schema.String, secret: Schema.String })),
    }),
  }),
});

const DeleteWebhookJson = Schema.Struct({
  data: Schema.Struct({
    webhookDelete: Schema.Struct({ success: Schema.Boolean }),
  }),
});

const decodeCreateWebhook = Schema.decodeUnknownEffect(CreateWebhookJson);
const decodeDeleteWebhook = Schema.decodeUnknownEffect(DeleteWebhookJson);

/** JSON string escaping is valid GraphQL string escaping. */
const gqlString = (value: string): string => JSON.stringify(value);

const createWebhookQuery = (input: {
  readonly callbackUrl: string;
  readonly allTeams: boolean;
  readonly teamId: string;
}): string =>
  `mutation {
  webhookCreate(input: { url: ${gqlString(input.callbackUrl)}, resourceTypes: ["Issue"], enabled: true, ${
    input.allTeams ? "allPublicTeams: true" : `teamId: ${gqlString(input.teamId)}`
  } }) {
    webhook { id secret }
  }
}`;

const deleteWebhookQuery = (webhookId: string): string =>
  `mutation {
  webhookDelete(id: ${gqlString(webhookId)}) { success }
}`;

const transportFailure = (error: LinearMetadataError): RoutineError =>
  blocked(
    error._tag === "access"
      ? "Linear rejected the webhook access token. Disconnect and reconnect Linear, then try again."
      : error.message,
  );

/**
 * Owns the Linear webhook lifecycle through the delivered OAuth access token.
 * Requests never carry the token in a query or an error message, and the
 * returned signing secret travels only to the caller.
 */
export function makeLinearWebhookAdmin(dependencies: {
  readonly graphql: (request: LinearGraphqlRequest) => Effect.Effect<unknown, LinearMetadataError>;
}): LinearWebhookAdminShape {
  const decodeFailure = () => blocked("Linear returned an unexpected webhook response.");

  const createWebhook: LinearWebhookAdminShape["createWebhook"] = Effect.fn(
    "LinearWebhookAdmin.createWebhook",
  )(function* (input) {
    if (!input.allTeams && (input.teamId === undefined || input.teamId.length === 0))
      return yield* Effect.fail(blocked("A team-scoped Linear webhook needs exactly one team."));
    const raw = yield* dependencies
      .graphql({
        accessToken: input.accessToken,
        query: createWebhookQuery({
          callbackUrl: input.callbackUrl,
          allTeams: input.allTeams,
          teamId: input.teamId ?? "",
        }),
      })
      .pipe(Effect.mapError(transportFailure));
    const parsed = yield* decodeCreateWebhook(raw).pipe(Effect.mapError(decodeFailure));
    const webhook = parsed.data.webhookCreate.webhook;
    if (webhook === null)
      return yield* Effect.fail(blocked("Linear did not return the created webhook."));
    return { webhookId: webhook.id, secret: webhook.secret };
  });

  const deleteWebhook: LinearWebhookAdminShape["deleteWebhook"] = Effect.fn(
    "LinearWebhookAdmin.deleteWebhook",
  )(function* (input) {
    const raw = yield* dependencies
      .graphql({ accessToken: input.accessToken, query: deleteWebhookQuery(input.webhookId) })
      .pipe(Effect.mapError(transportFailure));
    const parsed = yield* decodeDeleteWebhook(raw).pipe(Effect.mapError(decodeFailure));
    if (!parsed.data.webhookDelete.success)
      return yield* Effect.fail(blocked("Linear refused to delete the webhook."));
  });

  return { createWebhook, deleteWebhook };
}

export const LinearWebhookAdminLive = Layer.succeed(
  LinearWebhookAdmin,
  makeLinearWebhookAdmin({ graphql: makeLinearGraphqlRequest(fetch) }),
);
