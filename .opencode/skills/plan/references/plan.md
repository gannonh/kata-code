# Plan Workflow

Help turn ideas into fully formed design specs through natural collaborative dialogue, then publish the spec as a Linear issue in Backlog.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval of the draft. Humans move Backlog to Todo.

The result is a Linear issue whose description is the spec. Read `references/conventions.md` before starting.

Every spec issue must include an explicit `## Acceptance criteria` section written as task-list checkboxes.

## Checklist

Create a task for each of these items and complete them in order:

1. **Run preflight:** Linear MCP, team, project, required states, existing-issue search
2. **Explore project context:** files, docs, recent commits, related Linear issues and GitHub PRs
3. **Ask clarifying questions:** one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches:** with trade-offs and your recommendation
5. **Define acceptance criteria:** agree on observable pass/fail outcomes before writing the spec
6. **Shape delivery slices:** identify the smallest end-to-end user-visible outcomes and how each can be demonstrated independently
7. **Present design:** in sections scaled to their complexity, get user approval after each section
8. **Publish spec issue:** `save_issue` in Backlog
9. **Decompose into sub-issues:** only when the spec contains multiple independently deliverable vertical slices
10. **Adversarial spec review:** dispatch a separate sub-agent that did not write the spec
11. **Validate reviewer feedback:** revise the issue when feedback is valid and actionable, or provide a reasoned rebuttal when it is not
12. **User reviews the issue:** ask the user to read the issue before approving
13. **Wait for Todo:** humans approve by moving Backlog to Todo
14. **Transition to Build phase:** ask the user if they would like to advance to Build after Todo

**The terminal state is a complete Backlog spec waiting for Todo.** Do not invoke any other implementation skill. The ONLY workflow you invoke after Plan is Build.

## The Process

**Preflight:**

- Run the preflight from `references/conventions.md`.
- Search for an existing issue covering this work before designing anything new:

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "query": "<keywords>",
  "includeArchived": false
})
```

- If an open issue already covers the request, ask whether to extend that issue instead of opening a new one. Extending means editing the existing description and leaving or returning it to Backlog.
- If a Canceled, Duplicate, or Done issue covers it, read it before proposing anything. Prior scope decisions are context. New work on a terminal issue requires a new issue.

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits, open PRs, related Linear issues)
- Before asking detailed questions, assess scope: if the request describes multiple independent user outcomes, flag this immediately.
- Before decomposing, identify the earliest thin end-to-end path a user, operator, or API/SDK consumer could exercise.
- If the project is too large for a single spec, help the user decompose it into independently demonstrable outcomes. Decomposition produces a parent issue with vertical-slice children.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible
- Only one question per message
- Focus on understanding: purpose, constraints, success criteria
- Convert success criteria into concrete acceptance criteria before drafting the spec

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs.
- Compare how quickly each approach produces a real user-observable increment.
- Present options conversationally with your recommendation and reasoning.
- Lead with your recommended option and explain why.

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity
- Ask after each section whether it looks right so far
- Cover: architecture, components, acceptance criteria, data flow, error handling, testing, delivery slices, and how each slice will be demonstrated.
- Present acceptance criteria as their own design section and ask the user to approve or revise them before publishing the issue.
- Present delivery slices as user outcomes in delivery order.
- Define the evidence path for each slice before publishing.
- Be ready to go back and clarify if something doesn't make sense

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose
- Do not confuse code boundaries with delivery boundaries. A roadmap slice should cross modules when that is what makes a behavior usable and demonstrable.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work, include targeted improvements as part of the design.
- Don't propose unrelated refactoring.

## Publishing the spec issue

After the user approves the design conversationally:

1. Compose the description using the spec issue body template from `references/conventions.md`.
2. Write acceptance criteria as `- [ ]` checkboxes.
3. Create the issue in Backlog:

```
save_issue({
  "title": "<concise outcome-oriented title>",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "description": "<spec body>"
})
```

4. Add any existing Linear labels that apply. Create optional hygiene labels through MCP only when needed.
5. Report the issue identifier and URL to the user.

Title guidance: state the outcome, not the activity. Keep it under 70 characters.

## Decomposition

Decompose when the spec contains more than one independently deliverable and verifiable user outcome, or when the user asks.

Structure: **parent holds the outcome; children each deliver a vertical slice.**

Use the vertical-slice test before creating children:

- Can a user, operator, or API/SDK consumer exercise meaningful new behavior after this child alone is verified?
- Does the child include the minimum storage, domain, backend, protocol, UI/docs, and tests needed for that behavior?
- Can it be demonstrated without later children?

If the answer is no, first try to re-cut the work around a thinner user journey.

A technical-enablement child is acceptable only when a thin end-to-end slice would be unsafe or infeasible. Keep it minimal, document why, and name the immediate user-facing slice it unlocks.

1. Keep goal, context, constraints, architecture, risks, and top-level acceptance criteria on the parent.
2. Replace the parent's `## Delivery slices` section with a short list naming each user-observable slice and its child identifier once created.
3. For each slice, compose a child body with its own `## Goal`, `## Context` (linking the parent), `## Acceptance criteria`, `## Delivery slices`, `## Demonstration`, and `## Build handoff`, then:

```
save_issue({
  "title": "<user-observable outcome>",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "parentId": "<parent-id>",
  "description": "<child spec body>"
})
```

4. Record every real technical ordering constraint as `blockedBy`:

```
save_issue({
  "id": "<child-2>",
  "blockedBy": ["<child-1>"]
})
```

Also state it in the child's `## Context` so a reader of the body alone still sees it.

5. Verify the hierarchy:

```
get_issue({ "id": "<parent-id>", "includeRelations": true })
list_issues({ "team": "<team>", "project": "<project>", "parentId": "<parent-id>" })
```

Do not nest more than one level.

## Acceptance criteria section

The issue description must include this exact heading:

```markdown
## Acceptance criteria
```

Under it, a checkbox list. Each criterion must be:

- observable by a reviewer, test, command, screenshot, API response, or manual UAT step
- specific enough to produce a clear Pass/Fail/Blocked result during Verify
- tied to user-visible behavior, required system behavior, safety constraints, or approved non-goals
- free of vague language such as "fast", "easy", "robust", or "works" unless paired with an observable threshold or example

If acceptance criteria are genuinely unknown, stop and ask the user. Do not publish an issue with missing, placeholder, or implied criteria.

## Adversarial spec review

After publishing the issue, dispatch a separate adversarial sub-agent that did not write the spec. Give it the issue identifier and tell it to read the issue with `get_issue({ "id": "<id>", "includeRelations": true })`. Do not replace this with a same-agent self-review. If no sub-agent mechanism is available, say so and ask the user how to proceed.

Use `references/spec-reviewer-prompt.md` for the reviewer brief. Ask the reviewer to challenge:

1. **Acceptance criteria gate:** Does the issue include an exact `## Acceptance criteria` heading with checkbox criteria? Does each item have a clear verification path and pass/fail meaning?
2. **Placeholder scan:** Are there any "TBD", "TODO", incomplete sections, or vague requirements?
3. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
4. **Scope check:** Is this focused enough for a single spec, or does it need decomposition into sub-issues?
5. **Ambiguity check:** Could any requirement be interpreted two different ways?
6. **Feasibility and verification:** Are there repo, dependency, testing, sequencing, or risk assumptions that need evidence?
7. **Sub-issue coherence:** If decomposed, do the children cover the parent's acceptance criteria completely, with no gaps and no overlap?
8. **Vertical-slice check:** Does each child name a human, operator, or API/SDK consumer and deliver a consumer/action → observable result through a public interface and evidence path?

The main agent validates the reviewer's feedback. Revise the issue description when feedback is valid and actionable:

```
get_issue({ "id": "<id>" })
save_issue({
  "id": "<id>",
  "description": "<revised spec body>"
})
```

When feedback is not valid or not actionable, leave the description unchanged for that point and record a reasoned rebuttal with `save_comment`.

## User review gate

After the adversarial review and main-agent validation pass, ask the user to review the issue and move it from Backlog to Todo when they approve.

Wait for the user's response. If they request changes, make them and re-run the adversarial review loop. Only proceed to Build once the issue is in Todo.

Plan does not write Todo.

## Build phase

- Ask the user if they would like to advance to the Build phase after the issue is in Todo.
- For an epic, name the first Todo, unblocked user-facing slice Build should start with.
- Do NOT invoke any other skill.

## Key Principles

- **One question at a time**
- **Multiple choice preferred**
- **Search before creating**
- **YAGNI ruthlessly**
- **Explore alternatives**
- **Incremental validation**
- **Vertical delivery**
- **Early feedback**
- **The Linear issue is the spec**
- **Be flexible**
