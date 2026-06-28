import { describe, expect, it } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DockerSandboxProvider,
  dockerConfigDecoder,
  DOCKER_KIND,
} from "./DockerSandboxProvider.ts";
import { DockerSandboxConfig, DEFAULT_DOCKER_CONFIG } from "./config.ts";

const decodeConfig = Schema.decodeUnknownSync(DockerSandboxConfig);

describe("DockerSandboxProvider (non-Docker unit coverage)", () => {
  it("kind is the branded 'docker' slug", () => {
    expect(DOCKER_KIND as string).toBe("docker");
  });

  it("config decodes a full payload", () => {
    const decoded = decodeConfig({
      image: "node:22-alpine",
      command: "katacode serve --port 13773",
      port: 13773,
    });
    expect(decoded.image).toBe("node:22-alpine");
    expect(decoded.port).toBe(13773);
  });

  it("dockerConfigDecoder is the registry-facing decode function", () => {
    const decoded = dockerConfigDecoder({ image: "alpine", command: "x", port: 1 });
    expect(decoded.port).toBe(1);
  });

  vitIt.effect(
    "describe() advertises loopback reachability and no snapshot support (Phase 1)",
    () =>
      Effect.gen(function* () {
        const d = yield* DockerSandboxProvider.describe();
        expect(d.kind as string).toBe("docker");
        expect(d.reachabilityKind).toBe("loopback");
        expect(d.supportsSnapshot).toBe(false);
        expect(d.supportsRenewTimeout).toBe(false);
        expect(d.baseImages?.[0]).toBe(DEFAULT_DOCKER_CONFIG.image);
      }),
  );

  vitIt.effect("reachability() resolves a loopback localhost URL from a handle", () =>
    Effect.gen(function* () {
      const handle = {
        driverKind: DOCKER_KIND,
        instanceId: "x",
        handle: { containerId: "c", hostPort: 32789, containerPort: 13773 },
      };
      const r = yield* DockerSandboxProvider.reachability(handle, 13773);
      expect(r.reachabilityKind).toBe("loopback");
      expect(r.httpBaseUrl).toBe("http://localhost:32789");
      expect(r.wsBaseUrl).toBe("ws://localhost:32789");
    }),
  );
});
