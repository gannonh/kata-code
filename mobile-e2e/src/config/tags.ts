import { MOBILE_E2E_TIMEOUTS } from "./timeouts.ts";

/**
 * Maestro flow tags for local mobile E2E filtering.
 *
 * These map 1:1 to `tags:` entries in the Maestro YAML flows and are passed to
 * `maestro test --include-tags <tag>` (without the leading `@`, which Maestro
 * strips). Keep this list in sync with the flows under `mobile-e2e/maestro/`.
 */
export const MOBILE_E2E_TAGS = {
  smoke: "@smoke",
  pairing: "@pairing",
  auth: "@auth",
  agent: "@agent",
} as const;

export type MobileE2ETag = (typeof MOBILE_E2E_TAGS)[keyof typeof MOBILE_E2E_TAGS];
export type TagKey = keyof typeof MOBILE_E2E_TAGS;

/** Key for which pairing-env builder a flow uses. `none` = injects nothing. */
export type PairEnvKind = "none" | "pairing" | "auth" | "agent";

export type CredentialGroup = "clerk" | "google" | "agent";

/** Strip the leading `@` for Maestro's `--include-tags`, which expects bare names. */
export function toMaestroTag(tag: string): string {
  return tag.startsWith("@") ? tag.slice(1) : tag;
}

/**
 * Whether a tag is selected by the run. An empty selection means "run every
 * flow", so every tag matches. Pure so selection rules are unit-tested; the
 * single shared definition for the per-call-site `tags.length === 0 ||
 * tags.includes(tag)` idiom.
 */
export function tagMatches(selection: readonly string[], tag: string): boolean {
  return selection.length === 0 || selection.includes(tag);
}

/**
 * Per-tag capability descriptor: the single source of truth for what each tag
 * requires from the harness. Replaces the four parallel ad-hoc switches that
 * previously lived in `runNeedsServer`, `requiredCredentialGroupsForTags`,
 * `buildMaestroEnv`'s `wants` closure, and `resolveFlowPaths`' filter, all of
 * which now reduce to lookups against this table.
 *
 * Adding a tag means appending one row here; every gating decision updates.
 */
export interface FlowDescriptor {
  readonly tag: MobileE2ETag;
  /** Credential groups the tag's flow needs at the prereq gate. */
  readonly credentials: readonly CredentialGroup[];
  /** True when the flow pairs to a loopback `katacode serve` stack. */
  readonly needsServer: boolean;
  /** Which pairing-env builder (`buildPairEnv` in run.ts) injects this flow's vars. */
  readonly pairEnv: PairEnvKind;
  /**
   * True when the flow composes the bearer-pairing subflow and therefore also
   * needs KC_HOST/KC_TOKEN injected (e.g. @agent pairs before composing). Pure
   * pairing flows set this implicitly via pairEnv="pairing".
   */
  readonly needsPairingVars: boolean;
  /** Maestro run timeout for flows with this tag. */
  readonly timeoutMs: number;
}

/**
 * The descriptor table, in stable `--list` order. `@auth` is a native-modal
 * sign-in (no server pairing); `@smoke` runs without a server; `@pairing` and
 * `@agent` pair to a loopback server stack.
 */
export const FLOW_DESCRIPTORS: Readonly<Record<TagKey, FlowDescriptor>> = {
  smoke: {
    tag: MOBILE_E2E_TAGS.smoke,
    credentials: [],
    needsServer: false,
    pairEnv: "none",
    needsPairingVars: false,
    timeoutMs: MOBILE_E2E_TIMEOUTS.maestroFlowMs,
  },
  pairing: {
    tag: MOBILE_E2E_TAGS.pairing,
    credentials: [],
    needsServer: true,
    pairEnv: "pairing",
    needsPairingVars: true,
    timeoutMs: MOBILE_E2E_TIMEOUTS.maestroFlowMs,
  },
  auth: {
    tag: MOBILE_E2E_TAGS.auth,
    credentials: ["clerk", "google"],
    needsServer: false,
    pairEnv: "auth",
    needsPairingVars: false,
    timeoutMs: MOBILE_E2E_TIMEOUTS.maestroFlowMs,
  },
  agent: {
    tag: MOBILE_E2E_TAGS.agent,
    credentials: ["agent"],
    needsServer: true,
    // @agent composes bearer-pair.yaml before its deterministic prompt, so it
    // needs both the pairing vars (KC_HOST/KC_TOKEN) and the agent vars.
    pairEnv: "agent",
    needsPairingVars: true,
    timeoutMs: MOBILE_E2E_TIMEOUTS.agentFlowMs,
  },
};

/** All flows the harness can select, in stable order. */
export const ALL_TAG_KEYS: readonly TagKey[] = Object.keys(FLOW_DESCRIPTORS) as TagKey[];

/** Descriptors in stable order. */
export function allDescriptors(): readonly FlowDescriptor[] {
  return ALL_TAG_KEYS.map((key) => FLOW_DESCRIPTORS[key]!);
}

/**
 * Selected descriptors for a run. An empty selection resolves to every
 * descriptor (run all). Throws fail-loud when any requested tag is unknown so
 * a typo like `--include-tags @typo` cannot silently produce an empty run
 * (which would later yield an invalid `-Infinity` timeout). Pure so selection
 * logic is unit-tested.
 */
export function selectedDescriptors(selection: readonly string[]): readonly FlowDescriptor[] {
  const all = allDescriptors();
  if (selection.length === 0) {
    return all;
  }
  const known: Set<string> = new Set(all.map((descriptor) => descriptor.tag));
  const unknown = selection.filter((tag) => !known.has(tag));
  if (unknown.length > 0) {
    throw new Error(`Unsupported mobile E2E tag(s): ${unknown.join(", ")}`);
  }
  return all.filter((descriptor) => selection.includes(descriptor.tag));
}
