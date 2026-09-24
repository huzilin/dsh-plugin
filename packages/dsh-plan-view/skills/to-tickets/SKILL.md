---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, saved to `.plan/`.
disable-model-invocation: true
---

# To Tickets

**本 skill 是 plan 流程的环节之一（落地链第二环）。** 它的上游 / 下游 / 交接契约（输入必须是 spec 或待拍板文档、不得手搓票格式）与文档形态约定，见同仓 `skills/plan-protocol/SKILL.md`（公共协议层）。

Break a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path such as `.plan/<slug>/spec.md`, or any other document) as an argument, fetch it and read it in full.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. If a `CONTEXT.md` glossary exists at the repo root, ticket titles and descriptions should use its vocabulary; respect ADRs in `docs/adr/` in the area you're touching. If neither exists, proceed silently.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer the change touches (e.g. schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change — rename a column, retype a shared symbol — whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping the build green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket — green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Save the tickets

Write **one file per ticket**, under `.plan/<slug>/tickets/`, named `<NN>-<slug>.md` (numbered from 01 in dependency order, blockers first). `<slug>` is a short kebab-case name for the work — if the tickets came from a spec at `.plan/<slug>/spec.md`, use the same directory. Create the directories if needed; `.plan/` is committed to version control. Tell the user the paths.

Each file carries frontmatter the tracker reads, then the ticket's own body:

```markdown
---
type: task
blocked_by: []          # ticket ids that gate this one, or [] when none
status: open            # open（待领）→ claimed（执行中）→ done；推演图票（research/prototype/grilling）终态 resolved
---

# <NN>: <title>

**What to build:** <the end-to-end behaviour this ticket makes work>

**Blocked by:** <titles it depends on, or "None — can start immediately">

**Source spec:** <path to the spec this was cut from, if any>

## Acceptance

- [ ] <criterion>
- [ ] <criterion>
```

**Why one file per ticket, not one combined file.** A combined `tickets.md` looks tidier in a directory listing, but anything that reads tickets file-by-file counts it as **a single ticket** and silently loses every ticket inside it. That is not hypothetical — it is how a plan view shows "1 ticket" for a file holding nine. One file per ticket is the shape the wayfinder contract uses, so both readers agree.

**Also create `.plan/<slug>/map.md`** if the directory has none, so the effort is recognised as an effort rather than a loose folder:

```markdown
# <short name of the work> · 路线图

## Destination

<one or two lines: what reaching the end of this work looks like>

## Notes

- **Source spec**: <path>
- 工单形态：实施工单（`type: task`，frontmatter 存 `status`），非 wayfinder 推演地图。

## Decisions so far

<!-- one line per resolved ticket: gist + link -->
```

If the work came from an existing spec or plan document, reference it in each ticket's `Source spec:` line and in the map's Notes — do NOT modify or delete the source document.

Keep the ordering in mind when numbering: the frontier is any ticket whose blockers are all done. For a purely linear chain that means 01 runs first.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

Work the frontier one ticket at a time, each in a fresh session: implement the slice, run the project's static checks and tests, review the work (with the `review-code` skill if it's available in your environment), tick off the acceptance criteria in that ticket's own file, set its `status`, and commit — then clear context before taking the next ticket.
