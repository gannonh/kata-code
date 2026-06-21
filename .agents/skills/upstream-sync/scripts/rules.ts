/**
 * Classification rules for selective upstream sync.
 *
 * This file is the source of truth for how Kata Code triages upstream
 * `pingdotgg/t3code` commits into Port / Skip / Defer / Watch buckets.
 * Edit it when fork policy changes — the classifier script and the upstream-sync
 * skill both read from here so the rules never drift from the runbook.
 *
 * See `.agents/skills/upstream-sync/SKILL.md` and
 * `docs/guides/upstream-sync.md` for the full workflow.
 *
 * Classification is a starting point for human review, not a final verdict.
 * The fork maintainer always confirms Port/Skip/Defer/Watch before porting.
 */

/**
 * A single commit as seen by the classifier.
 */
export interface UpstreamCommit {
  readonly sha: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  /** Paths the commit touched, with git status letter (M/A/D/R...). */
  readonly files: ReadonlyArray<readonly [string, string]>;
}

/** Draft classifier verdicts. `review` means assign Port/Skip/Defer/Watch in Step 1. */
export type Classification = "port" | "skip" | "defer" | "watch" | "review";

export interface RuleHit {
  readonly rule: string;
  readonly classification: Classification;
  readonly reason: string;
}

export interface CommitVerdict {
  readonly commit: UpstreamCommit;
  readonly classification: Classification;
  readonly rationale: string;
  /** Individual rule hits that contributed to the verdict, most specific first. */
  readonly hits: ReadonlyArray<RuleHit>;
}

/**
 * Keywords in a commit subject that strongly signal fork-relevant work.
 * Order matters only for the rationale text, not the verdict — a commit that
 * hits both a port pattern and a skip pattern is flagged ambiguous for review.
 */
const PORT_SUBJECT_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [];

const WATCH_SUBJECT_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    // The "[codex]" prefix marks coordinated mechanical Effect service refactors.
    // These commits are designed to land together; port intermediate states while
    // upstream is still moving is wasted work — watch until the refactor stabilizes.
    pattern: /^\[codex\]/,
    rule: "[codex] coordinated refactor",
    reason:
      "Coordinated [codex] Effect refactor. Watch until upstream stabilizes, then port the net result.",
  },
];

const SKIP_SUBJECT_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    pattern: /\b(marketing|homepage|hero|endorsements|nav)\b/i,
    rule: "upstream marketing site",
    reason:
      "Touches the upstream marketing homepage. Kata Code ships its own web surfaces; upstream marketing work is skipped.",
  },
  {
    pattern: /\beas\b|expo|mobile-terminal-native|mobile-review-diff-native/i,
    rule: "upstream mobile EAS / Expo infra",
    reason:
      "Upstream mobile hosted infra (Expo/EAS). Kata Code mobile EAS is still disabled (Phase 2 deferred); do not absorb upstream mobile distribution changes.",
  },
];

/**
 * Path-based signals. A commit is more persuadable by what it touches than by
 * its subject line alone.
 */
const PORT_PATH_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    pattern: /^packages\/contracts\//,
    rule: "shared protocol/schema surface",
    reason:
      "Touches packages/contracts — shared protocol and schema surface that the fork consumes directly. Usually worth porting to stay close to upstream wire shapes.",
  },
  {
    pattern: /^packages\/shared\//,
    rule: "shared runtime utilities",
    reason: "Touches packages/shared — runtime utilities the fork depends on directly.",
  },
  {
    pattern: /^apps\/(server|web|desktop)\//,
    rule: "core app surface",
    reason:
      "Touches a core app (server/web/desktop). Core surfaces track upstream unless the fork has explicitly diverged.",
  },
];

const SKIP_PATH_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    // .github/workflows that are upstream-release-specific. The fork keeps its
    // own release.yml and disables upstream deploy/mobile workflows under
    // .github/disabled/. See FORK.md Phase 2.
    pattern: /^\.github\/workflows\/(deploy-relay|mobile-eas)/,
    rule: "disabled upstream workflow",
    reason:
      "Touches a workflow Kata Code keeps disabled under .github/disabled/. Upstream changes here do not apply.",
  },
  {
    pattern: /^apps\/marketing\//,
    rule: "marketing app",
    reason: "Upstream marketing app — Kata Code ships its own web surfaces.",
  },
];

/**
 * Surfaces where the fork has intentionally diverged. Commits touching these paths
 * need the maintainer to check the FORK.md divergence log.
 */
const DIVERGENCE_REVIEW_PATHS: ReadonlyArray<{ pattern: RegExp; rule: string }> = [
  {
    pattern: /packages\/contracts\/src\/wireIdentity/,
    rule: "fork wire identity (Phase 2 deferred)",
  },
  {
    pattern: /apps\/desktop\/src\/electron\/ElectronProtocol/,
    rule: "internal t3:// static protocol (deferred)",
  },
  { pattern: /infra\/relay\/src/, rule: "relay infra source (fork has its own deploy)" },
  { pattern: /infra\/relay\/alchemy/, rule: "relay infra deploy (fork has its own deploy)" },
];

/**
 * Upstream-internal docs that don't affect runtime. Classified as port so they
 * can be absorbed when porting related work; OKF closure handles fork-specific docs.
 */
const UPSTREAM_INTERNAL_DOCS_PATTERN =
  /^(\.macroscope|\.github\/ISSUE_TEMPLATE|\.github\/PULL_REQUEST_TEMPLATE|CONTRIBUTING\.md$|\.cursor|\.claude)\//;

function isDocsOnlyCommit(files: ReadonlyArray<readonly [string, string]>): boolean {
  return files.length > 0 && files.every(([, path]) => UPSTREAM_INTERNAL_DOCS_PATTERN.test(path));
}

/**
 * Known seed list of upstream paths/shas that are permanently skipped,
 * mirrored from FORK.md "Divergence log → Rejected upstream".
 */
export const PERMANENT_SKIP_SEED: ReadonlyArray<{ pattern: RegExp; reason: string }> = [];

/**
 * Classify a single commit. Returns the proposed verdict plus every rule that
 * fired, so the human reviewer can see why the script landed where it did.
 *
 * Ambiguity is surfaced explicitly: if a commit hits both port and skip signals,
 * it is classified `review` rather than silently picking one.
 */
export function classifyCommit(commit: UpstreamCommit): CommitVerdict {
  const hits: Array<RuleHit> = [];

  for (const { pattern, rule, reason } of PORT_SUBJECT_PATTERNS) {
    if (pattern.test(commit.subject)) {
      hits.push({ rule, classification: "port", reason });
    }
  }
  for (const { pattern, rule, reason } of WATCH_SUBJECT_PATTERNS) {
    if (pattern.test(commit.subject)) {
      hits.push({ rule, classification: "watch", reason });
    }
  }
  for (const { pattern, rule, reason } of SKIP_SUBJECT_PATTERNS) {
    if (pattern.test(commit.subject)) {
      hits.push({ rule, classification: "skip", reason });
    }
  }

  const touchedPaths = commit.files.map(([, path]) => path);

  if (isDocsOnlyCommit(commit.files)) {
    hits.push({
      rule: "upstream-internal docs only",
      classification: "port",
      reason:
        "Touches only upstream-internal docs (.macroscope, .github templates, CONTRIBUTING). Absorb with OKF closure; fork has its own equivalents for runtime guidance.",
    });
  }

  for (const { pattern, rule, reason } of PORT_PATH_PATTERNS) {
    if (touchedPaths.some((p) => pattern.test(p))) {
      hits.push({ rule, classification: "port", reason });
    }
  }
  for (const { pattern, rule, reason } of SKIP_PATH_PATTERNS) {
    if (touchedPaths.some((p) => pattern.test(p))) {
      hits.push({ rule, classification: "skip", reason });
    }
  }

  const divergenceHits: Array<RuleHit> = [];
  for (const { pattern, rule } of DIVERGENCE_REVIEW_PATHS) {
    if (touchedPaths.some((p) => pattern.test(p))) {
      divergenceHits.push({
        rule,
        classification: "defer",
        reason: `Touches ${rule}. Check FORK.md divergence log before deciding.`,
      });
    }
  }
  hits.push(...divergenceHits);

  const portCount = hits.filter((h) => h.classification === "port").length;
  const skipCount = hits.filter((h) => h.classification === "skip").length;
  const deferCount = hits.filter((h) => h.classification === "defer").length;
  const watchCount = hits.filter((h) => h.classification === "watch").length;

  let classification: Classification;
  let rationale: string;

  if (portCount > 0 && skipCount > 0) {
    classification = "review";
    const portRules = hits.filter((h) => h.classification === "port").map((h) => h.rule);
    const skipRules = hits.filter((h) => h.classification === "skip").map((h) => h.rule);
    rationale = `Conflicting signals: port (${portRules.join(", ")}) vs skip (${skipRules.join(", ")}). Assign Port/Skip/Defer/Watch during review.`;
  } else if (watchCount > 0 && skipCount > 0) {
    classification = "review";
    const watchRules = hits.filter((h) => h.classification === "watch").map((h) => h.rule);
    const skipRules = hits.filter((h) => h.classification === "skip").map((h) => h.rule);
    rationale = `Conflicting signals: watch (${watchRules.join(", ")}) vs skip (${skipRules.join(", ")}). Assign Port/Skip/Defer/Watch during review.`;
  } else if (watchCount > 0) {
    classification = "watch";
    rationale = hits
      .filter((h) => h.classification === "watch")
      .map((h) => h.reason)
      .join(" ");
  } else if (portCount > 0 && deferCount > 0) {
    classification = "defer";
    const portRules = hits.filter((h) => h.classification === "port").map((h) => h.rule);
    const deferRules = hits.filter((h) => h.classification === "defer").map((h) => h.rule);
    rationale = `Port signal (${portRules.join(", ")}) but also touches fork divergence surface (${deferRules.join(", ")}). Resolve with care during port.`;
  } else if (deferCount > 0) {
    classification = "defer";
    const rules = [
      ...divergenceHits,
      ...hits.filter((h) => h.classification === "defer" && !divergenceHits.includes(h)),
    ].map((h) => h.rule);
    rationale = `Deferred: ${[...new Set(rules)].join(", ")}.`;
  } else if (skipCount > 0) {
    classification = "skip";
    rationale = hits
      .filter((h) => h.classification === "skip")
      .map((h) => h.reason)
      .join(" ");
  } else if (portCount > 0) {
    classification = "port";
    rationale = hits
      .filter((h) => h.classification === "port")
      .map((h) => h.reason)
      .join(" ");
  } else {
    classification = "review";
    rationale =
      "No classification rule matched (likely upstream-internal or peripheral). Assign Port/Skip/Defer/Watch during review.";
  }

  return { commit, classification, rationale, hits };
}
