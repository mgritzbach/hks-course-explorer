# Overnight Agent Loop

Drop this file into `~/.claude/skills/` (or your project's `.claude/skills/`).
Then trigger it with:  `/overnight-loop`  or  `/overnight-loop fix all the UX issues in my React app`

---

## What this does

1. Audits your project and writes a numbered task list to `ITERATION_LOG.md`
2. Sends batches of tasks to a Codex agent to implement
3. Sets a 30-minute wakeup alarm that fires back into this conversation
4. On each wakeup: reads the log, launches the next batch, reschedules itself
5. Stops when everything is marked `DONE`

Runs overnight. You wake up to a clean commit history and a completed log.

---

## Instructions

<skill>

When this skill is triggered, follow these steps in order. Never skip a step.

### STEP 1 — Understand the goal

Read the user's args. If they gave a specific goal (e.g. "fix all UX issues"),
use that. If no args, ask one question: "What should the overnight loop work on?"
Then proceed immediately — do not ask anything else.

### STEP 2 — Audit the project

Explore the codebase to understand its structure. Then produce a numbered list
of concrete, actionable tasks. Each task must have:

- **ID**: SC-1, SC-2, SC-3 ... (sequential)
- **Title**: one short line
- **Goal**: what done looks like (1–2 sentences, specific and testable)
- **Priority**: HIGH / MEDIUM / LOW

Aim for 8–20 tasks. Be specific — vague tasks like "improve performance" are
not allowed. Replace them with "reduce initial bundle size below 200KB by
code-splitting the Plotly import".

### STEP 3 — Write ITERATION_LOG.md

Write the full task list to `ITERATION_LOG.md` in the project root using this
exact format:

```
# Iteration Log
Generated: <date>
Goal: <user's goal>
Status: IN PROGRESS

---

## SC-1 · <Title>
**Priority**: HIGH
**Goal**: <what done looks like>
**Status**: PENDING

---

## SC-2 · <Title>
...
```

This file is the single source of truth. All agents read from it. Never rely
on conversation memory — always read the file fresh.

### STEP 4 — Launch the first Codex batch

Pick the top 4–6 PENDING tasks by priority. Launch a single Codex agent with
this prompt (fill in the bracketed parts):

```
You are working on [project name] at [absolute path to project root].

Your job: implement the following tasks from ITERATION_LOG.md.

Read ITERATION_LOG.md first to understand the full context and acceptance criteria.

Tasks to complete this round:
[paste the SC-N blocks for each task in this batch]

For each task:
1. Implement the fix
2. Verify it meets the Goal stated in the log
3. Update ITERATION_LOG.md: change `**Status**: PENDING` to `**Status**: DONE`
4. Commit with message "fix: SC-N · <title>"

Do all tasks, then stop. Do not start tasks outside this batch.
```

Use subagent_type: "codex:codex-rescue"

### STEP 5 — Schedule the 30-minute wakeup

Immediately after launching the Codex agent, call ScheduleWakeup with:
- delaySeconds: 1800
- reason: "overnight-loop heartbeat — checking SC progress"
- prompt: the exact string `<<overnight-loop-wakeup>>`

Then tell the user:
"✅ Loop started. [N] tasks queued. First Codex batch running now.
I'll check back in 30 minutes and keep going until everything is DONE.
You can close this and come back in the morning."

### STEP 6 — On each wakeup (when prompt is `<<overnight-loop-wakeup>>`)

When this skill fires and the args or prompt is `<<overnight-loop-wakeup>>`,
do the following:

1. Read `ITERATION_LOG.md`
2. Count DONE vs PENDING tasks
3. Report: "⏱ Heartbeat check: [N] done, [M] remaining"
4. If there are PENDING tasks:
   a. Pick the next 4–6 PENDING tasks by priority
   b. Launch a new Codex agent with the same prompt template as Step 4
   c. Call ScheduleWakeup again (delaySeconds: 1800, same prompt)
   d. Report: "Launched next batch: [SC-N, SC-N+1, ...]. Next check in 30 min."
5. If ALL tasks are DONE:
   a. Update ITERATION_LOG.md header: `Status: COMPLETE`
   b. Report a summary: list all completed SCs with one-line results
   c. Do NOT schedule another wakeup — the loop ends here
   d. Say: "🎉 All done! Check ITERATION_LOG.md and your git log for a full summary."

### Rules

- Always read ITERATION_LOG.md fresh — never trust conversation memory for task state
- Never mark a task DONE yourself — only Codex marks tasks DONE after implementing them
- Never batch more than 6 tasks per Codex run — quality drops above that
- If ITERATION_LOG.md doesn't exist when a wakeup fires, stop the loop and tell the user
- If a Codex run fails or a task stays PENDING for 2+ heartbeats, flag it to the user and skip it
- Never stop the loop early — keep going until every task is DONE or flagged

</skill>
