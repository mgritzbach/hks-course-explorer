"""Ensure workflow dependencies are immutable and updateable through Dependabot."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
DEPENDABOT = ROOT / ".github" / "dependabot.yml"
ACTION_REFERENCE = re.compile(
    r"^\s*(?:-\s+)?uses:\s+actions/[\w-]+@[0-9a-f]{40}\s+#\s+v\d+\s*$"
)


class WorkflowActionPinningTests(unittest.TestCase):
    def test_all_official_actions_are_full_sha_pinned_with_a_readable_version(self):
        references = []
        for workflow in sorted(WORKFLOWS.glob("*.yml")):
            for line in workflow.read_text(encoding="utf-8").splitlines():
                if "uses: actions/" in line:
                    references.append((workflow.name, line))

        self.assertTrue(references, "Expected at least one official GitHub Action reference")
        for workflow, line in references:
            self.assertRegex(line, ACTION_REFERENCE, f"Mutable or undocumented action reference in {workflow}")

    def test_dependabot_keeps_action_pins_reviewable_and_current(self):
        config = DEPENDABOT.read_text(encoding="utf-8")
        self.assertIn("package-ecosystem: github-actions", config)
        self.assertIn("interval: weekly", config)
        self.assertIn("open-pull-requests-limit: 2", config)


if __name__ == "__main__":
    unittest.main()
