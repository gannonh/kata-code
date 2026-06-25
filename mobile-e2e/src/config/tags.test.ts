import { describe, expect, it } from "vitest";

import {
  FLOW_DESCRIPTORS,
  type FlowDescriptor,
  MOBILE_E2E_TAGS,
  selectedDescriptors,
  tagMatches,
  toMaestroTag,
} from "./tags.ts";

describe("toMaestroTag", () => {
  it("strips a leading @ so Maestro's --include-tags accepts the name", () => {
    expect(toMaestroTag("@smoke")).toBe("smoke");
  });

  it("leaves an already-bare tag unchanged", () => {
    expect(toMaestroTag("pairing")).toBe("pairing");
  });

  it("covers every declared tag", () => {
    for (const tag of Object.values(MOBILE_E2E_TAGS)) {
      expect(toMaestroTag(tag)).toBe(tag.slice(1));
    }
  });
});

describe("tagMatches", () => {
  it("matches any tag when the selection is empty (run everything)", () => {
    expect(tagMatches([], "@smoke")).toBe(true);
    expect(tagMatches([], "@agent")).toBe(true);
  });

  it("matches only tags present in a non-empty selection", () => {
    expect(tagMatches(["@smoke"], "@smoke")).toBe(true);
    expect(tagMatches(["@smoke"], "@pairing")).toBe(false);
  });
});

describe("FLOW_DESCRIPTORS", () => {
  const descriptors = Object.values(FLOW_DESCRIPTORS);

  it("marks exactly the pairing flows as needing a server", () => {
    // The invariant the @auth mis-wiring bug violated: only pairing + agent pair
    // to a loopback server; @auth is a native modal and @smoke launches standalone.
    const needsServer = descriptors
      .filter((d) => d.needsServer)
      .map((d) => d.tag)
      .sort();
    expect(needsServer).toEqual(["@agent", "@pairing"]);
  });

  it("gives each descriptor a non-zero timeout", () => {
    for (const descriptor of descriptors) {
      expect(descriptor.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("maps @auth to the clerk+google credential groups", () => {
    expect([...FLOW_DESCRIPTORS.auth!.credentials].sort()).toEqual(["clerk", "google"]);
  });

  it("maps @agent to the agent credential group", () => {
    expect(FLOW_DESCRIPTORS.agent!.credentials).toEqual(["agent"]);
  });

  it("never shares a pairing-env builder kind across server and non-server flows", () => {
    // A non-server flow must not use a pairing env builder (would inject KC_HOST/KC_TOKEN
    // that the flow ignores and start a server the flow doesn't use).
    for (const descriptor of descriptors as FlowDescriptor[]) {
      if (!descriptor.needsServer) {
        expect(descriptor.pairEnv).not.toBe("pairing");
      }
    }
  });
});

describe("selectedDescriptors", () => {
  it("returns every descriptor in stable order for an empty selection", () => {
    const all = selectedDescriptors([]);
    expect(all.map((d) => d.tag)).toEqual(["@smoke", "@pairing", "@auth", "@agent"]);
  });

  it("returns only descriptors whose tag is selected, preserving stable order", () => {
    const selected = selectedDescriptors(["@agent", "@smoke"]);
    expect(selected.map((d) => d.tag)).toEqual(["@smoke", "@agent"]);
  });

  it("throws fail-loud on an unknown tag instead of silently producing an empty run", () => {
    // An empty descriptor list would later yield Math.max(...[]) === -Infinity,
    // an invalid timeout; a typo like @typo must throw here instead.
    expect(() => selectedDescriptors(["@typo"])).toThrow(/Unsupported mobile E2E tag/);
    expect(() => selectedDescriptors(["@smoke", "@bogus"])).toThrow(/@bogus/);
  });
});
