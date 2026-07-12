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
        self.assertIn("pip install --require-hashes -r requirements/workflows.txt", deploy_workflow)

    def test_deployment_accepts_only_a_trusted_master_push(self):
        deploy_workflow = (WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("github.event.workflow_run.event == 'push'", deploy_workflow)
        self.assertIn(
            "github.event.workflow_run.head_repository.full_name == github.repository",
            deploy_workflow,
        )
        self.assertIn("github.event.workflow_run.head_branch == 'master'", deploy_workflow)

    def test_unchanged_rate_limiter_does_not_block_pages_deploy(self):
        deploy_workflow = (WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("fetch-depth: 2", deploy_workflow)
        self.assertIn("git diff --quiet HEAD^ HEAD -- workers/chat-rate-limiter", deploy_workflow)
        self.assertIn("if: steps.rate-limiter.outputs.changed == 'true'", deploy_workflow)

    def test_deploy_smokes_default_and_custom_production_domains(self):
        deploy_workflow = (WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("Smoke-test deployed Pages entrypoint", deploy_workflow)
        self.assertIn("Smoke-test custom production domain", deploy_workflow)
        self.assertIn("DEPLOY_SMOKE_URL: https://hks-course-explorer.org/", deploy_workflow)

    def test_deploy_gates_production_on_an_isolated_browser_tested_candidate(self):
        deploy_workflow = (WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")
        catalogue_manifest = deploy_workflow.index(
            "Verify active HKS catalogue manifest and exact row parity"
        )
        exact_build = deploy_workflow.index("Build exact CI commit")
        candidate_deploy = deploy_workflow.index("Deploy isolated Pages release candidate")
        candidate_static = deploy_workflow.index("Smoke-test exact release-candidate artifact")
        browser_install = deploy_workflow.index("Install production smoke browser")
        candidate_browser = deploy_workflow.index("Exercise release candidate in a real browser")
        stale_guard = deploy_workflow.index("Refuse stale master promotion")
        cache_policy = deploy_workflow.index("Enforce custom-domain browser cache policy")
        production_deploy = deploy_workflow.index("Deploy to Cloudflare Pages", candidate_browser)
        production_static = deploy_workflow.index("Smoke-test custom production domain")
        production_browser = deploy_workflow.index("Exercise production in a real browser")
        record_commit = deploy_workflow.index("Record deployed commit")

        self.assertLess(catalogue_manifest, exact_build)
        self.assertLess(exact_build, candidate_deploy)
        self.assertLess(candidate_deploy, candidate_static)
        self.assertLess(candidate_static, browser_install)
        self.assertLess(browser_install, candidate_browser)
        self.assertLess(candidate_browser, stale_guard)
        self.assertLess(stale_guard, cache_policy)
        self.assertLess(cache_policy, production_deploy)
        self.assertLess(stale_guard, production_deploy)
        self.assertLess(production_deploy, production_static)
        self.assertLess(production_static, production_browser)
        self.assertLess(production_browser, record_commit)
        self.assertIn("npm run test:e2e:production", deploy_workflow)
        self.assertIn("https://release-candidate.hks-course-explorer.pages.dev/", deploy_workflow)
        self.assertEqual(deploy_workflow.count("DEPLOY_MIN_HKS_OFFERINGS: '285'"), 2)
        self.assertIn("group: hks-production-release", deploy_workflow)
        self.assertIn("cancel-in-progress: false", deploy_workflow)
        self.assertIn("git rev-parse origin/master", deploy_workflow)
        self.assertIn("github.event.workflow_run.head_sha", deploy_workflow)
        self.assertIn("Refusing stale release", deploy_workflow)
        self.assertIn("ensure_cloudflare_browser_cache.py", deploy_workflow)
        self.assertIn("--zone hks-course-explorer.org", deploy_workflow)
        self.assertIn("--apply", deploy_workflow)
        self.assertIn("Retain production browser diagnostics", deploy_workflow)
        self.assertIn("python scripts/verify_live_hks_catalogue.py", deploy_workflow)
        self.assertIn("MAX_HKS_CATALOGUE_AGE_HOURS: '48'", deploy_workflow)
        catalogue_step = deploy_workflow.split(
            "- name: Verify active HKS catalogue manifest and exact row parity", 1
        )[1].split("- name: Build exact CI commit", 1)[0]
        self.assertIn("SUPABASE_ANON_KEY", catalogue_step)
        self.assertNotIn("SUPABASE_KEY", catalogue_step)

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
            "deploy.yml",
            "sync-live-courses.yml",
            "sync-myharvard-hks.yml",
        ):
            workflow = (WORKFLOWS / name).read_text(encoding="utf-8")
            self.assertIn(expected_install, workflow, name)
            self.assertNotIn("pip install requests", workflow, name)

        requirements = WORKFLOW_REQUIREMENTS.read_text(encoding="utf-8")
        self.assertIn("requests==", requirements)
        self.assertIn("--hash=sha256:", requirements)

    def test_restore_probe_is_confirmation_gated_and_never_targets_supabase(self):
        workflow = (WORKFLOWS / "verify-backup-restore.yml").read_text(encoding="utf-8")
        self.assertIn("if: ${{ inputs.confirm_restore }}", workflow)
        self.assertRegex(
            workflow,
            r"image: postgres:[^\s@]+@sha256:[0-9a-f]{64}",
        )
        for image in re.findall(r"^\s*image:\s*(\S+)", workflow, flags=re.MULTILINE):
            self.assertRegex(image, r"^[^@\s]+@sha256:[0-9a-f]{64}$")
        self.assertIn("restore_live_courses_probe.sql", workflow)
        self.assertIn("live-courses-restored.csv", workflow)
        self.assertIn("with (format csv)", workflow)
        self.assertNotIn("live-courses-restored.ndjson", workflow)
        restore_sql = (ROOT / "scripts" / "restore_live_courses_probe.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("jsonb_to_record", restore_sql)
        self.assertIn("sync_run_id uuid", restore_sql)
        self.assertIn("--minimum-rows 5000", workflow)
        self.assertIn("verify_live_courses_restore.py verify", workflow)
        self.assertIn("drop table if exists live_courses_restore_probe", workflow)
        self.assertNotIn("SUPABASE_URL", workflow)
        self.assertNotIn("SUPABASE_KEY", workflow)


if __name__ == "__main__":
    unittest.main()
