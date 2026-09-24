---
name: plan-sync
description: Reconcile `.plan/` tickets with what actually shipped — read every ticket, judge from git and the code whether it is really done, then write back the status, the acceptance ticks, and a landing note. Use when a ticket's state is suspected stale, or before closing a batch out.
disable-model-invocation: true
---

**本 skill 是 plan 流程的环节之一（落地链收尾对账）。** 它在流程中的位置、回写两时机的约定、与 implement* 的分工，见 `plan-protocol` skill（公共协议层）。

A ticket's `status` is a claim, and nothing enforces it. Work gets finished in a session that never went back to turn the field; other work gets marked done and the acceptance boxes stay empty. The ticket file then tells the next session something untrue — either "still to do" about finished work, or "finished" with no evidence for it.

This skill closes that loop. It is the fourth step of the lifecycle the plan view documents: `to-spec` writes the requirement, `to-tickets` splits it, the implementation skills build it — and this one reconciles what was built with what the tickets claim.

**Judge from evidence, not from the field.** The `status` value is what you are checking, so it cannot be your input. For every ticket, ask what would have to exist for this to be true, then go look for it.

## Process

1. **Run the drift lint first.** The lint script ships inside the `plan-approve` skill's package and is injected here at install time: `bash <this skill's directory>/scripts/plan-lint.sh <repo>/.plan` (resolve the directory from where you loaded this SKILL.md, e.g. `~/.zcode/skills/mp-plan-sync/scripts/plan-lint.sh`). It catches the structural problems that make reconciliation unreliable: a ticket id with more than one home, an effort holding `tickets/` with no `map.md`, status-header violations. Fix or report those before reading tickets — a ticket that cannot be found cannot be reconciled. If the script is missing, the skill install itself is broken — report that drift, do not silently degrade to a manual check.

2. **Collect the open tickets.** Every ticket file under `.plan/` that is *not* already `done`/`closed`, plus any marked done whose acceptance boxes are still empty. The second group matters as much as the first: "done with nothing ticked" is the common shape of work that shipped but was never recorded, and it is exactly what this skill exists to fix.

3. **Verify each ticket against reality, one at a time.** The ticket states what it delivers; find out whether that exists. Sources, strongest first:

   - **The code.** Does the thing the ticket describes exist — the route, the table, the migration, the component, the test? Name the file and what you saw.
   - **The git log.** Search for the ticket's id or subject. A commit that names the ticket and describes landing it is strong evidence; a merge into the main line is stronger.
   - **The ticket's own acceptance boxes.** A ticked box is the author's claim — evidence only when it matches one of the above, never on its own.
   - **Cross-references.** Other tickets, handoffs, or ledgers that record it landing.

   Reach one verdict per ticket:

   - **done** — the deliverable exists. Cite what you found.
   - **partial** — some of it exists. Name what is missing; `status` stays open and the gap goes in the note.
   - **not-started** — nothing exists. Leave it open.
   - **stale** — the work no longer applies (feature withdrawn, superseded by a later decision). Say what replaced it; this is a finding about the plan, not about the code.

4. **Report before writing.** State the counts and list what will change and why: which tickets flip to done, which keep their status despite the claim, which look like abandoned work. **A ticket you are about to close on weak evidence is the one thing this pass must not do** — if the deliverable cannot be pointed at, leave the ticket open and say what is missing. Approval is cheap here; a wrongly closed ticket is not, because nobody re-opens what reads as finished.

5. **Write back, per ticket.** Three edits, all in the ticket's own file:

   - Set `status` — `done` when the deliverable exists, `closed` when the ticket is also filed away.
   - **Tick the acceptance boxes that the evidence supports.** Tick only those; a box you cannot substantiate stays empty, and the box that stays empty is the honest record of what was claimed but not shown.
   - **Append a one-line landing note** naming the commit or merge and anything still open, in the ticket's own language. The note is what a later reader trusts when the status looks surprising.

6. **Re-run the lint before committing.** Same script as step 1, after the last ticket write-back. A reconciliation pass that ends red introduced drift while writing — fix it in the same pass, then commit.

7. **Commit the batch.** One commit for the reconciliation, listing the tickets touched and the direction each moved. Do not mix it with other work — the whole point is that this change is auditable on its own.

8. **Report what you could not settle.** Tickets left open despite looking finished are the useful output: they name work whose evidence is missing, which is either a real gap or a ticket too vaguely written to verify. Both are worth the human's attention.

## What this is not

Not a status flip on the human's word — that is `plan-approve`'s ruling path, where a decision settles a document. This skill settles nothing by decision; it compares a claim against the repository and records the difference. If a ticket is genuinely unfinished, the correct output is that it stays open.

Not a ticket writer. Tickets come from `to-tickets`, decisions from `to-approval`; this one only brings existing tickets back in line with what happened.
