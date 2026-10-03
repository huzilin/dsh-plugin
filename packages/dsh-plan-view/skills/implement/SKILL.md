---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

**Before implementing from a spec, check that the spec is still live.** A spec (under `.scratch/<slug>/spec.md` — the only legal effort location) is a one-shot document — it is voided once its effort closes. Look for a supersession notice (`superseded-by:`, or an equivalently worded statement) and check whether it has already been archived. If either holds, read the current long-lived authority first (the architecture charter, the domain doc, or the requirements doc the spec's disposition lines point to), record `已核新正本：<path>` on the ticket, and only then start. Building a superseded decision is the most expensive failure this flow has, and the old spec still reads as authoritative right up until someone checks.

**If the ticket or spec mounts a prototype, open it before writing code（2026-10-04 票 23 契约）.** A mount line（`对照原型:` / `原型：prototype/<name>.html#variant=<k>`）marks the prototype as the **shape-of-record** for that slice: read the winning variant（在浏览器打开——自包含单文件 html，`#variant=` 键选变体）so the implementation matches the decided layout/interaction, not a guess from prose. When the implementation must diverge from the prototype, the spec's decision text wins（原型是形态参照不是契约本体）——note the divergence on the ticket.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

**Update the ticket when the work lands.** If this work came from a ticket under `.scratch/` (the only legal effort location), the ticket is not finished until its file says so — do this in the same pass as the commit, never "later", because later is a session that never comes:

- set its `**Status:**` line to `resolved`
- tick the acceptance boxes the work satisfies, leaving unticked any box you did not actually demonstrate
- append a one-line landing note naming the commit and anything still open

An unticked box left behind is not neutral: the next reader cannot tell "not verified" from "not done", and the plan view shows the ticket as work still waiting.

Commit your work to the current branch.

**Close the pass with plan-lint.** If this work touched anything under `.plan/`, run `bash <this skill's directory>/scripts/plan-lint.sh <repo>/.plan` before ending (the script is injected into this skill at install time from the plan skill family). Zero findings, or fix what it finds in the same pass — the plan view and the next session read only what lint-valid documents say.
