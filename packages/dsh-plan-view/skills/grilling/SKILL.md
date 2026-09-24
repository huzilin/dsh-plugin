---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## Every question is written down before it is asked

A round's questions do not live in the chat. **Before you ask, write them to an approval document** — one file holding the whole round — and then tell the user where it is. The chat message carries the path and a one-line summary, never the questions themselves.

The reason is not tidiness. The user does not always answer a whole round: they may need to ask you something first, or come back tomorrow. Questions that exist only in the chat scroll away and are silently lost — the round looks answered when it is not. A question that exists in a document cannot be lost: un-answered, it simply stays `pending`, and the user can find it again without re-reading the conversation.

Write the document the way the `to-approval` skill writes one — same four fields in the frontmatter (`type`/`date`/`status`/`origin`), same four things per item (**what it is**, **where it came from**, **what it affects**, **the options with their tradeoffs**), saved under `.plan/`. Use that skill's format rather than inventing a second one; if it is available, follow it directly. If a `to-approval`-shaped document already covers the round, update it instead of writing a new one.

Then, per round:

1. **Write the round's questions into the document** and set `status: pending`.
2. **Tell the user the path**, and what the document is about, in one line. Open it in the sidebar if you can.
3. **Wait.** They read the detail there, and may ask you things before answering.
4. **Record each ruling as it lands** — quote their words verbatim, mark the item settled with the date. The document is the record; a ruling that lives only in the chat is lost when the session ends.
5. **When every item in the document is settled**, set its status to `closed` (or `superseded-by:<path>` if a later decision replaced it). Never leave a document at `pending` once its items are gone — that is a lie the next session will believe.

The frontier still governs *which* questions you ask, and they are still numbered with your recommended answer. What changes is only where they are put: in the document, with the chat pointing at it.
