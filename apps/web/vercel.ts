import { matchers, routes, type Transform, type VercelConfig } from "@vercel/config/v1";

// Vercel compiles this file before the monorepo build; keep in sync with
// packages/shared/src/branding.ts (workspace TS imports fail at config compile time).
const HOSTED_WEB_ROUTER_HOST = "app.kata.sh" as const;
const HOSTED_WEB_LATEST_ORIGIN = "https://latest.app.kata.sh" as const;
const HOSTED_WEB_NIGHTLY_ORIGIN = "https://nightly.app.kata.sh" as const;
const HOSTED_WEB_CHANNEL_PATH = "/__katacode/channel" as const;
const HOSTED_WEB_CHANNEL_COOKIE = "katacode_web_channel" as const;

const CLEAN_CHANNEL_QUERY_TRANSFORMS = [
  {
    type: "request.query",
    op: "delete",
    target: { key: "channel" },
  },
] satisfies Transform[];

function channelCookie(channel: "latest" | "nightly"): string {
  return [
    `${HOSTED_WEB_CHANNEL_COOKIE}=${channel}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export const config: VercelConfig = {
  buildCommand:
    'vp run --filter @kata-sh/code-web build && node ../../scripts/apply-web-brand-assets.ts --channel "${VITE_HOSTED_APP_CHANNEL:-latest}"',
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --filter '@kata-sh/code-scripts...' --filter '@kata-sh/code-web...'",
  routes: [
    {
      src: HOSTED_WEB_CHANNEL_PATH,
      has: [matchers.query("channel", "nightly")],
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("nightly"),
      },
      status: 302,
    },
    {
      src: HOSTED_WEB_CHANNEL_PATH,
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("latest"),
      },
      status: 302,
    },
    {
      src: "/(.*)",
      has: [
        matchers.host(HOSTED_WEB_ROUTER_HOST),
        matchers.cookie(HOSTED_WEB_CHANNEL_COOKIE, "nightly"),
      ],
      dest: `${HOSTED_WEB_NIGHTLY_ORIGIN}/$1`,
    },
    {
      src: "/(.*)",
      has: [matchers.host(HOSTED_WEB_ROUTER_HOST)],
      dest: `${HOSTED_WEB_LATEST_ORIGIN}/$1`,
    },
  ],
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
