// @effect-diagnostics nodeBuiltinImport:off - Docker Engine access uses the Unix-socket HTTP API.
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
}

const DEFAULT_TIMEOUT_MS = 30_000;

function requestHeaders(request: DockerRequest): Record<string, string> {
  if (request.body !== undefined) {
    return {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(request.body)),
    };
  }
  if (request.bodyBytes !== undefined) {
    return {
      "Content-Type": request.contentType ?? "application/x-tar",
      "Content-Length": String(request.bodyBytes.byteLength),
    };
  }
  return request.hijacked === true ? { Connection: "close" } : {};
}

function normalizeError(cause: unknown): DockerEngineError {
  return new DockerEngineError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
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
        const onAbort = () =>
          nodeRequest.destroy(new Error(`Docker request ${request.path} was interrupted`));
        const settle = (complete: () => void) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          complete();
        };

        nodeRequest = NodeHttp.request(
          {
            socketPath,
            path: request.path,
            method: request.method ?? "GET",
            headers: requestHeaders(request),
            timeout: timeoutMs,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("error", (cause) => settle(() => reject(cause)));
            response.on("data", (chunk: Buffer | string) =>
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
            );
            response.on("end", () => {
              const body = Buffer.concat(chunks);
              settle(() =>
                resolve(
                  binary
                    ? { status: response.statusCode ?? 0, body }
                    : { status: response.statusCode ?? 0, body: body.toString("utf8") },
                ),
              );
            });
          },
        );
        if (timeoutMs > 0) {
          nodeRequest.on("timeout", () =>
            nodeRequest.destroy(
              new DockerEngineError({
                message: `Docker request ${request.path} timed out after ${timeoutMs}ms`,
              }),
            ),
          );
        }
        nodeRequest.on("error", (cause) => settle(() => reject(cause)));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        if (request.body !== undefined) nodeRequest.write(request.body);
        if (request.bodyBytes !== undefined) nodeRequest.write(Buffer.from(request.bodyBytes));
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
  };
}
