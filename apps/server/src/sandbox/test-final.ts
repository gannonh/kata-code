import { buildCredentialSeedArchives } from "./credentialSeed.ts";
import * as Effect from "effect/Effect";
import * as os from "node:os";

const result = await Effect.runPromise(buildCredentialSeedArchives({ hostHome: os.homedir() }));
console.log("static:", result.static ? `${Math.round(result.static.length / 1024)}KB` : "null");
console.log("credentials:", result.credentials ? `${result.credentials.length}B` : "null");
if (result.credentials) {
  let off = 0;
  const names: string[] = [];
  const a = result.credentials;
  while (off + 512 <= a.length) {
    const name = Buffer.from(a.subarray(off, off + 100))
      .toString("utf8")
      .replace(/\0+$/, "");
    if (!name) {
      off += 512;
      continue;
    }
    const sizeOct = Buffer.from(a.subarray(off + 124, off + 136))
      .toString("utf8")
      .replace(/\0+$/, "")
      .trim();
    const size = sizeOct ? parseInt(sizeOct, 8) : 0;
    if (name) names.push(name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  console.log("credential entries:", names);
}
