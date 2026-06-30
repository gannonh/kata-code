// @effect-diagnostics nodeBuiltinImport:off - raw Docker Engine HTTP API over
// the Unix socket via Node built-ins; no dockerode npm dependency (AC-1.7 spike
// confirmed raw-socket viability).
import * as http from "node:http";
import * as Effect from "effect/Effect";

/**
 * Raw Docker Engine HTTP API client over the Unix socket. No `dockerode`.
 * Plain async-over-`Effect.tryPromise` so the driver has no Effect service/Layer
 * plumbing and stays immune to Effect service-API drift.
 *
 * @module dockerEngine
 */
export class DockerEngineError extends Error {
  readonly _tag = "DockerEngineError";
}

const DEFAULT_SOCKET = "/var/run/docker.sock";

/** Default per-request deadline for raw Docker Engine calls (ms). If the daemon
 * accepts the connection but never finishes the response, the request is
 * aborted so callers surface a typed `DockerEngineError` instead of hanging. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Resolve the Docker socket path from `$DOCKER_HOST` (unix://…) or the default. */
export function resolveDockerSocket(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.DOCKER_HOST;
  if (typeof host === "string" && host.startsWith("unix://")) return host.slice("unix://".length);
  return DEFAULT_SOCKET;
}

export interface DockerResponse {
  readonly status: number;
  readonly body: string;
}

/** Response with a raw binary body (used for the multiplexed exec stream). */
export interface DockerBufferResponse {
  readonly status: number;
  readonly body: Buffer;
}

/** Issue a Docker Engine API request over the Unix socket. */
export function dockerRequest(
  path: string,
  init: {
    method?: string;
    /** JSON string body (sets `Content-Type: application/json`). */
    body?: string;
    /** Binary body (e.g. a tar archive). When set, `contentType` defaults to `application/x-tar`. */
    bodyBytes?: Uint8Array;
    /** `Content-Type` for a `bodyBytes` request (ignored for JSON `body`). */
    contentType?: string;
    socketPath?: string;
    timeoutMs?: number;
  } = {},
): Effect.Effect<DockerResponse, DockerEngineError> {
  const socketPath = init.socketPath ?? resolveDockerSocket();
  const timeoutMs = init.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return Effect.tryPromise({
    try: () =>
      new Promise<DockerResponse>((resolve, reject) => {
        const req = http.request(
          {
            socketPath,
            path,
            method: init.method ?? "GET",
            headers: init.body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(init.body),
                }
              : init.bodyBytes
                ? {
                    "Content-Type": init.contentType ?? "application/x-tar",
                    "Content-Length": Buffer.byteLength(init.bodyBytes),
                  }
                : {},
            timeout: timeoutMs,
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c: string) => (body += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        // `timeout` fires when the socket is inactive for `timeoutMs`; abort the
        // request and surface a typed error rather than waiting forever.
        req.on("timeout", () => {
          req.destroy(
            new DockerEngineError(`Docker request to ${path} timed out after ${timeoutMs}ms`),
          );
        });
        req.on("error", (err) =>
          reject(err instanceof DockerEngineError ? err : new DockerEngineError(err.message)),
        );
        if (init.body) req.write(init.body);
        else if (init.bodyBytes) req.write(Buffer.from(init.bodyBytes));
        req.end();
      }),
    catch: (err) => (err instanceof DockerEngineError ? err : new DockerEngineError(String(err))),
  });
}

/**
 * Issue a Docker Engine API request and return the response body as a raw
 * `Buffer`. Used for the multiplexed exec stream, where the bytes are framed
 * (8-byte headers per Docker's hijacked stream protocol) and must not be
 * utf8-decoded before demultiplexing.
 */
export function dockerRequestBuffer(
  path: string,
  init: {
    method?: string;
    body?: string;
    bodyBytes?: Uint8Array;
    contentType?: string;
    socketPath?: string;
    timeoutMs?: number;
  } = {},
): Effect.Effect<DockerBufferResponse, DockerEngineError> {
  const socketPath = init.socketPath ?? resolveDockerSocket();
  const timeoutMs = init.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return Effect.tryPromise({
    try: () =>
      new Promise<DockerBufferResponse>((resolve, reject) => {
        const req = http.request(
          {
            socketPath,
            path,
            method: init.method ?? "GET",
            headers: init.body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(init.body),
                }
              : init.bodyBytes
                ? {
                    "Content-Type": init.contentType ?? "application/x-tar",
                    "Content-Length": Buffer.byteLength(init.bodyBytes),
                  }
                : {},
            timeout: timeoutMs,
          },
          (res) => {
            // Do NOT set utf8 encoding: the multiplexed stream is binary frames.
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
            );
          },
        );
        req.on("timeout", () => {
          req.destroy(
            new DockerEngineError(`Docker request to ${path} timed out after ${timeoutMs}ms`),
          );
        });
        req.on("error", (err) =>
          reject(err instanceof DockerEngineError ? err : new DockerEngineError(err.message)),
        );
        if (init.body) req.write(init.body);
        else if (init.bodyBytes) req.write(Buffer.from(init.bodyBytes));
        req.end();
      }),
    catch: (err) => (err instanceof DockerEngineError ? err : new DockerEngineError(String(err))),
  });
}
