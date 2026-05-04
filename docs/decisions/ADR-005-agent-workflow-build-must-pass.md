# ADR-005: Agent workflow — build must pass before every commit

## Status
Accepted

## Context
Code-generation agents (Codex and others) can produce syntactically broken output, such as mangled string literals, undefined variable references, or other syntax errors. These pass a grep or diff review but fail at compile time. Several broken deploys occurred in succession due to pushing without a local build check.

## Decision
`npm run build` must pass locally before any commit. This is enforced by the Husky pre-commit hook. The agent workflow is:
1. Plan (decide what needs to happen)
2. Build (delegate to agent, review the diff)
3. CI check (verify output passes linting/type checks)
4. Review diff (visual inspection of changes)
5. Browser verify (manual testing in browser)
6. Stage (git add)
7. Monitor (watch for issues on deploy)

## Consequences
- Commits take 30–60 seconds longer due to the build step
- A broken build blocks the commit entirely — you must fix the broken code before pushing
- Never use `git commit --no-verify` to skip the pre-commit hook
- Agents must be given explicit instructions to run the build before delegating code changes
