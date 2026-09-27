---
name: to-spec
description: Turn the current conversation into a spec, saved to `.plan/` — no interview, just synthesis of what you've already discussed.
disable-model-invocation: true
---

This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD). Do NOT interview the user — just synthesize what you already know.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. If a `CONTEXT.md` glossary exists at the repo root, use its vocabulary throughout the spec; respect any ADRs in `docs/adr/` in the area you're touching. If neither exists, proceed silently.

   **Read the architecture charter first (if one exists).** Many repos keep a single architecture source of truth — e.g. a repo-root `docs/architecture.md` (self-declared "全局架构唯一正本"). Before writing a spec, read it so the new work slots onto the real layering, domain boundaries, state machines, and contract boundaries rather than re-deciding settled facts. Respect its document map (usually a "文档地图" section) as the pointer layer — do not duplicate what it already states; reference it.

2. Sketch out the seams at which you're going to test the feature — the public interfaces where behaviour can be observed without reaching inside. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using the template below, then save it to `.plan/<slug>/spec.md`, where `<slug>` is a short kebab-case name for the work (reuse the directory if one already exists for this effort). Create the directory if needed — `.plan/` is committed to version control; it is the project's shared planning memory. Tell the user the path.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>

## After writing: keep the architecture charter current

The spec is one layer down from the architecture charter. If the repo keeps a single architecture source of truth (`docs/architecture.md`, self-declared "全局架构唯一正本"), update it after the spec lands:

- **Do not duplicate** the spec's detail into the charter. The charter states *what the architecture is now*; the spec states *what this piece will do*.
- **Extend or correct** the charter's facts if the spec introduces new layering, a new domain, a state-machine change, a new contract, or a changed dependency edge. Keep its document map (e.g. "§12 文档地图") pointing at the spec you just wrote and at any other new documents — the map is a pointer layer, and a broken pointer there is how decisions get lost.
- **Leave a pointer, not a copy.** Add or update the one line that references this effort; the charter must stay the single source of truth, not a second spec.
- If the spec did not change any architectural fact, say so and touch nothing. Do not churn the charter on every spec write.

## After writing: discharge the spec into its long-lived homes

**The charter is only one of three long-lived homes, and the spec is a one-shot document.** A `spec.md` describes *what this batch will do*; it is void once the effort closes. Anything in it that must outlive the effort has to be written into a document that persists — **at the moment the spec is finalized, not later** (by the time the effort closes, the context is gone and nobody can reconstruct where each piece belonged).

This is the same step as above, widened. For every section of the spec you just wrote, decide its **disposition** and write a **disposition line** under that section heading:

```markdown
> **归宿（<YYYY-MM-DD>）**：→ arch §7.5 ＋ docs/<file> §3
```

The line's value is exactly one of four kinds, and it may point at several targets when a section genuinely spans layering and domain:

| Spec content | Goes to |
|:--|:--|
| Testing decisions (seams, gates, why tested this way) | **Requirements doc** — under an "验收与测法" section |
| Out of scope (what this deliberately will not do) | **Requirements doc** — under a "范围外" section |
| Implementation detail | **`docs`** — horizontal (how parts connect) → charter; vertical (how this domain defines/computes) → **domain doc** |
| Data-layer DDL | **Domain doc** — the data model is part of the domain model |
| Open-item backfill records and other process matter | **Archive** (`.archive/`) — process matter carries no authority |

Horizontal vs vertical is the judgment that decides charter-or-domain-doc: **"how do the parts of the system connect" → charter; "how is this defined or computed inside this domain" → domain doc.** DDL always goes to the domain doc.

**Requirements doc** (`type: requirements`, path `docs/requirements/<effort>-<topic>.md`): a long-lived home for *what the user wants* — user stories, problem, solution, acceptance and test approach, out-of-scope. **The filename must contain the effort slug** (the `.plan/<slug>/` directory name) so the requirements doc and the effort remain findable from each other. One effort may split across several by topic; every one carries the slug.

**A spec section with no disposition line is unfinished work, not a stylistic gap.** When every section carries one and every target exists, the spec is dischargeable and may be voided — that is the mechanical test for "the spec has been fully absorbed". Until then it may not be archived away.

Two prohibitions worth stating outright, because both are how this goes wrong:

- **Do not point a long-lived doc at the spec as its "source of truth".** The long-lived document *is* the authority — it states what is true now. A pointer from a permanent doc to a temporary one goes stale the moment the spec is voided, and the permanent doc is left standing on nothing. Point at it as a **"决策来源"** (why this was decided) instead, and repoint to the archive path once the spec is archived.
- **Do not copy the spec's prose wholesale into the charter.** If it isn't part of "what the architecture is now", it belongs in the domain doc or the requirements doc — or it was process matter all along.
