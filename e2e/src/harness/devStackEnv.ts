import type { E2ERunContext } from "./isolatedRun.ts";

export function buildDevStackEnv(context: E2ERunContext): NodeJS.ProcessEnv {
  return {
    ...context.devEnv,
    HOST: "127.0.0.1",
    PORT: String(context.webPort),
    KATACODE_PORT: String(context.serverPort),
    VITE_DEV_SERVER_URL: `http://127.0.0.1:${context.webPort}`,
    VITE_HTTP_URL: `http://127.0.0.1:${context.serverPort}`,
    VITE_WS_URL: `ws://127.0.0.1:${context.serverPort}`,
  };
}
