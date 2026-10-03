---
name: plan-approve
description: Settle the plan documents waiting on you — read every pending document under `.plan/`, re-verify each item is still genuinely undecided, then record your rulings and advance each document's status.
disable-model-invocation: true
---

**本 skill 是 plan 流程的环节之一。** 它的位置、上游（to-approval）、下游（无——落票等下游动作由各域原生载体驱动：spec 归 to-spec 流、票归票文件与 plan-loop「定案未拆票」行动行；整轮归档归 plan-archive）、交接契约与文档形态约定，见 `plan-protocol` skill（公共协议层，先读那份再读本文件的 how）。

You have decisions waiting. They are scattered across the `.plan/` documents that carry `status: pending`, some written days ago, some overtaken by later work, some still live. Reading them one at a time to find out which is which is the work this skill removes.

**The first job is not to ask — it is to check.** Several `pending` documents are usually lying: their items were decided, superseded, or fixed in a later session, and nobody turned the status. Asking about those wastes the very attention the document was written to protect. So verify first, ask only about what survives.

## Process

1. **Run the drift lint first.** The lint script ships inside this skill: `bash <this skill's directory>/scripts/plan-lint.sh <repo>/.plan` (resolve the directory from where you loaded this SKILL.md). It read-only reports the structural problems that make this pass unreliable: a ticket id with more than one home, an effort holding `tickets/` with no `map.md` (so the plan view silently skips it), and status-header violations. Fix or report what it finds before reading items — a document that is not in the set you collected cannot be settled, and that is exactly the drift this skill exists to catch. If the script is missing, the skill install itself is broken — report that drift, do not silently degrade to a manual check. If the repo also keeps a machine-readable terms list (its terminology SOP names the path — novel: `tools/terms.txt`), pass `--terms <path>`: check [7] then asserts zero unmarked term residue across the whole live tree and warns on glossary words that hit nothing anywhere (a typo in the list would otherwise be silent green). Never wrap that output in `rtk` — its compression has been proven to distort counts.

2. **Collect the pending set.** Find every markdown document under `.plan/` whose **body** carries `**Status:** pending` (frontmatter `status: pending` is the legacy carrier — still read, since存量 may not be migrated). Also check the repo's own in-flight ledger (a plan or roadmap document listing open questions) — an item can be live there without a document of its own.

3. **Re-verify each item, one at a time.** For every item in every pending document, go and look for its answer. Search the conversation, the git log, the closed and archived documents, and the code itself. Sort each item into exactly one verdict:

   - **decided** — an answer exists somewhere. Record where.
   - **superseded** — a later decision replaced it; the question no longer applies.
   - **stale** — the condition that raised it is gone (the feature retired, the file deleted).
   - **live** — still genuinely open, and still yours to rule on.

   A verdict of *decided*, *superseded*, or *stale* is a **finding**, and findings are the point: each one is a status that should have been turned and was not. Do not ask about these.

4. **Report the findings before the questions.** The human needs to know that three documents were lying before deciding whether to trust the fourth. State plainly which items were already settled and what settled them.

5. **Put the live items to the human — in documents, not in chat.**

   **The chat message is not where an item gets explained.** A numbered list of items in chat forces the human to decide from the agent's summary, which is exactly the illegibility that `to-approval` exists to remove. The four things belong in a document they can read:

   - **What it is** — plain language, no bare ticket ids.
   - **Where it came from** — the context, and which document raised it.
   - **What it affects** — what changes depending on the answer.
   - **The options, with tradeoffs** — each with its cost, one marked as the recommendation with the reason.

   An item missing any of the four is not ready to ask. So:

   - **An item already has a document** (the pending document that raised it) → make sure all four are in *that* document, then open it. Do not restate it in chat.
   - **An item has no document** (it surfaced from code, a ledger, or a passing finding) → **hand it to `to-approval`** and let that skill write the document. Then open it. Do not expand it inline here.

   **Then the chat message says only three things**: which documents now hold live items, one line each on what they are about, and a closing note that the rulings can come back in any form. No option tables, no item-by-item detail — the documents carry that.

   Batching still applies: get all live items into documents in one pass so they can be answered together, in one reply. What changes is *where* they are put, not how many round-trips it takes.

6. **Record each ruling as it lands.** For every item the human rules on, and for every finding from step 3, write the outcome into the document that raised it:

   - Quote the human's words verbatim — never paraphrase a ruling. Their phrasing carries the constraint.
   - Mark the item settled, with the date and what settled it.
   - **When the ruling calls for work in a long-lived home, record it in the per-item disposition record — there is no stateful checklist**（清单回填不做；域写入归 grill 会话 inline）. **If every conclusion is already absorbed in-conversation**（词汇/ADR 已 inline 写就、无 spec/票 项）**→ flip the archive mark right at settlement**: `archived: absorbed→CONTEXT.md#词条 ／ ADR-NNNN`. If a spec is to follow, do **not** flip — the to-spec pass flips it on completion（`archived: <spec 落点>`）. Tickets are tracked by the ticket files themselves — cut later by the plan-loop「决策已定案但工单未拆」action row or an implement session, **always through `to-tickets`**（格式独占不变：one file per ticket, frontmatter `type` ＋ 正文 `**Status:**` / `**Blocked by:**`, never a hand-written or combined file）— never by this document. **Never load or invoke `to-tickets` from within this skill's run — not even when some items are already ruled**. 部分裁定不构成落票触发：只要档内还有未决项（grill 进行中／待原型走查／待补充拍板），文档保持 `pending`，立票永远后置——plan-loop 行动行或实施会话在档翻 `closed` 后按清单项显式触发。
   - A `closed` document carries no pending-work state of its own: unmarked + stale is lint's reminder business（closed 无标超阈值 → warn），not a checklist this document maintains.
   - **If the ruling changes an architectural fact, route the change through the target effort's spec (spec＝归档前唯一变更入口).** When a ruling settles a bug, gap, or design question whose answer alters the system's layering, domain boundaries, state machines, contracts, or dependency edges — and the target effort is still open with a live spec — correct that spec's relevant section (or append a continuation section), then apply it to the long-lived authority（arch／领域文档）in the same pass and tick the spec's disposition checklist（销号清单）. Do **not** edit the charter or domain doc directly while a live spec exists — the spec is the single change entry, and its per-section checklist is what keeps the sweep from being drafted from memory. Only when the effort is already archived, or no live spec exists, does this pass edit the charter directly. Do not duplicate the ruling into the charter; update the facts and keep its document map pointing at the approval document that decided it. If the ruling changes no architectural fact, skip this step.
     - **销号的适用条件：存在对应 effort 的 live spec 才有销号流程。** 处于 grill 中——拍板尚未定案、没有对应的 effort spec（词汇/ADR 类结论、wayfinder 图内拍板）——**整段销号流程不存在**：结论按上面的 absorbed-in-conversation 路径 inline 落盘（CONTEXT 词条／ADR），不虚构清单、不触碰任何 spec、不销任何号；有架构事实变更且无 live spec 时走「直改正本」，同样无销号环节。

   A ruling written only in chat is lost the moment the session ends.

7. **Advance each document's status.** After its items are all resolved, set the **body** `**Status:**` line:

   - `closed` — every item decided; downstream work（spec / tickets）is tracked by its own artifacts — spec by the to-spec pass, tickets by ticket files.
   - `superseded-by:<path>` — a later decision replaced the document's content; name the replacement.
   - `abandoned` — no longer relevant, nothing replaced it.

   Then add the stale-marker to any section whose items are gone: what replaced it, when, and what the document is still good for. Never leave a document at `pending` once its items are settled — that is precisely the lie this skill exists to catch.

8. **Leave settled documents in place — file movement belongs to the round archive.** Do not `git mv` closed documents out of `.plan/` here. Every document is a member of the round that raised it (the grill / wayfinder / problem-report → impl chain), and moving one file alone breaks that round's directory integrity. When the round completes, `plan-archive` moves the whole round into `.archive/rounds/<round-id>/` in one piece. This step advances statuses (step 7) and moves nothing — so no path sweep is needed here either.

9. **Open anything the human must read now.** A document that needs a ruling, or that records one, goes to the sidebar. A path alone makes them go fetch it.

10. **Re-run the lint before closing.** Run the same script from step 1 once more, after the last status write. A settling pass that ends red introduced drift while writing — fix it in the same pass (the 形态契约变更回扫 clause in plan-protocol §三 makes this the contract, not a courtesy), then report. Exit green or say plainly why you did not.

## Completion criterion

Every `pending` document under `.plan/` is either settled and status-advanced, or **has its live items written up in a document the human can read** (not left as a chat list). Zero documents left at `pending` with no live item behind them, and zero live items that exist only in the chat message.

## Why the verification pass is not optional

A status field is a claim, and nothing enforces it. Documents get written in a hurry, items get decided in a later conversation, and the header keeps asserting there is work waiting. Left alone, the set of `pending` documents only grows, and the human learns to distrust the marker — at which point the tracking scheme has failed and everyone is back to reading everything.

Verifying on every run is what keeps the marker worth reading. The findings are not a side effect of this skill; on a healthy repo they are most of its output.

## What this is not

Not a document generator — that is `to-approval`, which writes the document for a decision that has not been written down yet. This skill works the set that already exists: settles it and advances its status — **and calls on `to-approval` for any live item that has no document of its own**. The division is clean: `to-approval` writes documents, this skill settles them, and neither one explains decisions in chat. Files move once, at the round archive, by `plan-archive`.
