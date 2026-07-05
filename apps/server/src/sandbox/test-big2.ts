import { buildCredentialSeedArchives } from "./credentialSeed.ts";
import * as Effect from "effect/Effect";
import * as os from "node:os";

const result = await Effect.runPromise(buildCredentialSeedArchives({ hostHome: os.homedir() }));
if (!result.static) {
  console.log("null");
  process.exit(0);
}
const a = result.static;
let off = 0;
const byDir: Record<string, number> = {};
let count = 0;
while (off + 512 <= a.length) {
  const name = Buffer.from(a.subarray(off, off + 100))
    .toString("utf8")
    .replace(/\0+$/, "");
  const prefix = Buffer.from(a.subarray(off + 345, off + 500))
    .toString("utf8")
    .replace(/\0+$/, "");
  if (!name && !prefix) {
    off += 512;
    if (off + 512 > a.length) break;
    continue;
  }
  const full = prefix ? `${prefix}/${name}` : name;
  const sizeOct = Buffer.from(a.subarray(off + 124, off + 136))
    .toString("utf8")
    .replace(/\0+$/, "")
    .trim();
  const size = sizeOct ? parseInt(sizeOct, 8) : 0;
  const typeflag = String.fromCharCode(a[off + 156] ?? 0);
  if (typeflag !== "5") {
    count++;
    const dir = full.split("/").slice(0, 3).join("/");
    byDir[dir] = (byDir[dir] ?? 0) + size;
  }
  off += 512 + Math.ceil(size / 512) * 512;
}
console.log("files:", count);
Object.entries(byDir)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([dir, size]) => console.log(`  ${Math.round(size / 1024 / 1024)}MB  ${dir}`));
