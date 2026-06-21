/**
 * Classification rules for selective upstream sync.
 *
 * This file is the source of truth for how Kata Code triages upstream
 * `pingdotgg/t3code` commits into Take / Cherry-pick / Reject / Defer buckets.
 * Edit it when fork policy changes — the classifier script and the upstream-sync
 * skill both read from here so the rules never drift from the runbook.
 *
 * See `.agents/skills/upstream-sync/SKILL.md` and
 * `docs/guides/upstream-sync.md` for the full workflow.
 *
 * Classification is a starting point for human review, not a final verdict.
 * The fork maintainer always confirms Take/Reject/Defer before merging.
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

export type Classification = "take" | "cherry-pick" | "reject" | "defer" | "review";

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
 * hits both a take pattern and a reject pattern is flagged ambiguous for review.
 */
const TAKE_SUBJECT_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    // The "[codex]" prefix marks coordinated mechanical Effect service refactors.
    // These commits are designed to be taken together; cherry-picking one in
    // isolation usually fails to compile because they depend on each other.
    pattern: /^\[codex\]/,
    rule: "[codex] coordinated refactor",
    reason:
      "Coordinated [codex] Effect refactor. These commits are designed to land together; cherry-picking in isolation typically breaks compilation.",
  },
];

const REJECT_SUBJECT_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    pattern: /\b(marketing|homepage|hero|endorsements|nav)\b/i,
    rule: "upstream marketing site",
    reason:
      "Touches the upstream marketing homepage. Kata Code ships its own web surfaces; upstream marketing work is rejected.",
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
 *
 * `test` = take/reject signal contribution; these run after subject rules and
 * only when the subject rules did not already produce an unambiguous verdict.
 */
const TAKE_PATH_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
  {
    pattern: /^packages\/contracts\//,
    rule: "shared protocol/schema surface",
    reason:
      "Touches packages/contracts — shared protocol and schema surface that the fork consumes directly. Usually worth absorbing to stay close to upstream wire shapes.",
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

const REJECT_PATH_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; reason: string }> = [
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
 * need the maintainer to check the FORK.md divergence log. Narrow the patterns so
 * a bare `package.json` version bump does not trip the strong divergence signal
 * — only source/config that actually carries fork policy does.
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
 * Upstream-internal docs that don't affect runtime. Classified as take so they
 * land with the bulk merge; OKF closure in Step 6 handles fork-specific docs.
 */
const UPSTREAM_INTERNAL_DOCS_PATTERN =
  /^(\.macroscope|\.github\/ISSUE_TEMPLATE|\.github\/PULL_REQUEST_TEMPLATE|CONTRIBUTING\.md$|\.cursor|\.claude)\//;

function isDocsOnlyCommit(files: ReadonlyArray<readonly [string, string]>): boolean {
  return files.length > 0 && files.every(([, path]) => UPSTREAM_INTERNAL_DOCS_PATTERN.test(path));
}

/**
 * Known seed list of upstream paths/shas that are permanently rejected,
 * mirrored from FORK.md "Divergence log → Rejected upstream".
 *
 * Extend this array when FORK.md records a permanent reject; runtime parsing
 * of FORK.md is not implemented yet.
 */
export const PERMANENT_REJECT_SEED: ReadonlyArray<{ pattern: RegExp; reason: string }> = [];

/**
 * Classify a single commit. Returns the proposed verdict plus every rule that
 * fired, so the human reviewer can see why the script landed where it did.
 *
 * Ambiguity is surfaced explicitly: if a commit hits both a take and a reject
 * signal, it is classified `review` with rationale "Conflicting signals —
 * review manually" rather than silently picking one. This is the most
 * important property of the classifier: never hide a fork-policy conflict.
 */
export function classifyCommit(commit: UpstreamCommit): CommitVerdict {
  const hits: Array<RuleHit> = [];

  for (const { pattern, rule, reason } of TAKE_SUBJECT_PATTERNS) {
    if (pattern.test(commit.subject)) {
      hits.push({ rule, classification: "take", reason });
    }
  }
  for (const { pattern, rule, reason } of REJECT_SUBJECT_PATTERNS) {
    if (pattern.test(commit.subject)) {
      hits.push({ rule, classification: "reject", reason });
    }
  }

  const touchedPaths = commit.files.map(([, path]) => path);

  if (isDocsOnlyCommit(commit.files)) {
    hits.push({
      rule: "upstream-internal docs only",
      classification: "take",
      reason:
        "Touches only upstream-internal docs (.macroscope, .github templates, CONTRIBUTING). Absorb with OKF closure in Step 6; fork has its own equivalents for runtime guidance.",
    });
  }

  for (const { pattern, rule, reason } of TAKE_PATH_PATTERNS) {
    if (touchedPaths.some((p) => pattern.test(p))) {
      hits.push({ rule, classification: "take", reason });
    }
  }
  for (const { pattern, rule, reason } of REJECT_PATH_PATTERNS) {
    if (touchedPaths.some((p) => pattern.test(p))) {
      hits.push({ rule, classification: "reject", reason });
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

  const takeCount = hits.filter((h) => h.classification === "take").length;
  const rejectCount = hits.filter((h) => h.classification === "reject").length;
  const deferCount = hits.filter((h) => h.classification === "defer").length;

  let classification: Classification;
  let rationale: string;

  if (takeCount > 0 && rejectCount > 0) {
    // Conflicting take+reject signals (e.g. a [codex] refactor that also touches
    // a marketing surface) cannot be resolved mechanically. This is the
    // "review" verdict in the runbook vocabulary: not a clean take, not a clean
    // reject, not a project-phase deferral — a human must decide.
    classification = "review";
    const takeRules = hits.filter((h) => h.classification === "take").map((h) => h.rule);
    const rejectRules = hits.filter((h) => h.classification === "reject").map((h) => h.rule);
    rationale = `Conflicting signals: take (${takeRules.join(", ")}) vs reject (${rejectRules.join(", ")}). Review manually.`;
  } else if (takeCount > 0 && deferCount > 0) {
    // A [codex] coordinated refactor that also touches a fork divergence surface
    // is the classic hard case: the refactor wants to land together, but the
    // fork has policy-level reasons to diverge here. Surface both signals so the
    // reviewer sees the take was not missed.
    classification = "defer";
    const takeRules = hits.filter((h) => h.classification === "take").map((h) => h.rule);
    const deferRules = hits.filter((h) => h.classification === "defer").map((h) => h.rule);
    rationale = `Take signal (${takeRules.join(", ")}) but also touches fork divergence surface (${deferRules.join(", ")}). Resolve with care: likely needs manual conflict resolution, not a clean take.`;
  } else if (deferCount > 0) {
    classification = "defer";
    const rules = [
      ...divergenceHits,
      ...hits.filter((h) => h.classification === "defer" && !divergenceHits.includes(h)),
    ].map((h) => h.rule);
    rationale = `Deferred: ${[...new Set(rules)].join(", ")}.`;
  } else if (rejectCount > 0) {
    classification = "reject";
    rationale = hits
      .filter((h) => h.classification === "reject")
      .map((h) => h.reason)
      .join(" ");
  } else if (takeCount > 0) {
    classification = "take";
    rationale = hits
      .filter((h) => h.classification === "take")
      .map((h) => h.reason)
      .join(" ");
  } else {
    // No rule fired. This is the "review" verdict: the classifier had no signal
    // — it is NOT tied to a named fork project phase or revisit trigger, so it
    // is not a legitimate "defer". The human assigns it to take/reject/defer.
    classification = "review";
    rationale =
      "No classification rule matched (likely upstream-internal or peripheral). Not tied to any fork project phase — assign to Take/Reject/Defer during review.";
  }

  return { commit, classification, rationale, hits };
}
