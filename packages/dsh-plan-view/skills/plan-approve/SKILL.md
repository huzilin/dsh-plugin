---
name: plan-approve
description: Settle the plan documents waiting on you — read every pending document under `.plan/`, re-verify each item is still genuinely undecided, then record your rulings and advance each document's status.
disable-model-invocation: true
---

You have decisions waiting. They are scattered across the `.plan/` documents that carry `status: pending`, some written days ago, some overtaken by later work, some still live. Reading them one at a time to find out which is which is the work this skill removes.

**The first job is not to ask — it is to check.** Several `pending` documents are usually lying: their items were decided, superseded, or fixed in a later session, and nobody turned the status. Asking about those wastes the very attention the document was written to protect. So verify first, ask only about what survives.

## Process

1. **Collect the pending set.** Find every markdown document under `.plan/` whose frontmatter says `status: pending`. Also check the repo's own in-flight ledger (a plan or roadmap document listing open questions) — an item can be live there without a document of its own.

2. **Re-verify each item, one at a time.** For every item in every pending document, go and look for its answer. Search the conversation, the git log, the closed and archived documents, and the code itself. Sort each item into exactly one verdict:

   - **decided** — an answer exists somewhere. Record where.
   - **superseded** — a later decision replaced it; the question no longer applies.
   - **stale** — the condition that raised it is gone (the feature retired, the file deleted).
   - **live** — still genuinely open, and still yours to rule on.

   A verdict of *decided*, *superseded*, or *stale* is a **finding**, and findings are the point: each one is a status that should have been turned and was not. Do not ask about these.

3. **Report the findings before the questions.** The human needs to know that three documents were lying before deciding whether to trust the fourth. State plainly which items were already settled and what settled them.

4. **Put the live items to the human — in documents, not in chat.**

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

5. **Record each ruling as it lands.** For every item the human rules on, and for every finding from step 2, write the outcome into the document that raised it:

   - Quote the human's words verbatim — never paraphrase a ruling. Their phrasing carries the constraint.
   - Mark the item settled, with the date and what settled it.
   - Open the ticket or file the follow-up work if the ruling calls for it, and name that ticket in the record.

   A ruling written only in chat is lost the moment the session ends.

6. **Advance each document's status.** After its items are all resolved, set the frontmatter:

   - `closed` — every item decided, and each either done or filed as a ticket.
   - `superseded-by:<path>` — a later decision replaced the document's content; name the replacement.
   - `abandoned` — no longer relevant, nothing replaced it.

   Then add the stale-marker to any section whose items are gone: what replaced it, when, and what the document is still good for. Never leave a document at `pending` once its items are settled — that is precisely the lie this skill exists to catch.

7. **Archive what is finished, and sweep the paths.** Move `closed` documents to the repo's archive directory with `git mv`, preserving history. Archiving moves files, so anything that referenced them by path is now broken — grep the live documents for each archived filename and repoint the references, then confirm zero remain. Report the count.

8. **Open anything the human must read now.** A document that needs a ruling, or that records one, goes to the sidebar. A path alone makes them go fetch it.

## Completion criterion

Every `pending` document under `.plan/` is either settled and status-advanced, or **has its live items written up in a document the human can read** (not left as a chat list). Zero documents left at `pending` with no live item behind them, and zero live items that exist only in the chat message.

## Why the verification pass is not optional

A status field is a claim, and nothing enforces it. Documents get written in a hurry, items get decided in a later conversation, and the header keeps asserting there is work waiting. Left alone, the set of `pending` documents only grows, and the human learns to distrust the marker — at which point the tracking scheme has failed and everyone is back to reading everything.

Verifying on every run is what keeps the marker worth reading. The findings are not a side effect of this skill; on a healthy repo they are most of its output.

## What this is not

Not a document generator — that is `to-approval`, which writes the document for a decision that has not been written down yet. This skill works the set that already exists: settles it, advances it, and archives it — **and calls on `to-approval` for any live item that has no document of its own**. The division is clean: `to-approval` writes documents, this skill settles them, and neither one explains decisions in chat.
