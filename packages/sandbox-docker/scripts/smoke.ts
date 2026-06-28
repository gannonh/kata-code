// @effect-diagnostics nodeBuiltinImport:off - driver smoke against live Docker.
// @effect-diagnostics globalConsole:off - prints smoke results.
import * as Effect from "effect/Effect";

import { DockerSandboxProvider, dockerConfigDecoder } from "../src/index.ts";

/**
 * Live smoke for DockerSandboxProvider: validate → provision → reachability →
 * dispose, proving the driver actually boots a container and resolves a loopback
 * endpoint. Not a unit test (touches a real daemon); run manually.
 */
const config = dockerConfigDecoder({
  image: "node:22-alpine",
  command:
    "node -e \"require('http').createServer((q,s)=>{if(q.url==='/healthz'){s.writeHead(200);s.end('ok')}}).listen(13773)\"",
  port: 13773,
});

const program = Effect.gen(function* () {
  yield* DockerSandboxProvider.validate(config);
  const handle = yield* DockerSandboxProvider.provision({
    instanceId: "smoke",
    config,
    image: config.image,
    env: [],
  });
  const reach = yield* DockerSandboxProvider.reachability(handle, 13773);
  console.log("reachability:", reach.httpBaseUrl);
  const res = yield* Effect.tryPromise({
    try: () => fetch(`${reach.httpBaseUrl}/healthz`),
    catch: (e) => new Error(String(e)),
  });
  console.log("healthz:", res.status);
  yield* DockerSandboxProvider.dispose(handle);
  console.log("SMOKE: PASS");
});

Effect.runPromise(program).then(
  () => process.exit(0),
  (e) => {
    console.error("SMOKE: FAIL", e);
    process.exit(1);
  },
);
