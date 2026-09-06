// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Docker Engine access uses the Unix-socket HTTP API.
import * as NodeHttp from "node:http";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export class DockerEngineError extends Data.TaggedError("DockerEngineError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DockerRequest {
  readonly path: string;
  readonly method?: string;
  readonly body?: string;
  readonly bodyBytes?: Uint8Array;
  readonly contentType?: string;
  readonly timeoutMs?: number;
  readonly hijacked?: boolean;
}

export interface DockerResponse {
  readonly status: number;
  readonly body: string;
}

export interface DockerBufferResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

export interface DockerEngine {
  readonly request: (request: DockerRequest) => Effect.Effect<DockerResponse, DockerEngineError>;
  readonly requestBuffer: (
    request: DockerRequest,
  ) => Effect.Effect<DockerBufferResponse, DockerEngineError>;
  readonly requestStdin: (
    request: DockerRequest,
    stdin: Uint8Array,
  ) => Effect.Effect<DockerBufferResponse, DockerEngineError>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function requestHeaders(request: DockerRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(request.body));
  } else if (request.bodyBytes !== undefined) {
    headers["Content-Type"] = request.contentType ?? "application/x-tar";
    headers["Content-Length"] = String(request.bodyBytes.byteLength);
  }
  if (request.hijacked === true) {
    headers.Connection = "Upgrade";
    headers.Upgrade = "tcp";
  } else {
    headers.Connection = "close";
  }
  return headers;
}

function normalizeError(cause: unknown): DockerEngineError {
  return new DockerEngineError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function timeoutError(path: string, timeoutMs: number): DockerEngineError {
  return new DockerEngineError({
    message: `Docker request ${path} timed out after ${timeoutMs}ms`,
  });
}

function destroyLater(
  socket: { destroy: (error?: Error) => void } | undefined,
  request: NodeHttp.ClientRequest,
): void {
  setImmediate(() => {
    try {
      socket?.destroy();
      request.destroy();
    } catch {
      // Hijacked Docker sockets can block destroy after the request settled.
    }
  });
}

function makeRequest(
  socketPath: string,
  request: DockerRequest,
  binary: boolean,
): Effect.Effect<DockerResponse | DockerBufferResponse, DockerEngineError> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<DockerResponse | DockerBufferResponse>((resolve, reject) => {
        let settled = false;
        let nodeRequest: NodeHttp.ClientRequest;
        let upgradedSocket: { destroy: (error?: Error) => void } | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (complete: () => void) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          complete();
        };
        const fail = (cause: unknown) =>
          settle(() => {
            reject(cause);
            destroyLater(upgradedSocket, nodeRequest);
          });
        const onAbort = () => fail(new Error(`Docker request ${request.path} was interrupted`));
        const onTimeout = () => fail(timeoutError(request.path, timeoutMs));
        const finish = (status: number, chunks: Buffer[]) => {
          const body = Buffer.concat(chunks);
          settle(() =>
            resolve(binary ? { status, body } : { status, body: body.toString("utf8") }),
          );
        };

        nodeRequest = NodeHttp.request({
          socketPath,
          path: request.path,
          method: request.method ?? "GET",
          headers: requestHeaders(request),
          timeout: timeoutMs,
          agent: false,
        });
        nodeRequest.on("response", (response) => {
          const chunks: Buffer[] = [];
          // ClientRequest#timeout only covers time-to-headers. Hijacked Docker
          // exec start returns headers immediately and streams until the command
          // exits. Destroy without reject left identify Running for 10 minutes.
          if (timeoutMs > 0) response.setTimeout(timeoutMs, onTimeout);
          response.on("error", fail);
          response.on("data", (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          response.on("end", () => finish(response.statusCode ?? 0, chunks));
        });
        nodeRequest.on("upgrade", (response, socket, head) => {
          upgradedSocket = socket;
          const chunks: Buffer[] = [];
          if (head.length > 0) chunks.push(head);
          if (timeoutMs > 0) socket.setTimeout(timeoutMs, onTimeout);
          socket.on("error", fail);
          socket.on("data", (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          socket.on("end", () => finish(response.statusCode ?? 0, chunks));
        });
        if (timeoutMs > 0) {
          nodeRequest.on("timeout", onTimeout);
          // Docker's unix socket often never emits Node's idle timeout or
          // response 'end'. A wall-clock deadline is the only bound that
          // always rejects the Promise.
          timer = setTimeout(onTimeout, timeoutMs);
        }
        nodeRequest.on("error", fail);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        if (request.body !== undefined) nodeRequest.write(request.body);
        if (request.bodyBytes !== undefined) nodeRequest.write(Buffer.from(request.bodyBytes));
        nodeRequest.end();
      }),
    catch: normalizeError,
  });
}

function makeStdinRequest(
  socketPath: string,
  request: DockerRequest,
  stdin: Uint8Array,
): Effect.Effect<DockerBufferResponse, DockerEngineError> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<DockerBufferResponse>((resolve, reject) => {
        let settled = false;
        let upgradedSocket:
          | (NodeJS.WritableStream & { destroy: (error?: Error) => void })
          | undefined;
        const chunks: Buffer[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        const nodeRequest = NodeHttp.request({
          socketPath,
          path: request.path,
          method: request.method ?? "POST",
          headers: {
            ...requestHeaders(request),
            Connection: "Upgrade",
            Upgrade: "tcp",
          },
          timeout: timeoutMs,
          agent: false,
        });
        const settle = (complete: () => void) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          complete();
        };
        const fail = (cause: unknown) =>
          settle(() => {
            reject(cause);
            destroyLater(upgradedSocket, nodeRequest);
          });
        const onAbort = () => fail(new Error(`Docker request ${request.path} was interrupted`));
        const onTimeout = () => fail(timeoutError(request.path, timeoutMs));

        nodeRequest.on("upgrade", (response, socket, head) => {
          upgradedSocket = socket;
          if (timeoutMs > 0) socket.setTimeout(timeoutMs, onTimeout);
          if (head.length > 0) chunks.push(head);
          socket.on("data", (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          socket.on("error", fail);
          socket.on("end", () =>
            settle(() =>
              resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
            ),
          );
          socket.on("close", () =>
            settle(() =>
              resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
            ),
          );
          socket.end(Buffer.from(stdin.buffer, stdin.byteOffset, stdin.byteLength));
        });
        nodeRequest.on("response", (response) => {
          if (timeoutMs > 0) response.setTimeout(timeoutMs, onTimeout);
          response.on("error", fail);
          response.on("data", (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          response.on("end", () =>
            settle(() =>
              resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
            ),
          );
        });
        if (timeoutMs > 0) {
          nodeRequest.on("timeout", onTimeout);
          timer = setTimeout(onTimeout, timeoutMs);
        }
        nodeRequest.on("error", fail);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        if (request.body !== undefined) nodeRequest.write(request.body);
        nodeRequest.end();
      }),
    catch: normalizeError,
  });
}

export function makeDockerEngine(socketPath: string): DockerEngine {
  return {
    request: (request) =>
      makeRequest(socketPath, request, false).pipe(
        Effect.flatMap((response) =>
          typeof response.body === "string"
            ? Effect.succeed({ status: response.status, body: response.body })
            : Effect.fail(
                new DockerEngineError({
                  message: "Docker Engine returned a binary response for a text request.",
                }),
              ),
        ),
      ),
    requestBuffer: (request) =>
      makeRequest(socketPath, request, true).pipe(
        Effect.flatMap((response) =>
          typeof response.body !== "string"
            ? Effect.succeed({ status: response.status, body: response.body })
            : Effect.fail(
                new DockerEngineError({
                  message: "Docker Engine returned a text response for a binary request.",
                }),
              ),
        ),
      ),
    requestStdin: (request, stdin) => makeStdinRequest(socketPath, request, stdin),
  };
}
