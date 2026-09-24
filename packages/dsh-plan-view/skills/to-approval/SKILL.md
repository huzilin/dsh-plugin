---
name: to-approval
description: Expand a decision the agent stated too tersely to act on — a bare ticket id like W1, a jargon term, a one-line recommendation — into a readable approval document the human can decide from, saved to `.plan/` with a status header.
disable-model-invocation: true
---

**本 skill 是 plan 流程的环节之一。** 它的位置、下游（plan-approve）、交接契约与文档形态约定，见同仓 `skills/plan-protocol/SKILL.md`（公共协议层，先读那份再读本文件的 how）。

The agent said something like "W1 needs your call" or "confirm option B" — accurate, and unusable. The human cannot decide from it: the id means nothing to them, the context lives only in the agent's head, and the tradeoff was never written down. So they ask for it expanded, and an approval document is born.

That birth is the problem this skill solves. An approval document written ad hoc carries no header, so nothing tracks whether it is still waiting, already decided, or overtaken by a later decision — it becomes an orphan the next session reads as live. **The header is not bookkeeping added at the end; it is part of what makes the document a document.**

## Process

1. **Confirm the decision is real.** An approval document exists to put one or more decisions to the human. If nothing is actually undecided — the agent already knew the answer, or the choice was made earlier — say so and stop. Do not manufacture a document to look thorough.

2. **Inventory what is being decided.** List every item the human must rule on. One item is fine. If the agent's original message named them by id, recover the real names now: search the code, the plan documents, and the conversation for what `W1` actually is.

3. **Quote the human's own words.** For each item, copy the request that produced it — verbatim, not paraphrased. The human's phrasing carries their intent and their constraints, and rewriting it loses both. This is also the record of *why the document exists*.

4. **Write each item so it can be decided from the page alone.** Every item carries four things, and an item missing any of them is not finished:

   - **What it is** — the thing in plain language, no ids standing in for names.
   - **Where it came from** — the context: what was being discussed, what earlier decision or constraint produced it.
   - **What it affects** — what changes downstream depending on the answer.
   - **The options, with their tradeoffs** — two or more real choices, each with its cost stated. Mark a recommendation and say why.

5. **Label the nature of every claim.** Mark each significant statement as one of: already written in a document, a gap the documents leave open, or the agent's own inference. Never blend them into one table — a reader who cannot tell a quoted rule from a guess cannot weigh it.

6. **Write the header, before the body.** Frontmatter, exactly these fields:

   ```yaml
   ---
   type: approval
   date: YYYY-MM-DD
   status: pending
   origin: readability-rescue
   ---
   ```

   `origin` records what produced the document. Use `readability-rescue` when the human asked for something expanded, as here; `proactive` when the agent raised the decision unprompted; `review` or `retrospective` when it grew out of one of those. The field exists so the rescue rate is countable — a rising count is evidence that reporting upstream needs fixing, not that documents need writing faster.

7. **Save where the subject lives: `.plan/<effort>/待拍板-<slug>-<YYYY-MM-DD>.md` by default.** `<slug>` names the subject in kebab-case, not the ticket id — an in-map file named for its subject (e.g. `.plan/auth-flow/待拍板-token-refresh-设计取舍-2026-01-01.md`), not `.plan/W1.md`. Only **global** approvals (cross-map scope or no owning map) go to the `.plan/` root: `.plan/待拍板-<slug>-<YYYY-MM-DD>.md`. The plan view scopes an in-map approval to that map's 待拍板 tab only. Respect an existing naming convention in `.plan/` over these defaults. `.plan/` is committed to version control; it is the project's shared planning memory. Create the directory if needed and tell the human the path.

8. **Open it in the sidebar.** The document exists to be read now; a path alone makes the human go fetch it.

## Completion criterion

Every decision item is answerable from the document alone by someone who has not seen the conversation — and the header is present, with `status` reflecting the truth. If an item still needs the conversation to make sense, it is not done.

## The header, and keeping it honest

The header is what makes an approval document findable and trackable later. Five states cover what happens to one:

| `status` | Means |
|:--|:--|
| `pending` | Genuinely still waiting on the human. |
| `closed` | Every item decided, and each one either done or filed as a ticket. |
| `superseded-by:<path>` | A later decision replaced this document's content. Name the replacement. |
| `active` | Not a decision document — a spec, map, or plan still in use. |
| `abandoned` | No longer relevant; nothing replaced it. |

**A ruling that calls for work becomes a ticket, right then.** The `closed` row above says "either done or filed as a ticket" — that clause is an action, not a label. When the human's ruling is *"do X"*, the ruling is not recorded until the ticket exists:

1. **Invoke the `to-tickets` skill** with the ruling as its input. Do not hand-write the ticket file, and do not paraphrase the ruling into a bullet in this document and call it filed. Either shortcut produces a ticket shaped by whatever the current session felt like — which is how a repo ends up with four incompatible ticket formats and a view that can read none of them.
2. **Write to the shape the tracker reads**, which is **one file per ticket**, not one file holding many:

   ```
   .plan/<effort>/tickets/<id>-<slug>.md     ← one ticket, read as one row
   .plan/<effort>/tickets.md                 ← WRONG: many tickets in one file
   ```

   `to-tickets` writes `<slug>/tickets.md` by default (a single file with one `##` section per ticket). **Override that here.** A view that reads tickets file-by-file sees a combined file as exactly one ticket and silently loses every ticket inside it — the same failure as a table row read as one row. Split the approved tickets into one file each, named `<id>-<slug>.md`, under `tickets/`.

   Each file carries frontmatter the tracker reads directly:

   ```yaml
   ---
   type: task
   blocked_by: []
   status: open            # open（待领）→ claimed（执行中，附 claimed_by/session）→ done；推演图票终态 resolved
   ---

   # <id>: <title>

   **What to build:** <the end-to-end behaviour this ticket makes work>
   **Blocked by:** <titles it depends on, or 无>
   **真相源:** <the document that decided it — usually this approval document>
   ```

3. **Name the ticket in the record** and link it, with the ruling quoted verbatim beside it.

If no ruling calls for work — every item was a question of fact, or a choice among existing options — there is nothing to file and this step is skipped. The rule is only that *when* work is called for, the ticket comes from the skill that owns ticket format rather than being invented here.

**Never leave a document at `pending` when its items are gone.** A document whose decisions were all overtaken, still reading `pending`, tells the next session there is work waiting that does not exist. When a later decision supersedes a document, update it in the same pass — set `superseded-by:<path>` and mark the affected section in the body with three things: what replaced it, when, and what the document is still good for.

The same rule covers the body. A section whose items have all been decided gets a stale-marker at its head pointing at the live document, rather than being silently left to read as current.

## What this is not

Not a summary of the conversation — a summary has no decisions in it. Not a design document — designs argue for an approach; this puts a choice to someone. If the human asked you to expand something and there is nothing to decide, the honest answer is a shorter message, not a longer document.
