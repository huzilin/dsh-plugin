# Skills

General-purpose agent skills, adapted from [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT — see [LICENSE](./LICENSE)). Rewritten to be:

- **Standalone** — no setup skill, no per-repo configuration step. Each skill states its own conventions inline.
- **Language-agnostic** — examples are pseudocode or multi-language; tooling references defer to the project's own task runner and static checks.
- **Harness/model-agnostic** — no dependence on a specific agent product. Where a skill benefits from subagents, it degrades gracefully: run isolated parallel subagents if the environment supports them, otherwise run the same work as sequential, self-contained passes.

## Shared conventions

- **`.plan/`** — the project's planning memory, committed to version control. Specs (`.plan/<slug>/spec.md`), ticket breakdowns (`.plan/<slug>/tickets.md`), wayfinder maps (`.plan/<slug>/map.md` + `.plan/<slug>/tickets/NN-<slug>.md`), and handoffs (`.plan/handoffs/`).
- **`CONTEXT.md`** at the repo root — the domain glossary; **`docs/adr/`** — architecture decision records. Both created lazily by `domain-modeling`; skills that read them proceed silently when they don't exist.

## Skills

Most skills live directly in this directory and install by default. The rest are optional extras under [`.optional/`](./.optional/) — copy over whichever you want.

**User-invoked** — reached by typing their name; their job is to orchestrate a session.

- **[grill-me](./grill-me/SKILL.md)** — a relentless interview to sharpen a plan or design, one question at a time.
- **[grill-with-docs](./grill-with-docs/SKILL.md)** — grill-me plus live domain-model upkeep: updates `CONTEXT.md` and ADRs as decisions crystallise.
- **[handoff](./.optional/handoff/SKILL.md)** — compact the current conversation into a handoff document (`.plan/handoffs/`) so a fresh agent can continue.
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)** — scan for deepening opportunities, present as a visual HTML report, then grill through the chosen one.
- **[to-spec](./.optional/to-spec/SKILL.md)** — synthesize the current conversation into a spec at `.plan/<slug>/spec.md`.
- **[to-tickets](./to-tickets/SKILL.md)** — break a plan or spec into tracer-bullet tickets at `.plan/<slug>/tickets.md`.
- **[to-approval](./to-approval/SKILL.md)** — expand a decision stated too tersely to act on into a readable approval document at `.plan/`, carrying a status header so it stays trackable.
- **[plan-approve](./plan-approve/SKILL.md)** — work the set of `.plan/` documents waiting on the human: re-verify each `pending` item, report the ones already settled, put the live ones in one batch, then record the rulings and advance each document's status.
- **[plan-archive](./plan-archive/SKILL.md)** — archive completed plan work one round at a time: a finished round is `git mv`'d whole into `.archive/rounds/<round-id>/`, out-of-round references swept, superseded conclusions marked in place. Run manually when a round has shipped.
- **[plan-sync](./plan-sync/SKILL.md)** — reconcile `.plan/` tickets with what actually shipped: judge from git and the code, write back statuses and acceptance ticks, end green on plan-lint.
- **[wayfinder](./wayfinder/SKILL.md)** — chart a big, foggy effort as a map of investigation tickets, resolved one per session. Storage is adapter-specific; the default is [local markdown](./wayfinder/TRACKER-MARKDOWN.md) under `.plan/<slug>/`.
- **[writing-great-skills](./.optional/writing-great-skills/SKILL.md)** — reference for writing and editing skills well.

**Model-invoked** — reachable by the agent on its own (and by other skills), or by typing their name.

- **[codebase-design](./.optional/codebase-design/SKILL.md)** — shared vocabulary and principles for designing deep modules.
- **[domain-modeling](./domain-modeling/SKILL.md)** — actively build and sharpen the project's domain model (`CONTEXT.md`, `docs/adr/`).
- **[grilling](./grilling/SKILL.md)** — the relentless interview itself: design-tree rounds, one frontier at a time, questions written to an approval document before they are asked. [grill-me](./grill-me/SKILL.md) is the user-invoked router that reaches it.
- **[diagnosing-bugs](./diagnosing-bugs/SKILL.md)** — diagnosis loop for hard bugs and performance regressions: build a tight red/green feedback loop first, then hypothesise, instrument, fix, and land a regression test.
- **[plan-protocol](./plan-protocol/SKILL.md)** — the shared contract of the plan ecosystem: the three flows, each skill's position and hand-offs, and the document shapes the plan view reads. The plan skills load it before acting; also inits a fresh `.plan/` workspace.
- **[prototype](./prototype/SKILL.md)** — throwaway code that answers a design question: an interactive terminal app for logic/state questions, or radically different UI variants behind one switcher.
- **[research](./research/SKILL.md)** — investigate a question against primary sources and capture cited findings as markdown.
- **[to-qa-testcases](./to-qa-testcases/SKILL.md)** — build an effort's test suite: design-source inventory → case design → executable assets, written to `.plan/<effort>/qa/cases.md` (cases carry no frontmatter; only the defect ledger does).
- **[run-qa-testcases](./run-qa-testcases/SKILL.md)** — run those cases: acceptance records, the defect ledger (`type: qa-defect`, surfaced by the plan view's 缺陷 tab), and the rework-to-closure loop — scoped to one map or a full regression.
- **[review-code](./.optional/review-code/SKILL.md)** — two-axis review of a diff: Standards (repo conventions + smell baseline) and Spec (does it implement what was asked?).

## Divergences from upstream

Beyond the retargeting described in [LICENSE](./LICENSE), `wayfinder` makes three deliberate changes to Pocock's method. All three exist because upstream stores tickets on an **issue tracker**, and a tracker supplies guarantees a directory of files does not.

- **A ticket is never deleted.** Upstream says "update or delete those tickets." A tracker's issue id is never reused, so deleting is unusual there and closing is the norm; a filename offers no such protection, and removing one dangles every `blocked_by` that named it. Ruled out is the way off the map. This lives in the [markdown adapter](./wayfinder/TRACKER-MARKDOWN.md), not the skill — a tracker-backed adapter need not adopt it.
- **`undermined_by`.** Upstream has no equivalent: a decision whose premise a later ticket destroyed is simply `resolved`, and reads as settled. The field records what broke, so a green checkmark cannot launder a live problem.
- **Out of scope never unblocks.** Upstream says a ticket is unblocked when every ticket blocking it is *closed*, and out-of-scope tickets are closed — so a dependent goes takeable on the strength of a decision nobody made. Here `out_of_scope` satisfies no blocking edge, and a ticket blocked by one is flagged: one of the two is mis-scoped.

Upstream's own layering is preserved. The skill is tracker-agnostic method; storage mechanics live in an adapter, and the local-markdown adapter is the default upstream names when no tracker is wired up.

## Maintenance: source repo vs installed skills

- **源仓是唯一修改入口**。`packages/dsh-plan-view/skills/` 下的 skill 正本只在 git 里改（Edit 定点改 + commit）；安装态（`~/.zcode/skills/` 等）是**分发产物，只读**。
- **流向单向**：源仓 commit → 复制分发到安装态。安装态上若发现领先内容（其他会话绕过源仓直改所致），先逐处审查、用 Edit 定点回填源仓入库，再统一下发；**禁止从安装态整文件 `cp` 覆盖源仓**——分发侧的未审改动会随 cp 污染正本。
- **分发后必须 `diff -r` 全树校验零 gap**（双侧同步靠记忆不可靠：case-library.md 曾漏同步两轮才发现）。
- **写作纪律：skill 只写做法，不叙历史**——skill 正文与 references 示例一律正面陈述怎么做；历史做法、事故叙事归 `case-library.md`（教训正本）与 git 历史，不进示范材料。
- **skills 自包含**：skill 正文与 references 零外部引用——不得指引 agent 去读其他仓库的文件/脚本/记忆库；确需的知识内化进 skill 正文。案例库（case-library.md）的案例标签与日期属案例身份，不属操作引用。
- **规则正文零历史变更标记**：条款一律只写现行要求，不写「（日期 拍板/裁定）」「票 NN」「原 X 形态废弃」等变更史；形态兼容说明（旧形态只读兼容）除外。
- 分发目前仍手动；自动化（扩 install-skills.sh 或新增同步脚本）待票。
