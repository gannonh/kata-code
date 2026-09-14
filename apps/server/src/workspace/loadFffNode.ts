// @effect-diagnostics nodeBuiltinImport:off
import * as NodeModule from "node:module";
import type * as FffNode from "@ff-labs/fff-node";

const requireForFff = NodeModule.createRequire(import.meta.url);
// Join at runtime so the SEA bundle scanner does not treat this as an ESM import
// of an external package. Docker's npm ci installs the registry package, which
// has no `require` export; createRequire then fails and import() uses `import`.
const FFF_NODE_SPECIFIER = ["@ff-labs", "fff-node"].join("/");

function isEsmOnlyLoadError(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object" || !("code" in cause)) return false;
  const code = String(Reflect.get(cause, "code"));
  return code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || code === "ERR_REQUIRE_ESM";
}

export async function loadFffNode(
  requireFn: NodeJS.Require = requireForFff,
): Promise<typeof FffNode> {
  try {
    return requireFn(FFF_NODE_SPECIFIER) as typeof FffNode;
  } catch (cause) {
    if (!isEsmOnlyLoadError(cause)) throw cause;
    return import(FFF_NODE_SPECIFIER);
  }
}
