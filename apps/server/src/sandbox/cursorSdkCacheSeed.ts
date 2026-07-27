/**
 * Keep seeded `pi-cursor-sdk` model-list caches usable inside the sandbox VM.
 *
 * The host cache's `fetchedAt` is wall-clock from the host. `pi-cursor-sdk`
 * rejects entries more than 5 minutes ahead of local `Date.now()`. When the
 * sandbox clock is behind the host, a freshly seeded cache is treated as
 * invalid, discovery falls through to a live `Cursor.models.list` / `@cursor/sdk`
 * load, and the Pi provider probe often times out — leaving no `cursor/*`
 * models even though the extension installed.
 *
 * Rewrite `fetchedAt` to the sandbox's clock after extract so the warm path
 * stays valid.
 *
 * @module cursorSdkCacheSeed
 */

/** Escape a value for single-quote wrapping in a shell command. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build a best-effort `node` command that stamps `fetchedAt` on the seeded
 * model-list cache using the sandbox VM clock.
 */
export function buildRefreshCursorModelListCacheCommand(home: string): string {
  const cachePath = `${home.replace(/\/+$/, "")}/.pi/agent/cursor-sdk-model-list.json`;
  const script = [
    `const fs=require("fs");`,
    `const p=${JSON.stringify(cachePath)};`,
    `try{`,
    `const j=JSON.parse(fs.readFileSync(p,"utf8"));`,
    `if(j&&typeof j==="object"&&typeof j.keyFingerprint==="string"&&Array.isArray(j.models)){`,
    `j.fetchedAt=Date.now();`,
    `fs.writeFileSync(p,JSON.stringify(j,null,2)+"\\n",{mode:0o600});`,
    `}`,
    `}catch{}`,
  ].join("");
  return `node -e ${shellSingleQuote(script)}`;
}
