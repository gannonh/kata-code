import { describe, expect, it } from "vite-plus/test";
import { RepositoryCanonicalKey } from "@kata-sh/code-contracts";

import {
  applySavedEnvironmentFieldPatch,
  applySavedEnvironmentTerminalPatch,
  removeSavedEnvironmentTerminal,
} from "./SavedEnvironmentEditor.logic";

const REPOSITORY_KEY = RepositoryCanonicalKey.make("github.com/acme/app");

describe("SavedEnvironmentEditor logic", () => {
  it("writes saved environment edits under the selected repository key", () => {
    const next = applySavedEnvironmentFieldPatch({}, REPOSITORY_KEY, {
      install: "pnpm install",
      start: "pnpm dev",
      networkAccess: "public",
    });

    expect(next[REPOSITORY_KEY]).toMatchObject({
      install: "pnpm install",
      start: "pnpm dev",
      networkAccess: "public",
    });
  });

  it("drops empty fields and removes the map entry once the environment is empty", () => {
    const current = {
      [REPOSITORY_KEY]: {
        install: "pnpm install",
      },
    };

    expect(applySavedEnvironmentFieldPatch(current, REPOSITORY_KEY, { install: "" })).toEqual({});
  });

  it("replaces terminal rows without concatenating stale entries", () => {
    const current = {
      [REPOSITORY_KEY]: {
        terminals: [
          { name: "web", command: "pnpm dev" },
          { name: "worker", command: "pnpm worker" },
        ],
      },
    };

    const edited = applySavedEnvironmentTerminalPatch(current, REPOSITORY_KEY, 0, {
      command: "pnpm dev --host 0.0.0.0",
    });
    const removed = removeSavedEnvironmentTerminal(edited, REPOSITORY_KEY, 1);

    expect(removed[REPOSITORY_KEY]?.terminals).toEqual([
      { name: "web", command: "pnpm dev --host 0.0.0.0" },
    ]);
  });
});
