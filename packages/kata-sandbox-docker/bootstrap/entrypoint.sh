#!/bin/sh
set -eu

manifest=${KATACODE_SANDBOX_MANIFEST:?KATACODE_SANDBOX_MANIFEST is required}
test "${HOME}" = "/home/katacode"
test "${KATACODE_HOME}" = "/var/lib/katacode"
test -n "${KATACODE_SANDBOX_IMAGE_DIGEST:?KATACODE_SANDBOX_IMAGE_DIGEST is required}"
command -v node >/dev/null
command -v npm >/dev/null
command -v katacode >/dev/null
command -v codex >/dev/null
command -v git >/dev/null
command -v gh >/dev/null
command -v cc >/dev/null
command -v c++ >/dev/null
command -v make >/dev/null
command -v python3 >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(64)'
test -w "${HOME}"
test -w "${KATACODE_HOME}"
node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const manifest = JSON.parse(process.env.KATACODE_SANDBOX_MANIFEST);
const imageDigestPattern = /^(?:[a-z0-9][a-z0-9._:\/-]*@)?sha256:[0-9a-f]{64}$/;
if (
  manifest.version !== 1 ||
  !imageDigestPattern.test(manifest.imageDigest) ||
  !imageDigestPattern.test(process.env.KATACODE_SANDBOX_IMAGE_DIGEST) ||
  manifest.imageDigest !== process.env.KATACODE_SANDBOX_IMAGE_DIGEST
) process.exit(64);
for (const key of ["kataVersion", "serverVersion", "serverArtifactSha256", "codexVersion", "codexArtifactSha256"]) {
  if (typeof manifest[key] !== "string" || manifest[key].length === 0) process.exit(64);
}
const artifactDir = "/usr/local/share/kata-sandbox-artifacts";
for (const [key, file] of [["serverArtifactSha256", "kata-code-cli.tgz"], ["codexArtifactSha256", "codex.tgz"]]) {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(`${artifactDir}/${file}`)).digest("hex");
  if (digest !== manifest[key].toLowerCase()) process.exit(64);
}
const packageRoot = process.env.KATACODE_SANDBOX_INSTALL_ROOT;
if (typeof packageRoot !== "string" || packageRoot.length === 0) process.exit(64);
const packagePath = (name) => `${packageRoot}/${name}`;
const kata = JSON.parse(fs.readFileSync(`${packagePath("@kata-sh/code-cli")}/package.json`, "utf8"));
const codex = JSON.parse(fs.readFileSync(`${packagePath("@openai/codex")}/package.json`, "utf8"));
if (kata.version !== manifest.kataVersion || kata.version !== manifest.serverVersion) process.exit(64);
if (codex.version !== manifest.codexVersion) process.exit(64);
'
if [ "${KATACODE_SANDBOX_RUNTIME_CHECK:-}" = "1" ]; then
  (
    cd /usr/local/share/kata-sandbox-artifacts
    node --input-type=module -e '
      import("node-pty").then(({ spawn }) => {
        const child = spawn("/bin/sh", ["-lc", "exit 0"], { name: "xterm-256color" });
        child.onExit(({ exitCode }) => process.exit(exitCode));
      }).catch(() => process.exit(64));
    '
  )
  katacode --help >/dev/null
fi

exec "$@"
