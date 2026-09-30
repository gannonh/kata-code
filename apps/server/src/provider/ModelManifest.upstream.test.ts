import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { BUNDLED_MODEL_MANIFEST, make, type ModelManifestData } from "./ModelManifest.ts";

const REMOTE_UPDATED_AT = "2099-01-01T00:00:00Z";
const REMOTE_MANIFEST: ModelManifestData = {
  version: 1,
  updatedAt: REMOTE_UPDATED_AT,
  currentModels: { codex: ["remote-model"] },
};

const httpClientLayer = (handler: () => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler()))),
  );

const serviceLayers = (response: () => Response) =>
  ServerConfig.layerTest(process.cwd(), {
    prefix: "model-manifest-upstream-stale-refresh-test",
  }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(httpClientLayer(response)),
  );

it.live("preserves a newer manifest across stale remote refreshes and service restarts", () => {
  let remote: ModelManifestData = { ...REMOTE_MANIFEST, updatedAt: "2000-01-01T00:00:00Z" };
  return Effect.gen(function* () {
    const service = yield* make;
    assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
    assert.deepStrictEqual(yield* service.current, BUNDLED_MODEL_MANIFEST);

    remote = REMOTE_MANIFEST;
    assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
    remote = { ...REMOTE_MANIFEST, updatedAt: BUNDLED_MODEL_MANIFEST.updatedAt };
    assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
    const rebooted = yield* make;
    assert.deepStrictEqual(yield* rebooted.current, REMOTE_MANIFEST);
  }).pipe(Effect.scoped, Effect.provide(serviceLayers(() => Response.json(remote))));
});
