#!/bin/sh
set -eu

manifest=${KATACODE_SANDBOX_MANIFEST:?KATACODE_SANDBOX_MANIFEST is required}
test "${HOME}" = "/home/katacode"
test "${KATACODE_HOME}" = "/var/lib/katacode"
test -n "${KATACODE_SANDBOX_IMAGE_DIGEST:?KATACODE_SANDBOX_IMAGE_DIGEST is required}"
command -v node >/dev/null
command -v git >/dev/null
command -v gh >/dev/null
command -v cc >/dev/null
command -v c++ >/dev/null
command -v make >/dev/null
command -v python3 >/dev/null
node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const manifest = JSON.parse(process.env.KATACODE_SANDBOX_MANIFEST);
if (manifest.version !== 1 || manifest.imageDigest !== process.env.KATACODE_SANDBOX_IMAGE_DIGEST) process.exit(64);
for (const key of ["kataVersion", "serverVersion", "serverArtifactSha256", "codexVersion", "codexArtifactSha256"]) {
  if (typeof manifest[key] !== "string" || manifest[key].length === 0) process.exit(64);
}
const artifactDir = "/usr/local/share/kata-sandbox-artifacts";
for (const [key, file] of [["serverArtifactSha256", "kata-code-cli.tgz"], ["codexArtifactSha256", "codex.tgz"]]) {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(`${artifactDir}/${file}`)).digest("hex");
  if (digest !== manifest[key].toLowerCase()) process.exit(64);
}
const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const packagePath = (name) => `${globalRoot}/${name}`;
const kata = JSON.parse(fs.readFileSync(`${packagePath("@kata-sh/code-cli")}/package.json`, "utf8"));
const codex = JSON.parse(fs.readFileSync(`${packagePath("@openai/codex")}/package.json`, "utf8"));
if (kata.version !== manifest.kataVersion || kata.version !== manifest.serverVersion) process.exit(64);
if (codex.version !== manifest.codexVersion) process.exit(64);
'

exec "$@"
