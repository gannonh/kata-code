# syntax=docker/dockerfile:1
#
# Kata Code server container image.
#
# Packages the production @kata-sh/code-cli bundle (apps/server/dist/bin.mjs +
# externalized runtime deps, including the node-pty native addon compiled for
# linux/musl) over node:24-alpine. ENTRYPOINT is `node /app/dist/bin.mjs`, so
# the default provision command is `katacode serve --port 13773` (bin.mjs is the
# `katacode` CLI). See
# docs/specs/2026-06-27-kata-environments-deployments-phase-1-design.md (Phase 1
# scope amendment: the katacode container image is prerequisite infrastructure
# for AC-1.10).
#
# Build: `pnpm run build:docker-image` (tags `katacode:local`). Phase 2+ will
# publish versioned tags to GHCR.

ARG NODE_IMAGE=node:24-alpine

# ---------------------------------------------------------------------------
# Builder: install full workspace, build the server bundle + web client, then
# prune to prod deps so the runtime stage copies a lean node_modules.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder

# node-gyp / node-pty native build needs python3 + make + g++ on alpine.
RUN apk add --no-cache python3 make g++ git

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /repo

# Copy every workspace manifest first so the install layer caches across source
# changes. pnpm install --frozen-lockfile requires every workspace package.json
# referenced by the lockfile to be present.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches/ patches/
COPY apps/desktop/package.json apps/desktop/
COPY apps/marketing/package.json apps/marketing/
COPY apps/mobile/package.json apps/mobile/
COPY apps/mobile/modules/t3-review-diff/package.json apps/mobile/modules/t3-review-diff/
COPY apps/mobile/modules/t3-terminal/package.json apps/mobile/modules/t3-terminal/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY infra/relay/package.json infra/relay/
COPY mobile-e2e/package.json mobile-e2e/
COPY oxlint-plugin-kata-code/package.json oxlint-plugin-kata-code/
COPY packages/client-runtime/package.json packages/client-runtime/
COPY packages/contracts/package.json packages/contracts/
COPY packages/effect-acp/package.json packages/effect-acp/
COPY packages/effect-codex-app-server/package.json packages/effect-codex-app-server/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/sandbox-contracts/package.json packages/sandbox-contracts/
COPY packages/sandbox-docker/package.json packages/sandbox-docker/
COPY packages/shared/package.json packages/shared/
COPY packages/ssh/package.json packages/ssh/
COPY packages/tailscale/package.json packages/tailscale/
COPY scripts/package.json scripts/

RUN pnpm install --frozen-lockfile

# Copy the rest of the source and build the server bundle + bundled web client.
# build:desktop builds @kata-sh/code-cli (which bundles @kata-sh/code-web).
COPY . .

RUN pnpm run build:desktop

# Prune to prod dependencies for @kata-sh/code-cli and its workspace deps.
# CI=true lets pnpm remove the dev modules directory non-interactively.
# --ignore-scripts skips the root `prepare` hook (husky/effect-tsgo, dev-only)
# and avoid re-running native builds; node-pty was compiled in the full install.
RUN CI=true pnpm install --frozen-lockfile --prod --ignore-scripts --filter @kata-sh/code-cli...

# ---------------------------------------------------------------------------
# Runtime: lean node:24-alpine with the server bundle + prod node_modules.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ARG TARGETARCH

# node-pty's native addon is compiled in the builder; the runtime only needs
# the loader libs the addon links against. The sandbox image also needs
# cloudflared on PATH so Connect relay config can start the managed tunnel
# inside the deployed container. `git` is required for in-container worktree
# and source-control operations (Phase 3a AC-3a.1).
RUN set -eux; \
    apk add --no-cache libstdc++ ca-certificates curl git bash; \
    case "${TARGETARCH}" in \
      amd64) \
        cloudflared_url="https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-linux-amd64"; \
        cloudflared_sha="5286698547f03df745adb2355f04c12dde52ef425491e81f433642d695521886"; \
        ;; \
      arm64) \
        cloudflared_url="https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-linux-arm64"; \
        cloudflared_sha="5a4e8ce2701105271412059f44b6a0bf1ae4542b4d98ff3180c0c019443a5815"; \
        ;; \
      *) echo "Unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "$cloudflared_url" -o /usr/local/bin/cloudflared; \
    echo "$cloudflared_sha  /usr/local/bin/cloudflared" | sha256sum -c -; \
    chmod +x /usr/local/bin/cloudflared

WORKDIR /app

# The bundle was built at apps/server/dist and externalizes effect + @effect/*
# + node-pty + provider SDKs, which Node resolves from the nearest
# node_modules upward. pnpm installs those under apps/server/node_modules, so
# preserve the apps/server layout: dist + node_modules + package.json there,
# and the repo-root node_modules + workspace packages the symlinks point at.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /repo/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /repo/apps/server/package.json ./apps/server/package.json
COPY --from=builder /repo/apps/server/dist ./apps/server/dist
COPY --from=builder /repo/packages ./packages

# Containerized Kata server defaults: desktop mode, no browser, loopback port.
ENV KATACODE_MODE=desktop \
    KATACODE_NO_BROWSER=true \
    KATACODE_HOST=0.0.0.0 \
    KATACODE_PORT=13773

# Expose the server CLI as `katacode` on PATH so provision commands like
# `katacode serve --port 13773` (run via `sh -c` by the sandbox driver) resolve.
RUN printf '#!/bin/sh\nexec node /app/apps/server/dist/bin.mjs "$@"\n' > /usr/local/bin/katacode \
    && chmod +x /usr/local/bin/katacode

# Phase 3a: bake provider CLIs into the image so a sandbox session can run
# `codex`, `agent` (Cursor), `grok`, `claude` (Claude Code), `opencode`, and
# `pi` (Pi Coding Agent) directly. The same image is the provision unit for
# Phase 3b (Railway cloud driver), so this work is not throwaway. The npm
# packages ship platform-native prebuilds for linux amd64/arm64, so a plain
# global install is enough (no native build). Install as root so the binaries
# land on the system PATH; the unprivileged `katacode` user created below
# inherits them. Cursor Agent (`agent`) is distributed via the cursor.com
# installer, not npm: it downloads the platform binary and symlinks `agent` +
# `cursor-agent` into ~/.local/bin, so it is installed as the katacode user
# below.
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai @xai-official/grok @earendil-works/pi-coding-agent

# Run the server and cloudflared as an unprivileged user instead of root.
# A writable HOME is required for the Node server's config/cache dirs and for
# the Cursor Agent installer to write ~/.local/bin/agent.
RUN addgroup -S -g 101 katacode \
    && adduser -S -D -G katacode -h /home/katacode -u 100 katacode \
    && mkdir -p /home/katacode /workspace \
    && chown -R katacode:katacode /home/katacode /workspace
ENV HOME=/home/katacode
USER katacode
RUN curl -fsSL https://cursor.com/install | bash
USER root

# alpine ships no `bash`; the terminal manager resolves `env.SHELL ?? "bash"`
# (apps/server/src/terminal/Layers/Manager.ts). Set SHELL=/bin/sh so the
# in-container terminal spawns busybox ash directly instead of falling through
# to a missing `bash` (Phase 3a AC-3a.2/3a.3). The fallback chain remains as a
# safety net. Prepend /home/katacode/.local/bin to PATH so the Cursor Agent
# `agent` symlink resolves in-container.
ENV SHELL=/bin/sh \
    PATH=/home/katacode/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

EXPOSE 13773

USER katacode

ENTRYPOINT ["node", "/app/apps/server/dist/bin.mjs"]
