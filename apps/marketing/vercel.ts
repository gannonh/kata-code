import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  installCommand: "npm install -g vite-plus && vp install --filter '@kata-sh/code-marketing'",
  buildCommand: "vp run --filter @kata-sh/code-marketing build",
  outputDirectory: "dist",
};
