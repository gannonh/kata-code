import type { E2ERunContext } from "./isolatedRun.ts";
import { buildDevStackEnv } from "./devStackEnv.ts";

const DEV_ONLY_ENV_KEYS = ["VITE_DEV_SERVER_URL", "PORT", "VITE_HTTP_URL", "VITE_WS_URL"] as const;

export function resolveRendererTarget(context: E2ERunContext): {
  readonly port: number;
  readonly label: string;
} {
  if (context.launchTarget === "release") {
    return { port: context.serverPort, label: "embedded server" };
  }

  return { port: context.webPort, label: "Vite" };
}

export function buildElectronLaunchEnv(context: E2ERunContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...context.devEnv,
    KATACODE_PORT: String(context.serverPort),
    ELECTRON_ENABLE_LOGGING: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  if (context.launchTarget === "release") {
    for (const key of DEV_ONLY_ENV_KEYS) {
      delete env[key];
    }
    return env;
  }

  return buildDevStackEnv(context);
}

export function isRendererWindow(url: string, rendererPort: number): boolean {
  if (!url || url === "about:blank" || url.startsWith("devtools://")) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port =
      parsed.port.length > 0
        ? Number.parseInt(parsed.port, 10)
        : parsed.protocol === "https:"
          ? 443
          : 80;
    return (host === "127.0.0.1" || host === "localhost") && port === rendererPort;
  } catch {
    return false;
  }
}
