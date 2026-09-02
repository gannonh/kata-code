// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - this test exercises the Unix-socket HTTP upgrade directly.
// @effect-diagnostics preferSchemaOverJson:off - this test asserts Docker's private wire JSON.
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeDockerEngine } from "./engine.ts";

function closeServer(server: NodeHttp.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

describe("Docker engine request timeout", () => {
  it.effect("times out a streaming response that never ends", () => {
    return Effect.acquireUseRelease(
      Effect.promise(async () => {
        const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kata-docker-"));
        const socketPath = NodePath.join(directory, "engine.sock");
        const server = NodeHttp.createServer((_request, response) => {
          response.writeHead(200, { "Content-Type": "application/json" });
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(socketPath, resolve);
        });
        return { directory, server, socketPath };
      }),
      ({ socketPath }) =>
        Effect.gen(function* () {
          const result = yield* makeDockerEngine(socketPath)
            .request({ path: "/never-ends", timeoutMs: 200 })
            .pipe(Effect.result);
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") {
            expect(result.failure.message).toContain("timed out after 200ms");
          }
        }),
      ({ directory, server }) =>
        Effect.promise(async () => {
          await closeServer(server);
          await NodeFSP.rm(directory, { recursive: true });
        }),
    );
  });

  it.live("rejects a chatty hijacked stream on the wall-clock timeout", () => {
    return Effect.acquireUseRelease(
      Effect.promise(async () => {
        const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kata-docker-"));
        const socketPath = NodePath.join(directory, "engine.sock");
        const server = NodeHttp.createServer();
        server.on("upgrade", (_request, socket) => {
          socket.write("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
          const tick = setInterval(() => {
            if (socket.destroyed) {
              clearInterval(tick);
              return;
            }
            socket.write("progress\n", (error) => {
              if (error !== null) clearInterval(tick);
            });
          }, 40);
          socket.on("error", () => clearInterval(tick));
          socket.on("close", () => clearInterval(tick));
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(socketPath, resolve);
        });
        return { directory, server, socketPath };
      }),
      ({ socketPath }) =>
        Effect.gen(function* () {
          const result = yield* makeDockerEngine(socketPath)
            .requestBuffer({
              path: "/exec/exec-1/start",
              method: "POST",
              body: JSON.stringify({ Detach: false, Tty: false }),
              hijacked: true,
              timeoutMs: 200,
            })
            .pipe(Effect.result);
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") {
            expect(result.failure.message).toContain("timed out after 200ms");
          }
        }),
      ({ directory, server }) =>
        Effect.promise(async () => {
          await closeServer(server);
          await NodeFSP.rm(directory, { recursive: true });
        }),
    );
  });
});

describe("Docker engine stdin requests", () => {
  it.effect("waits for the HTTP upgrade before writing binary stdin", () => {
    const requestBodies: Buffer[] = [];
    const stdinChunks: Buffer[] = [];
    return Effect.acquireUseRelease(
      Effect.promise(async () => {
        const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kata-docker-"));
        const socketPath = NodePath.join(directory, "engine.sock");
        const server = NodeHttp.createServer();
        server.on("upgrade", (request, socket, head) => {
          const bodyLength = Number(request.headers["content-length"] ?? 0);
          requestBodies.push(head.subarray(0, bodyLength));
          socket.write("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
          if (head.length > bodyLength) stdinChunks.push(head.subarray(bodyLength));
          socket.on("data", (chunk: Buffer) => stdinChunks.push(chunk));
          socket.on("end", () => socket.end());
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(socketPath, resolve);
        });
        return { directory, server, socketPath };
      }),
      ({ socketPath }) =>
        Effect.gen(function* () {
          const sentinel = Buffer.from("stdin-only-sentinel");
          const response = yield* makeDockerEngine(socketPath).requestStdin(
            {
              path: "/exec/exec-1/start",
              method: "POST",
              body: JSON.stringify({ Detach: false, Tty: false }),
            },
            sentinel,
          );

          expect(response.status).toBe(101);
          expect(Buffer.concat(requestBodies).toString("utf8")).toBe(
            JSON.stringify({ Detach: false, Tty: false }),
          );
          expect(Buffer.concat(requestBodies).includes(sentinel)).toBe(false);
          expect(Buffer.concat(stdinChunks)).toEqual(sentinel);
        }),
      ({ directory, server }) =>
        Effect.promise(async () => {
          await closeServer(server);
          await NodeFSP.rm(directory, { recursive: true });
        }),
    );
  });
});
