import { expect, it } from "@effect/vitest";

import { resolveRemoteSha } from "./SandboxSourceResolver.ts";

const tagObjectSha = "a".repeat(40);
const commitSha = "b".repeat(40);

it("uses the peeled commit for an annotated GitHub tag", () => {
  const output = [`${tagObjectSha}\trefs/tags/v1`, `${commitSha}\trefs/tags/v1^{}`].join("\n");

  expect(resolveRemoteSha(output, "v1")).toBe(commitSha);
});

it("keeps a direct tag SHA when GitHub returns no peeled ref", () => {
  expect(resolveRemoteSha(`${tagObjectSha}\trefs/tags/v1`, "v1")).toBe(tagObjectSha);
});
