---
name: to-approval
description: Expand a decision the agent stated too tersely to act on — a bare ticket id like W1, a jargon term, a one-line recommendation — into a readable approval document the human can decide from, saved to `.plan/` with a status header.
disable-model-invocation: true
---

**本 skill 是 plan 流程的环节之一。** 它的位置、下游（plan-approve）、交接契约与文档形态约定，见 `plan-protocol` skill（公共协议层，先读那份再读本文件的 how）。

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

7. **Save where the subject lives: approvals generated inside an effort go INTO that effort — `.scratch/<effort-slug>/approval/待拍板-<slug>-<YYYY-MM-DD>.md`**（2026-09-29 拍板：grill-with-doc / wayfinder 生成的审批档入 effort 的独立 `approval/` 目录——随图归组展示、随 effort 归档）. `<slug>` names the subject in kebab-case, not the ticket id (never `.plan/W1.md` style). Only **global** approvals (cross-effort scope or no owning effort, e.g. governance rulings) go to `.plan/approval/`: `.plan/approval/待拍板-<slug>-<YYYY-MM-DD>.md` (2026-09-30 收拢拍板: global approvals moved from the `.plan/` root into a dedicated `approval/` subdir, same shape as the in-effort one). The plan view scopes an in-effort approval to that map's 待拍板 tab. Old-layout `.plan/<effort>/待拍板-*.md` files were migrated to the `.plan/` root (2026-09-29) and again into `.plan/approval/` (2026-09-30) — never write at either. `.plan/` / `.scratch/` are committed to version control; they are the project's shared planning memory. Create the directory if needed and tell the human the path.

8. **Open it in the sidebar.** The document exists to be read now; a path alone makes the human go fetch it.

## Completion criterion

Every decision item is answerable from the document alone by someone who has not seen the conversation — and the header is present, with `status` reflecting the truth. If an item still needs the conversation to make sense, it is not done.

## The header, and keeping it honest

The header is what makes an approval document findable and trackable later. Five states cover what happens to one:

| `status` | Means |
|:--|:--|
| `pending` | Genuinely still waiting on the human. |
| `closed` | Every item decided; downstream work（spec / tickets）is tracked by its own artifacts — spec by the to-spec pass, tickets by ticket files. |
| `superseded-by:<path>` | A later decision replaced this document's content. Name the replacement. |
| `active` | Not a decision document — a spec, map, or plan still in use. |
| `abandoned` | No longer relevant; nothing replaced it. |

**A ruling that calls for work is recorded in the per-item disposition record, right then — not ticketed, and not tracked by any checklist**（2026-09-29 拍板：清单回填不做；域写入归 grill 会话 inline）. When the human's ruling is *"do X"*, the ruling record names what it settles into; domain writing happens inline in the same conversation（词汇/ADR），and tickets are cut later by the plan-loop「决策已定案但工单未拆」action row or an implement session — **always through the `to-tickets` skill**（格式独占：one file per ticket at `.scratch/<effort>/issues/<id>-<slug>.md`, frontmatter `type` / `blocked_by` / `status`; never a hand-written or combined `issues.md` — shape and vocabulary owned by plan-protocol and `to-tickets`）. **The archive mark has two flip points**: ① **at settlement**, when every conclusion is already absorbed in-conversation（词汇/ADR inline 写就、无 spec/票 项）→ `archived: absorbed→CONTEXT.md#词条 ／ ADR-NNNN`; ② **at to-spec completion**, when a spec follows → the to-spec pass writes `archived: <spec 落点>`. Unmarked approvals are not linted at all（2026-09-29 拍板「这个就不通知了」）；漏 to-spec 的提醒归 plan-loop Brief。

**Never leave a document at `pending` when its items are gone.** A document whose decisions were all overtaken, still reading `pending`, tells the next session there is work waiting that does not exist. When a later decision supersedes a document, update it in the same pass — set `superseded-by:<path>` and mark the affected section in the body with three things: what replaced it, when, and what the document is still good for.

The same rule covers the body. A section whose items have all been decided gets a stale-marker at its head pointing at the live document, rather than being silently left to read as current.

## What this is not

Not a summary of the conversation — a summary has no decisions in it. Not a design document — designs argue for an approach; this puts a choice to someone. If the human asked you to expand something and there is nothing to decide, the honest answer is a shorter message, not a longer document.
