import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as VcsProcess from "./VcsProcess.ts";

const run = (input: VcsProcess.VcsProcessInput) =>
  Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    return yield* process.run(input);
  });

const liveLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));

const provideLive = <A, E, R>(effect: Effect.Effect<A, E, R | VcsProcess.VcsProcess>) =>
  effect.pipe(Effect.provide(liveLayer));

describe("VcsProcess.run", () => {
  it.effect("streams all stdout bytes beyond the buffered output cap", () =>
    Effect.gen(function* () {
      const chunks: Uint8Array[] = [];
      const result = yield* run({
        operation: "test.stream-output",
        command: "node",
        args: ["-e", "process.stdout.write('x'.repeat(131072) + '\\0S final\\0')"],
        cwd: process.cwd(),
        maxOutputBytes: 8,
        onStdoutChunk: (chunk) => chunks.push(chunk),
      });

      expect(result.stdout).toBe("xxxxxxxx");
      expect(result.stdoutTruncated).toBe(true);
      expect(Buffer.concat(chunks).toString()).toBe("x".repeat(131072) + "\0S final\0");
    }).pipe(provideLive),
  );
});
