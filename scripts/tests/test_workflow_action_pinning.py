"""Ensure workflow dependencies are immutable and updateable through Dependabot."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
DEPENDABOT = ROOT / ".github" / "dependabot.yml"
WORKFLOW_REQUIREMENTS = ROOT / "requirements" / "workflows.txt"
ACTION_REFERENCE = re.compile(
    r"^\s*(?:-\s+)?uses:\s+actions/[\w-]+@[0-9a-f]{40}\s+#\s+v\d+\s*$"
)


class WorkflowActionPinningTests(unittest.TestCase):
    def test_deployment_cli_is_version_pinned_before_receiving_the_cloudflare_token(self):
        deploy_workflow = (WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("npm install -g wrangler@4.86.0", deploy_workflow)
        self.assertNotIn("npm install -g wrangler@4\n", deploy_workflow)
        self.assertNotIn("actions/setup-python", deploy_workflow)
        self.assertNotIn("pip install", deploy_workflow)

    def test_deployment_accepts_only_a_trusted_master_push(self):
        deploy_workflow = (WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.workflow_run.event == 'push'", deploy_workflow)
        self.assertIn(
            "github.event.workflow_run.head_repository.full_name == github.repository",
            deploy_workflow,
        )
        self.assertIn("github.event.workflow_run.head_branch == 'master'", deploy_workflow)

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
        self.assertIn("package-ecosystem: pip", config)
        self.assertIn("interval: weekly", config)
        self.assertIn("open-pull-requests-limit: 2", config)

    def test_credential_bearing_python_workflows_use_the_hash_locked_requirements(self):
        expected_install = "pip install --require-hashes -r requirements/workflows.txt"
        for name in (
            "backup-live-courses.yml",
            "catalogue-parity-audit.yml",
            "sync-live-courses.yml",
        ):
            workflow = (WORKFLOWS / name).read_text(encoding="utf-8")
            self.assertIn(expected_install, workflow, name)
            self.assertNotIn("pip install requests", workflow, name)

        requirements = WORKFLOW_REQUIREMENTS.read_text(encoding="utf-8")
        self.assertIn("requests==", requirements)
        self.assertIn("--hash=sha256:", requirements)


if __name__ == "__main__":
    unittest.main()
