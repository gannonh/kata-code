// @effect-diagnostics nodeBuiltinImport:off - temp fixture setup for filesystem skill discovery tests.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { makeProviderSkillInvocationToken } from "@kata-sh/code-shared/providerSkills";

import {
  discoverCursorFilesystemSkills,
  expandSkillTokensInText,
  expandCursorSkillTokensInPrompt,
  formatSkillInvocationBlock,
} from "./filesystemSkills.ts";

function writeSkill(
  root: string,
  relativePath: string,
  name: string,
  description: string,
  body: string,
  extraFrontmatter = "",
): string {
  const skillDir = NodePath.join(root, relativePath);
  NodeFs.mkdirSync(skillDir, { recursive: true });
  const filePath = NodePath.join(skillDir, "SKILL.md");
  NodeFs.writeFileSync(
    filePath,
    `---
name: ${name}
description: ${description}
${extraFrontmatter ? `${extraFrontmatter}\n` : ""}---

${body}
`,
    "utf-8",
  );
  return filePath;
}

describe("discoverCursorFilesystemSkills", () => {
  it("discovers project and user skills from Cursor-compatible directories", () => {
    const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "cursor-skills-"));
    const homeDir = NodePath.join(root, "home");
    NodeFs.mkdirSync(homeDir, { recursive: true });

    const projectSkillPath = writeSkill(
      root,
      ".cursor/skills/devbox",
      "devbox",
      "Dev containers",
      "Use devbox.",
    );
    const userSkillPath = writeSkill(
      homeDir,
      ".agents/skills/review",
      "review",
      "Code review",
      "Review carefully.",
    );

    const discovered = discoverCursorFilesystemSkills({ cwd: root, homeDir });

    expect(discovered.skills).toEqual([
      {
        name: "devbox",
        path: projectSkillPath,
        scope: "project",
        enabled: true,
        description: "Dev containers",
      },
      {
        name: "review",
        path: userSkillPath,
        scope: "user",
        enabled: true,
        description: "Code review",
      },
    ]);
    expect(discovered.indexedByName.get("devbox")?.filePath).toBe(projectSkillPath);
  });

  it("prefers the first discovered skill when names collide", () => {
    const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "cursor-skills-dup-"));
    const projectPath = writeSkill(
      root,
      ".cursor/skills/deploy",
      "deploy",
      "Project deploy",
      "Project body",
    );
    writeSkill(root, ".agents/skills/deploy", "deploy", "Agents deploy", "Agents body");

    const discovered = discoverCursorFilesystemSkills({ cwd: root, homeDir: root });

    expect(discovered.skills).toHaveLength(2);
    expect(discovered.indexedByName.get("deploy")?.filePath).toBe(projectPath);
  });
});

describe("expandSkillTokensInText", () => {
  it("expands known tokens into inline skill XML with full path", () => {
    const skill = {
      name: "devbox",
      filePath: "/tmp/project/.cursor/skills/devbox/SKILL.md",
      baseDir: "/tmp/project/.cursor/skills/devbox",
      scope: "project" as const,
    };
    const indexed = new Map([[skill.name, skill]]);
    const expanded = expandSkillTokensInText(
      "Please $devbox for this branch",
      indexed,
      new Map(),
      () => "---\nname: devbox\n---\n\nRun devbox.",
    );

    expect(expanded).toContain(
      '<skill name="devbox" location="/tmp/project/.cursor/skills/devbox/SKILL.md">',
    );
    expect(expanded).toContain("References are relative to /tmp/project/.cursor/skills/devbox.");
    expect(expanded).toContain("Run devbox.");
    expect(expanded.endsWith("for this branch")).toBe(true);
  });

  it("expands path-qualified tokens to the selected skill", () => {
    const first = {
      name: "review",
      filePath: "/tmp/project/.cursor/skills/review/SKILL.md",
      baseDir: "/tmp/project/.cursor/skills/review",
      scope: "project" as const,
    };
    const second = {
      name: "review",
      filePath: "/tmp/project/.agents/skills/review/SKILL.md",
      baseDir: "/tmp/project/.agents/skills/review",
      scope: "project" as const,
    };
    const selectedToken = makeProviderSkillInvocationToken({
      name: second.name,
      path: second.filePath,
    });
    const expanded = expandSkillTokensInText(
      `Use $${selectedToken}`,
      new Map([[first.name, first]]),
      new Map([[selectedToken, second]]),
      (skill) => `---\nname: review\n---\n\n${skill.filePath}`,
    );

    expect(expanded).toContain(second.filePath);
    expect(expanded).not.toContain(first.filePath);
  });

  it("leaves unknown tokens unchanged", () => {
    const expanded = expandSkillTokensInText("Try $missing now", new Map(), new Map(), () => "");
    expect(expanded).toBe("Try $missing now");
  });
});

describe("expandCursorSkillTokensInPrompt", () => {
  it("discovers and expands tokens from the project cwd", () => {
    const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "cursor-skills-expand-"));
    writeSkill(root, ".cursor/skills/devbox", "devbox", "Dev containers", "Run devbox.");

    const expanded = expandCursorSkillTokensInPrompt("Please $devbox now", {
      cwd: root,
      homeDir: root,
    });

    expect(expanded).toContain('<skill name="devbox"');
    expect(expanded).toContain("Run devbox.");
    expect(expanded.endsWith("now")).toBe(true);
  });
});

describe("formatSkillInvocationBlock", () => {
  it("strips YAML frontmatter from the skill body", () => {
    const block = formatSkillInvocationBlock(
      {
        name: "review",
        filePath: "/tmp/review/SKILL.md",
        baseDir: "/tmp/review",
        scope: "user",
      },
      "---\nname: review\ndescription: Review\n---\n\nReview the diff.",
    );

    expect(block).not.toContain("description: Review");
    expect(block).toContain("Review the diff.");
  });

  it("escapes XML-sensitive characters in skill metadata attributes", () => {
    const block = formatSkillInvocationBlock(
      {
        name: 'review" onclick="<',
        filePath: '/tmp/review" onclick="<',
        baseDir: "/tmp/review",
        scope: "user",
      },
      "Review the diff.",
    );

    expect(block).toContain('name="review&quot; onclick=&quot;&lt;"');
    expect(block).toContain('location="/tmp/review&quot; onclick=&quot;&lt;"');
  });
});

describe("expandSkillTokensInText resilience", () => {
  it("leaves the token unchanged when skill content cannot be read", () => {
    const skill = {
      name: "devbox",
      filePath: "/tmp/project/.cursor/skills/devbox/SKILL.md",
      baseDir: "/tmp/project/.cursor/skills/devbox",
      scope: "project" as const,
    };
    const expanded = expandSkillTokensInText(
      "Please $devbox now",
      new Map([[skill.name, skill]]),
      new Map(),
      () => {
        throw new Error("ENOENT");
      },
    );

    expect(expanded).toBe("Please $devbox now");
  });

  it("does not expand disabled skills", () => {
    const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "cursor-skills-disabled-"));
    const skillPath = writeSkill(
      root,
      ".cursor/skills/manual-only",
      "manual-only",
      "Manual only",
      "Do not auto invoke.",
      "disable-model-invocation: true",
    );

    const discovered = discoverCursorFilesystemSkills({ cwd: root, homeDir: root });
    expect(discovered.skills).toEqual([
      {
        name: "manual-only",
        path: skillPath,
        scope: "project",
        enabled: false,
        description: "Manual only",
      },
    ]);
    expect(discovered.indexedByName.has("manual-only")).toBe(false);

    const expanded = expandCursorSkillTokensInPrompt("Try $manual-only now", {
      cwd: root,
      homeDir: root,
    });
    expect(expanded).toBe("Try $manual-only now");
  });
});
