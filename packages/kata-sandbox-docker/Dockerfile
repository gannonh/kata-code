# The build caller must provide an immutable OCI reference.
ARG KATACODE_BASE_IMAGE
FROM ${KATACODE_BASE_IMAGE}

ARG KATACODE_CLI_VERSION
ARG KATACODE_CLI_SHA256
ARG DEBIAN_SNAPSHOT=20260824T000000Z
ARG KATACODE_CLI_PACKAGE=@kata-sh/code-cli
ARG CODEX_VERSION
ARG CODEX_SHA256
ARG CODEX_PACKAGE=@openai/codex

# node:24-bookworm-slim intentionally omits source-control and native build
# tooling. Use the snapshot recorded by the pinned base image so package
# selection is reproducible, then remove the package index at runtime.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
  && printf '%s\n' \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT} bookworm main" \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT} bookworm-security main" \
    > /etc/apt/sources.list \
  && apt-get update \
  && apt-get install --no-install-recommends --yes \
    ca-certificates \
    git \
    gh \
    build-essential \
    python3 \
  && rm -rf /var/lib/apt/lists/* \
  && command -v node \
  && command -v npm \
  && node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)' \
  && command -v git \
  && command -v gh \
  && command -v cc \
  && command -v c++ \
  && command -v make \
  && command -v python3

RUN mkdir -p /usr/local/share/kata-sandbox-artifacts
COPY artifacts/package.json /usr/local/share/kata-sandbox-artifacts/package.json
COPY artifacts/package-lock.json /usr/local/share/kata-sandbox-artifacts/package-lock.json
COPY artifacts/kata-code-cli.tgz /usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz
COPY artifacts/codex.tgz /usr/local/share/kata-sandbox-artifacts/codex.tgz

RUN printf '%s  %s\n' "${KATACODE_CLI_SHA256}" /usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz | sha256sum -c - \
  && printf '%s  %s\n' "${CODEX_SHA256}" /usr/local/share/kata-sandbox-artifacts/codex.tgz | sha256sum -c -

ENV PATH=/usr/local/share/kata-sandbox-artifacts/node_modules/.bin:$PATH
ENV KATACODE_SANDBOX_INSTALL_ROOT=/usr/local/share/kata-sandbox-artifacts/node_modules

RUN node --input-type=module -e ' \
  import { execFileSync } from "node:child_process"; \
  const readPackage = (archive) => JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" })); \
  const kata = readPackage("/usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz"); \
  const codex = readPackage("/usr/local/share/kata-sandbox-artifacts/codex.tgz"); \
  if (kata.name !== process.env.KATACODE_CLI_PACKAGE || kata.version !== process.env.KATACODE_CLI_VERSION) process.exit(64); \
  if (codex.name !== process.env.CODEX_PACKAGE || codex.version !== process.env.CODEX_VERSION) process.exit(64); \
  ' \
  # Both packages are local, digest-checked artifacts. No tag or dist-tag is \
  # resolved by the image build. \
  && cd /usr/local/share/kata-sandbox-artifacts \
  && npm ci --omit=dev --no-audit --no-fund \
  && command -v katacode \
  && command -v codex

RUN useradd --create-home --home-dir /home/katacode --shell /bin/sh katacode \
  && mkdir -p /home/katacode/.codex /var/lib/katacode /workspace \
  && chown -R katacode:katacode /home/katacode /var/lib/katacode /workspace

ENV HOME=/home/katacode
ENV KATACODE_HOME=/var/lib/katacode
ENV SHELL=/bin/sh

COPY bootstrap/entrypoint.sh /usr/local/bin/kata-sandbox-entrypoint
RUN chmod 0555 /usr/local/bin/kata-sandbox-entrypoint

USER katacode
ENTRYPOINT ["/usr/local/bin/kata-sandbox-entrypoint"]
CMD ["katacode", "serve", "--host", "0.0.0.0", "--port", "3773"]
