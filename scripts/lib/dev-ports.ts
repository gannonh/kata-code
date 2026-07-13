import { createServer } from "node:net";

import * as Hash from "effect/Hash";

export const BASE_SERVER_PORT = 13773;
export const BASE_WEB_PORT = 5733;
export const MAX_HASH_OFFSET = 3000;
export const MAX_PORT = 65_535;
export const DEV_PORT_PROBE_HOSTS = ["127.0.0.1", "0.0.0.0", "::1", "::"] as const;

export function portPairForOffset(offset: number): {
  readonly serverPort: number;
  readonly webPort: number;
} {
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + offset,
  };
}

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
}): { readonly offset: number; readonly source: string } {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      throw new Error(`Invalid KATACODE_PORT_OFFSET: ${config.portOffset}`);
    }
    return {
      offset: config.portOffset,
      source: `KATACODE_PORT_OFFSET=${config.portOffset}`,
    };
  }

  const seed = config.devInstance?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return { offset: Number(seed), source: `numeric KATACODE_DEV_INSTANCE=${seed}` };
  }

  const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
  return { offset, source: `hashed KATACODE_DEV_INSTANCE=${seed}` };
}

function parsePortOffset(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function resolveStartOffsetFromEnv(env: NodeJS.ProcessEnv = process.env): {
  readonly offset: number;
  readonly source: string;
} {
  return resolveOffset({
    portOffset: parsePortOffset(env.KATACODE_PORT_OFFSET),
    devInstance: env.KATACODE_DEV_INSTANCE?.trim() || undefined,
  });
}

function createPortClaimServer(): ReturnType<typeof createServer> {
  // Port probes reserve sockets only. Immediately close accidental health-check
  // connections so Server.close() cannot wait indefinitely for a client.
  return createServer((socket) => socket.destroy());
}

async function canListenOnHost(port: number, host: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createPortClaimServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function isPortAvailableOnAllHosts(port: number): Promise<boolean> {
  for (const host of DEV_PORT_PROBE_HOSTS) {
    if (!(await canListenOnHost(port, host))) {
      return false;
    }
  }

  return true;
}

export async function findAvailablePortOffset(startOffset: number): Promise<{
  readonly offset: number;
  readonly serverPort: number;
  readonly webPort: number;
}> {
  for await (const candidate of candidatePortPairs(startOffset)) {
    if (
      (await isPortAvailableOnAllHosts(candidate.serverPort)) &&
      (await isPortAvailableOnAllHosts(candidate.webPort))
    ) {
      return candidate;
    }
  }

  throw noAvailableDevPortsError(startOffset);
}

/**
 * Claim a server/web port pair by opening listening sockets on every probe host
 * and holding them open. The returned `release` closes the placeholders so the
 * caller can immediately bind the ports (e.g. spawn Vite). Holding the sockets
 * closes the TOCTOU window where two concurrent workers both observe the same
 * free port and then race to bind it.
 */
export async function claimAvailablePortOffset(startOffset: number): Promise<{
  readonly offset: number;
  readonly serverPort: number;
  readonly webPort: number;
  readonly release: () => Promise<void>;
}> {
  for await (const candidate of candidatePortPairs(startOffset)) {
    // Probe all hosts for availability (sequential, non-overlapping binds
    // that close before the next host is checked).
    if (
      !(await isPortAvailableOnAllHosts(candidate.serverPort)) ||
      !(await isPortAvailableOnAllHosts(candidate.webPort))
    ) {
      continue;
    }
    // Reserve with a non-overlapping single-host claim so the placeholder
    // sockets don't conflict with each other on the same port.
    const release = await tryClaimPortPair(candidate.serverPort, candidate.webPort);
    if (release) {
      return { ...candidate, release };
    }
  }

  throw noAvailableDevPortsError(startOffset);
}

/** Iterate candidate server/web port pairs from `startOffset`, stopping once a
 *  pair exceeds {@link MAX_PORT}. Shared by {@link findAvailablePortOffset}
 *  (probe-and-release) and {@link claimAvailablePortOffset} (hold-the-socket) so
 *  the scan range and bounds check stay identical. */
async function* candidatePortPairs(startOffset: number): AsyncGenerator<{
  readonly offset: number;
  readonly serverPort: number;
  readonly webPort: number;
}> {
  for (let offset = startOffset; offset < 10_000; offset += 1) {
    const { serverPort, webPort } = portPairForOffset(offset);
    if (serverPort > MAX_PORT || webPort > MAX_PORT) {
      break;
    }
    yield { offset, serverPort, webPort };
  }
}

function noAvailableDevPortsError(startOffset: number): Error {
  return new Error(
    `No available dev ports found from offset ${startOffset}. Tried server=${BASE_SERVER_PORT}+n web=${BASE_WEB_PORT}+n up to port ${MAX_PORT}. Free local ports or set KATACODE_PORT_OFFSET.`,
  );
}

async function tryClaimPortPair(
  serverPort: number,
  webPort: number,
): Promise<(() => Promise<void>) | null> {
  const servers: ReturnType<typeof createServer>[] = [];
  const tryBind = (port: number, host: string) =>
    new Promise<boolean>((resolve) => {
      const server = createPortClaimServer();
      server.once("error", () => {
        server.close(() => resolve(false));
      });
      server.listen(port, host, () => resolve(true));
      servers.push(server);
    });

  // Reserve with a single non-overlapping bind per port. Binding both
  // `127.0.0.1` and `0.0.0.0` (or `::1` and `::`) for the same port
  // simultaneously fails on typical Linux/macOS stacks because the wildcard
  // address overlaps the loopback address. The wildcard `0.0.0.0` covers all
  // IPv4 addresses (including `127.0.0.1`), so holding it is sufficient to
  // block other workers from claiming the same port. The all-host availability
  // probe (`isPortAvailableOnAllHosts`) still checks every host sequentially
  // before the claim is attempted via `findAvailablePortOffset`.
  const claimHost = "0.0.0.0";
  const results = await Promise.all([tryBind(serverPort, claimHost), tryBind(webPort, claimHost)]);

  if (results.every(Boolean)) {
    return async () => {
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
    };
  }

  // Some hosts failed to bind: release whatever we held and signal failure.
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  return null;
}
