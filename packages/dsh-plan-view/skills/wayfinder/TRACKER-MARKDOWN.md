# Tracker: local markdown

The default adapter for [`wayfinder`](SKILL.md), and the one to use when the repo has no issue tracker wired up. The map and its tickets are files under `.scratch/`, committed to version control — the shared memory that future sessions orient to, so commit map and ticket changes promptly. (2026-09-29 directory migration: the tracker layer moved from `.plan/` to `.scratch/<effort-slug>/`; approval documents stay in `.plan/`.)

The skill holds the method. This file holds everything the method defers: where files live, what carries structure, how status is read, what a claim is, and the checklist to run before committing. **A tool that reads a map reads it by this file.**

Structure only what has exactly one correct value **and no other home**: type, edges, claims, anchors. A machine can check those, and a second copy of one is a bug waiting to happen. A ticket's status is not among them — it is already written in the ticket, and so it is derived rather than stored. Everything else is prose — see **What stays prose** in the skill.

## One session at a time

This adapter **does not support concurrent sessions.** The skill permits them for trackers that can honour them; files in git cannot. Two sessions reach for the same ticket number, both commit, and git merges the collision cleanly — neither session could see it coming, and the loser's blocking edges now name the wrong ticket.

Serialising also earns the delta check below: if nothing merges, the invariants hold by induction from the last commit, and a session need only verify what it changed.

If a merge happens anyway, that induction is void. **Verify the whole graph, not your delta**, and run the linter if the repo has one.

## Layout

```
.scratch/<effort-slug>/
  map.md                    the map body — see the skill
  issues/NN-<slug>.md       one file per ticket, numbered from 01
  assets/                   research notes, approved markup, prototypes
```

The map's Decisions-so-far and Out-of-scope sections link tickets as `[<title>](./issues/NN-slug.md)`.

## Tickets

A ticket's number is its identity. It is **never reused and never retired** — a ticket file is never deleted, only closed. Deleting one dangles every edge that named it, anywhere in the graph, in files no session has open; that is the single change a delta check cannot see. Where the skill says "update those tickets or close them," this adapter says: close them.

The frontmatter holds the ticket's facts, and is the only place any of them is written. The body is the question, sized to one fresh agent session.

```markdown
---
type: research | prototype | grilling | task
claimed_by: <session or agent id>    # set while a session holds the ticket
claimed_at: <RFC 3339 timestamp>     # set alongside claimed_by
undermined_by: [NN]                  # optional — see the skill
assets: [<repo-relative path>]       # optional
---

# <Ticket title>

**Blocked by:** <ticket ids, or "None — can start immediately">

**Status:** open

## Question

<the decision or investigation this ticket resolves>
```

`**Blocked by:**` and `**Status:**` are **body lines near the top**, not frontmatter fields — a reader opens the file and sees both immediately. `Status:` takes `open` / `claimed` / `resolved`, one vocabulary shared with every other ticket type. Blocking edges take **bare ticket ids** (`Blocked by: 03, 04`); **never quote them** — the tool-side parser does not tolerate quotes, and one quoted id aborts the whole graph parse. `None` is the only way to say "no blockers".

The frontmatter holds only what the body does not carry: `type`, the claim, and the optional `undermined_by` / `assets`.

A closing section — `## Answer`, or `## Ruled out` — is appended on closure, not written up front. Assets are saved in the repo, linked from `assets:`, and not pasted in.

### Closure is derived; the `Status:` line is for the live states

`resolved` and `out_of_scope` are **read from the body, never written into `Status:`** — closure is derivable, so storing a copy of it would give one fact two homes, one of which goes stale. The line only ever holds `open` or `claimed`.

| Derived state | When |
|---|---|
| `out_of_scope` | the body has a `## Ruled out` **with prose under it** |
| `resolved` | the body has an `## Answer` **with prose under it** |
| `claimed` | neither closing section, and `claimed_by` is set |
| `open` | none of the above |

**Closure is read first**, which is why a `claimed_by` or a `Status:` line left behind on a closed ticket is inert litter rather than a broken invariant — it can never hold the frontier. **Never "tidy" such a ticket** by writing `resolved` or `out_of_scope` into its `Status:`: that is how a ticket starts lying, and it invites the next reader to treat a boundary as a step.

The one state that must not exist is both closing sections at once: a ticket is either a step on the route or a boundary of it, never both.

Writing the answer **is** the act of closing the ticket. There is no second edit to forget, so a finished ticket carrying no answer — and an answer sitting on an unfinished ticket — are unrepresentable rather than merely checked.

It is the *prose*, not the heading, that closes the ticket. A session that types `## Answer` and then dies has closed nothing, and the ticket stays exactly where it was: still claimed, its claim going stale, its owner still nameable. Were the bare heading enough, that ticket would read as finished and its stale claim would look like harmless litter — a dead session laundered into a decision.

**`resolved` and `out_of_scope` are not two flavours of "over".** `resolved` means the route went through this ticket; `out_of_scope` means the ticket sits past the destination and the route deliberately does not. Only `resolved` satisfies a blocking edge — a ticket blocked by an out-of-scope ticket never unblocks, and that is a signal that one of the two is mis-scoped, not a state to be tidied away. Collapsing the two would let a boundary silently count as a step.

### Fenced code blocks are not structure

**Every scan for structure — headings, titles, bullets, links — ignores whatever sits inside a fenced code block** (` ``` ` or `~~~`). A ticket that quotes the ticket format in its Question contains the line `## Answer`, and must not thereby resolve itself. On a map about maps, that is the likeliest ticket you will ever write.

The rule cuts one way only: a closing section whose entire body is a code fence is still written, and still closes the ticket.

Finding the frontier is one scan. The grep below is fence-blind, so it is a convenience and not the contract — a tool must strip fences first:

```sh
grep -LE '^## (Answer|Ruled out)' issues/*.md    # every ticket still open or claimed
```

### Claims

`claimed_by` is the claim: set it, and commit it, before any work, so a later session skips the ticket. `claimed_at` is what tells a live session apart from one that died mid-ticket; without it the frontier steps around that ticket forever.

**A claim older than 72 hours is stale.** Say so out loud when you find one, rather than silently taking or skipping the ticket.

## Fog patches

One bullet per patch in the map's **Not yet specified**. The bolded lead sentence is the patch's **title** — its identity, so it can be referred to and struck once it graduates. Anchor it to the open ticket that will clear it where you know which; leave the anchor off where you don't. Title and anchor are a patch's only structure; the rest is prose, as loose as the view allows.

```markdown
- **<Patch title>.** <prose> <clears-with: NN>
```

## Verify before you commit

The map is shared memory: the next session trusts it without re-deriving it, so drift misleads silently.

But these invariants held at the last commit, and one session touches few files. **Verify your delta, not the graph** — only what you changed can have broken them. The induction bottoms out at the charting session, which creates a map with nothing resolved and nothing closed, and it stands only because this adapter serialises sessions.

Checks 1, 2, 4 and 6 are a grep. Checks 3 and 5 need judgment, and no tool can supply it.

1. **Edges.** Every `Blocked by:` you wrote names a ticket that exists, and not itself. No cycle — the whole edge set is one grep over `issues/`.
2. **Closure.** No ticket carries both an `## Answer` and a `## Ruled out`, and no closing heading is left empty.
3. **The index.** The ticket you resolved appears exactly once in **Decisions so far**, and its gist says what its answer says. A ticket you ruled out appears once in **Out of scope**, and nowhere in Decisions-so-far.
4. **Claims.** Any ticket still carrying `claimed_by` also carries `claimed_at`, and that claim is under 72 hours old.
5. **Fog.** Every patch title names a question no live ticket holds, and every `<clears-with: NN>` names a ticket not yet `resolved` — a patch anchored to a resolved ticket should have graduated into a ticket, or been struck.
6. **Numbers.** Each ticket number is used once, and no ticket file was deleted.
7. **Counts.** Progress is written down nowhere; it is derived. Grep the repo for a stated count before you commit one.

Where the repo has a tool that performs these, run it — but the skill needs no tool and assumes none. A tool's job here is `fsck`, not verification: it re-establishes the base case after the things a delta check cannot see, which are edits made outside this protocol and any merge that happened despite the rule above. It runs after the fact, and its absence costs you recovery, not correctness. A tool reading only `.scratch/` also cannot see check 7's grep, nor make the judgments in checks 3 and 5.
