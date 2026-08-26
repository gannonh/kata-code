#!/usr/bin/env python3
"""Tests for skill-doctor report rendering."""

import unittest
from pathlib import Path

from render_report import embedded_diffs_script, render_page


class ReportRendererTests(unittest.TestCase):
    def test_skill_startup_contract_is_centralized(self):
        skill_root = Path(__file__).resolve().parent.parent
        skill_text = (skill_root / "SKILL.md").read_text()
        harness_text = (
            skill_root / "references" / "supported-harnesses.md"
        ).read_text()

        self.assertIn(
            "$SKILL_ROOT/references/supported-harnesses.md",
            skill_text,
        )
        self.assertIn("Conversations in this repository", skill_text)
        self.assertIn("All conversations", skill_text)
        self.assertIn("Choose projects to analyze", skill_text)
        self.assertIn(
            "Project skills + global skills",
            skill_text,
        )
        self.assertIn("Project skills only", skill_text)
        self.assertIn(
            "Process datasets of 50 transcripts or fewer in a single batch",
            skill_text,
        )
        self.assertIn(
            "For datasets with more than 50 transcripts, use parallel batches "
            "(20 transcripts per batch recommended)",
            skill_text,
        )
        self.assertNotIn("--harness claude|codex|warp", skill_text)
        self.assertNotIn("--claude-home PATH", skill_text)
        self.assertIn("| Warp | `warp` |", harness_text)
        self.assertIn("| Claude Code | `claude` |", harness_text)
        self.assertIn("| Codex | `codex` |", harness_text)
        self.assertIn(
            "Skill discovery and conversation collection are separate "
            "compatibility layers",
            harness_text,
        )
        self.assertIn("~/.gemini/tmp/<project-id>/chats/", harness_text)
        self.assertIn("stop before creating a report directory", harness_text)

    def test_code_diffs_follow_os_theme(self):
        bundle = embedded_diffs_script()

        self.assertIn('themeType:"system"', bundle)
        self.assertIn(
            'theme:{dark:"pierre-dark",light:"pierre-light"}',
            bundle,
        )

    def test_report_follows_os_theme(self):
        page = render_page({
            "scores": {
                "efficiency": 1.0,
                "code_quality": 1.0,
                "skill_coverage": 1.0,
                "overall": 1.0,
            },
        })

        self.assertIn('<meta name="color-scheme" content="light dark">', page)
        self.assertIn("@media (prefers-color-scheme: dark)", page)
        self.assertIn("--page-bg: #0f0d14", page)
        self.assertIn("background: var(--surface)", page)
        self.assertIn(
            "--mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            page,
        )
        self.assertIn("--diffs-font-family: var(--mono-font)", page)
        self.assertIn("--diffs-header-font-family: var(--mono-font)", page)

    def test_factories_footer_is_sticky_and_contains_inline_cta(self):
        report = {
            "title": "Agent Skill Report",
            "generated_at": "2026-08-25T00:00:00Z",
            "harness": "codex",
            "handle": "example",
            "stats": {
                "sessions_analyzed": 1,
                "sessions_scanned": 1,
                "skills_found": 1,
                "skills_used": 1,
                "window_days": 45,
            },
            "scores": {
                "efficiency": 1.0,
                "code_quality": 1.0,
                "skill_coverage": 1.0,
                "overall": 1.0,
            },
            "top_findings": ["No material waste detected."],
            "suggestions": [],
            "cta_url": "https://warp.dev/factories/request-access",
        }

        page = render_page(report)

        self.assertNotIn("Do this automatically with Warp Factories", page)
        self.assertIn('<div class="stamp-row row factories-footer">', page)
        self.assertIn(
            '<div class="stamp-name">Self improve your workflows with Warp Factories</div>',
            page,
        )
        self.assertIn(">Request access to Warp Factories</a>", page)
        self.assertIn(".factories-footer { position: sticky; bottom: 16px;", page)

    def test_share_card_uses_skill_doctor_attribution(self):
        page = render_page({
            "scores": {
                "efficiency": 1.0,
                "code_quality": 1.0,
                "skill_coverage": 1.0,
                "overall": 1.0,
            },
        })

        self.assertIn(
            '"stamp": ["Get your report with /skill-doctor", '
            '"npx skills add warpdotdev/common-skills --skill skill-doctor"]',
            page,
        )
        self.assertIn('"eyebrow": "skill-doctor"', page)
        self.assertIn("text('# ' + CARD.eyebrow", page)

    def test_skill_output_uses_report_and_warp_factories_labels(self):
        skill_path = Path(__file__).resolve().parent.parent / "SKILL.md"
        skill_text = skill_path.read_text()

        self.assertIn(
            "- Your agent skill report: [View in browser]",
            skill_text,
        )
        self.assertIn(
            "- Want to automate self improvement for your workflows? "
            "[Request access to Warp Factories]",
            skill_text,
        )


if __name__ == "__main__":
    unittest.main()
