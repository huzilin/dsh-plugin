---
name: implement-spec
description: "Implement a specification in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is a PR which implements the entire spec on a single branch.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for **maximum concurrency**.

## Steps

1. Read the spec and tickets. Read enough to understand the task graph.

2. **(required) Check the spec is live before implementing it.** A spec (under `.scratch/<slug>/spec.md` — the only legal effort location) is a **one-shot document** — it is voided once its effort closes. Implementing a spec that has already been superseded or archived means building the *old* decision, which is the single most expensive failure this flow has. Before any implementation work:

   - **Look for a supersession notice**: a `superseded-by:` field or an equivalently worded statement in the spec, or in a doc that points at it.
   - **Check whether it is already archived** (e.g. under `.archive/`).
   - **If either holds**: stop and read the current long-lived authority first — the architecture charter, the domain doc, or the requirements doc that the spec's disposition lines point to. Record on the ticket: **`已核新正本：<path>`**.
   - **If the spec is live**: say so and proceed. Do not skip this silently — a stated check is what makes the next reader able to trust the ticket.

   This is a **transition-period guardrail**: until every spec is discharged into its long-lived homes on finalization, historical specs remain readable and therefore remain a hazard.

3. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

4. Create a branch, and a draft PR. The PR should be marked as 'closing' the spec issue and tickets.

5. Use **implementer subagents** to implement each ticket. Each implementer subagent should work in its own worktree, on its own branch.

6. Once an **implementer subagent** completes, merge its work to the PR branch with a **merger subagent**. **Then update that ticket's file in the same step** — a merged ticket whose file still says `open` is indistinguishable from work that was never started:

   - set its `status` to `done`
   - tick the acceptance boxes the merge demonstrably satisfies, leaving unticked any box not actually demonstrated
   - append a one-line landing note naming the merge commit and anything still open

   Do this per ticket as it merges, not in a batch at the end: the batch is the step that gets skipped when the session runs long, and a ticket left unturned is read as work still waiting.

7. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

8. Once all tickets are complete, run /code-review on the PR branch. Fix all issues raised by the code review in a single **implementer subagent**. If the fixes change what any ticket claims, correct that ticket too.

9. Mark the PR as ready for review.

10. Clean up all **implementer subagent** worktrees. Before finishing, confirm every ticket's file reflects what happened — no ticket left `open` whose work is in the PR, and no acceptance box ticked on evidence you cannot point at. Then close the pass with plan-lint: run `bash <this skill's directory>/scripts/plan-lint.sh <repo>/.scratch <repo>/.plan` (pass whichever of the two exists; injected into this skill at install time from the plan skill family) — zero findings, or fix what it finds before reporting done.

## When this flow does not fit

This skill assumes **one spec, one branch, one PR**. That holds for a code feature. It does not hold when the sync's deliverables are **documents and skill text rather than code**, or when the work **spans more than one repo** — then a single PR cannot contain it, and per-ticket worktrees buy nothing.

In that case, degrade deliberately rather than force the shape: commit per ticket on the current branch, keep the ticket-file update and the plan-lint close (steps 6 and 10) intact, and say plainly in the report which steps were skipped and why. **Report the degradation; never silently pretend the PR steps happened.**
