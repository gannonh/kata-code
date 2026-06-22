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

async function canListenOnHost(port: number, host: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
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
  for (let offset = startOffset; offset < 10_000; offset += 1) {
    const { serverPort, webPort } = portPairForOffset(offset);
    if (serverPort > MAX_PORT || webPort > MAX_PORT) {
      break;
    }

    if (
      (await isPortAvailableOnAllHosts(serverPort)) &&
      (await isPortAvailableOnAllHosts(webPort))
    ) {
      return { offset, serverPort, webPort };
    }
  }

  throw new Error(
    `No available dev ports found from offset ${startOffset}. Tried server=${BASE_SERVER_PORT}+n web=${BASE_WEB_PORT}+n up to port ${MAX_PORT}. Free local ports or set KATACODE_PORT_OFFSET.`,
  );
}
