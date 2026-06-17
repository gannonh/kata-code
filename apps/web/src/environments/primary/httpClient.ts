import { makeEnvironmentHttpApiClient } from "@kata-sh/code-client-runtime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export type PrimaryEnvironmentHttpClientShape = Effect.Success<
  ReturnType<typeof makeEnvironmentHttpApiClient>
>;

export class PrimaryEnvironmentHttpClient extends Context.Service<
  PrimaryEnvironmentHttpClient,
  PrimaryEnvironmentHttpClientShape
>()("@kata-sh/code-web/environments/primary/httpClient/PrimaryEnvironmentHttpClient") {}

export const primaryEnvironmentHttpClientLive = Layer.effect(
  PrimaryEnvironmentHttpClient,
  Effect.suspend(() => makeEnvironmentHttpApiClient(resolvePrimaryEnvironmentHttpUrl("/"))),
);
