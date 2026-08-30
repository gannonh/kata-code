#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalProcess:off globalDate:off - This local UAT responder owns HTTP sockets, process signals, and timestamped evidence.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { PNG } from "pngjs";

export type RaceCase = "late-success" | "late-error";
export type RaceSource = "a" | "b";
export type RaceOutcome = "success" | "error";

interface ImageRequest {
  readonly raceCase: RaceCase;
  readonly source: RaceSource;
  readonly response: NodeHttp.ServerResponse;
  released: boolean;
  closed: boolean;
}

interface ParsedFixturePath {
  readonly kind: "image" | "wait" | "release";
  readonly runId: string;
  readonly raceCase: RaceCase;
  readonly source: RaceSource;
  readonly outcome?: RaceOutcome;
}

const raceCases = new Set<RaceCase>(["late-success", "late-error"]);
const raceSources = new Set<RaceSource>(["a", "b"]);
const raceOutcomes = new Set<RaceOutcome>(["success", "error"]);

function requiredOutcome(raceCase: RaceCase, source: RaceSource): RaceOutcome {
  if (source === "b" || raceCase === "late-success") return "success";
  return "error";
}

export function parseFixturePath(pathname: string): ParsedFixturePath | null {
  const parts = pathname.split("/");
  if (parts[0] !== "" || parts[1] !== "runs" || !parts[2]) return null;
  const runId = parts[2];
  const raceCase = parts[3];
  if (!raceCases.has(raceCase as RaceCase)) return null;

  if (parts[4] === "wait" && raceSources.has(parts[5] as RaceSource) && parts.length === 6) {
    return {
      kind: "wait",
      runId,
      raceCase: raceCase as RaceCase,
      source: parts[5] as RaceSource,
    };
  }
  if (
    parts[4] === "release" &&
    raceSources.has(parts[5] as RaceSource) &&
    raceOutcomes.has(parts[6] as RaceOutcome) &&
    parts[6] === requiredOutcome(raceCase as RaceCase, parts[5] as RaceSource) &&
    parts.length === 7
  ) {
    return {
      kind: "release",
      runId,
      raceCase: raceCase as RaceCase,
      source: parts[5] as RaceSource,
      outcome: parts[6] as RaceOutcome,
    };
  }
  const imageMatch = /^([ab])\.png$/u.exec(parts[4] ?? "");
  if (imageMatch && parts.length === 5) {
    return {
      kind: "image",
      runId,
      raceCase: raceCase as RaceCase,
      source: imageMatch[1] as RaceSource,
    };
  }
  return null;
}

function imageBytes(source: RaceSource): Buffer {
  const width = source === "a" ? 80 : 320;
  const height = source === "a" ? 320 : 80;
  const png = new PNG({ width, height });
  const color = source === "a" ? ([220, 70, 70] as const) : ([45, 125, 235] as const);
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color[0];
    png.data[index + 1] = color[1];
    png.data[index + 2] = color[2];
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

function keyOf(input: Pick<ParsedFixturePath, "runId" | "raceCase" | "source">): string {
  return `${input.runId}/${input.raceCase}/${input.source}`;
}

function main(): void {
  const logArgument = NodeProcess.argv.indexOf("--log");
  const logPathArgument = NodeProcess.argv[logArgument + 1];
  const logPath =
    logArgument >= 0 && logPathArgument
      ? NodePath.resolve(logPathArgument)
      : NodePath.resolve("uat-evidence/mobile-markdown-image-race.jsonl");
  NodeFS.mkdirSync(NodePath.dirname(logPath), { recursive: true });

  let sequence = 0;
  const requests = new Map<string, ImageRequest>();
  const waiters = new Map<string, Set<NodeHttp.ServerResponse>>();
  const log = (event: Record<string, unknown>) => {
    NodeFS.appendFileSync(
      logPath,
      `${JSON.stringify({ seq: ++sequence, at: new Date().toISOString(), ...event })}\n`,
    );
  };
  const notifyRequested = (key: string) => {
    for (const waiter of waiters.get(key) ?? []) {
      waiter.writeHead(204).end();
    }
    waiters.delete(key);
  };

  const server = NodeHttp.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parsed = parseFixturePath(url.pathname);
    if (!parsed) {
      response.writeHead(404).end("Not found");
      return;
    }
    const key = keyOf(parsed);

    if (parsed.kind === "wait") {
      if (requests.has(key)) {
        response.writeHead(204).end();
        return;
      }
      const pending = waiters.get(key) ?? new Set<NodeHttp.ServerResponse>();
      pending.add(response);
      waiters.set(key, pending);
      const removeWaiter = () => pending.delete(response);
      request.once("aborted", removeWaiter);
      response.once("close", removeWaiter);
      return;
    }

    if (parsed.kind === "image") {
      const priorRequest = requests.get(key);
      if (priorRequest && !priorRequest.closed) {
        response.writeHead(409).end("Duplicate request");
        return;
      }
      const imageRequest: ImageRequest = {
        raceCase: parsed.raceCase,
        source: parsed.source,
        response,
        released: false,
        closed: false,
      };
      requests.set(key, imageRequest);
      log({ event: "requested", key });
      notifyRequested(key);
      const markClientAborted = () => {
        if (imageRequest.closed || imageRequest.response.writableEnded) return;
        imageRequest.closed = true;
        log({ event: "client-aborted", key });
      };
      request.once("aborted", markClientAborted);
      response.once("close", () => {
        if (imageRequest.released || response.writableEnded) return;
        markClientAborted();
      });
      return;
    }

    const imageRequest = requests.get(key);
    if (!imageRequest) {
      response.writeHead(409).end("Release before request");
      return;
    }
    if (imageRequest.released) {
      response.writeHead(409).end("Duplicate release");
      return;
    }
    if (parsed.outcome !== requiredOutcome(parsed.raceCase, parsed.source)) {
      response.writeHead(409).end("Unexpected outcome");
      return;
    }

    imageRequest.released = true;
    log({ event: "released", key, outcome: parsed.outcome });
    if (imageRequest.closed || imageRequest.response.destroyed) {
      log({ event: "finished", key, outcome: "client-aborted" });
      response.writeHead(204).end();
      return;
    }

    const finish = (outcome: string) => {
      if (imageRequest.closed) return;
      imageRequest.closed = true;
      log({ event: "finished", key, outcome });
      response.writeHead(204).end();
    };
    imageRequest.response.once("finish", () => finish(parsed.outcome ?? "error"));
    imageRequest.response.once("close", () => finish("client-aborted"));
    if (parsed.outcome === "success") {
      const bytes = imageBytes(parsed.source);
      imageRequest.response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type": "image/png",
      });
      imageRequest.response.end(bytes);
    } else {
      imageRequest.response.writeHead(500, { "Cache-Control": "no-store" }).end("Fixture error");
    }
  });

  const close = () => {
    for (const imageRequest of requests.values()) imageRequest.response.destroy();
    for (const responses of waiters.values()) {
      for (const response of responses) response.destroy();
    }
    server.close(() => NodeProcess.exit(0));
  };
  NodeProcess.on("SIGINT", close);
  NodeProcess.on("SIGTERM", close);

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Responder did not bind TCP.");
    NodeProcess.stdout.write(
      `${JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, logPath })}\n`,
    );
  });
}

if (NodeProcess.argv[1] && import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1]).href)
  main();
