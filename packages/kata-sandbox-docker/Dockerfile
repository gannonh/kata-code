# The build caller must provide an immutable OCI reference.
ARG KATACODE_BASE_IMAGE
FROM ${KATACODE_BASE_IMAGE}

ARG KATACODE_CLI_VERSION
ARG KATACODE_CLI_SHA256
ARG KATACODE_CLI_PACKAGE=@kata-sh/code-cli
ARG CODEX_VERSION
ARG CODEX_SHA256
ARG CODEX_PACKAGE=@openai/codex

RUN test -n "${KATACODE_CLI_VERSION}" \
  && test -n "${KATACODE_CLI_SHA256}" \
  && test -n "${CODEX_VERSION}" \
  && test -n "${CODEX_SHA256}" \
  && printf '%s' "${KATACODE_CLI_SHA256}" | grep -Eq '^[0-9a-fA-F]{64}$' \
  && printf '%s' "${CODEX_SHA256}" | grep -Eq '^[0-9a-fA-F]{64}$' \
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
COPY artifacts/kata-code-cli.tgz /usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz
COPY artifacts/codex.tgz /usr/local/share/kata-sandbox-artifacts/codex.tgz

RUN printf '%s  %s\n' "${KATACODE_CLI_SHA256}" /usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz | sha256sum -c - \
  && printf '%s  %s\n' "${CODEX_SHA256}" /usr/local/share/kata-sandbox-artifacts/codex.tgz | sha256sum -c -

RUN node --input-type=module -e ' \
  import { execFileSync } from "node:child_process"; \
  const readPackage = (archive) => JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" })); \
  const kata = readPackage("/usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz"); \
  const codex = readPackage("/usr/local/share/kata-sandbox-artifacts/codex.tgz"); \
  if (kata.name !== process.env.KATACODE_CLI_PACKAGE || kata.version !== process.env.KATACODE_CLI_VERSION) process.exit(64); \
  if (codex.name !== process.env.CODEX_PACKAGE || codex.version !== process.env.CODEX_VERSION) process.exit(64); \
  ' \
  && npm install --global --omit=dev \
    /usr/local/share/kata-sandbox-artifacts/kata-code-cli.tgz \
    /usr/local/share/kata-sandbox-artifacts/codex.tgz \
  && command -v katacode \
  && command -v codex

RUN useradd --create-home --home-dir /home/katacode --shell /bin/sh katacode \
  && mkdir -p /home/katacode/.codex /var/lib/katacode /workspace \
  && chown -R katacode:katacode /home/katacode /var/lib/katacode /workspace

ENV HOME=/home/katacode
ENV KATACODE_HOME=/var/lib/katacode

COPY bootstrap/entrypoint.sh /usr/local/bin/kata-sandbox-entrypoint
RUN chmod 0555 /usr/local/bin/kata-sandbox-entrypoint

USER katacode
ENTRYPOINT ["/usr/local/bin/kata-sandbox-entrypoint"]
CMD ["katacode", "serve", "--host", "0.0.0.0", "--port", "3773"]
