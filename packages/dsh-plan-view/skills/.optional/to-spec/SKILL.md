---
name: to-spec
description: Turn the current conversation into a spec, saved to `.plan/` — no interview, just synthesis of what you've already discussed.
disable-model-invocation: true
---

This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD). Do NOT interview the user — just synthesize what you already know.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. If a `CONTEXT.md` glossary exists at the repo root, use its vocabulary throughout the spec; respect any ADRs in `docs/adr/` in the area you're touching. If neither exists, proceed silently.

   **Read the architecture charter first (if one exists).** Many repos keep a single architecture source of truth — e.g. novel keeps `docs/architecture.md` (self-declared "全局架构唯一正本"). Before writing a spec, read it so the new work slots onto the real layering, domain boundaries, state machines, and contract boundaries rather than re-deciding settled facts. Respect its document map (usually a "文档地图" section) as the pointer layer — do not duplicate what it already states; reference it.

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

The spec is one layer down from the architecture charter. If the repo keeps a single architecture source of truth (novel: `docs/architecture.md`, self-declared "全局架构唯一正本"), update it after the spec lands:

- **Do not duplicate** the spec's detail into the charter. The charter states *what the architecture is now*; the spec states *what this piece will do*.
- **Extend or correct** the charter's facts if the spec introduces new layering, a new domain, a state-machine change, a new contract, or a changed dependency edge. Keep its document map (e.g. "§12 文档地图") pointing at the spec you just wrote and at any other new documents — the map is a pointer layer, and a broken pointer there is how decisions get lost.
- **Leave a pointer, not a copy.** Add or update the one line that references this effort; the charter must stay the single source of truth, not a second spec.
- If the spec did not change any architectural fact, say so and touch nothing. Do not churn the charter on every spec write.
