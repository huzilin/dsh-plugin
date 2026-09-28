---
name: plan-protocol
disable-model-invocation: true
description: The plan-ecosystem contract — where each plan skill sits, what it owns, and how they hand off. Load when any of to-spec / to-tickets / implement / implement-spec / plan-sync / to-approval / plan-approve / plan-archive / to-qa-testcases / run-qa-testcases / diagnosing-bugs / plan-loop is invoked, when explaining the flows or the QA defect loop, when asked to init a fresh `.plan/` workspace in a repo, or whenever a session involves code development or code retrieval that reads or writes plan documents (`.plan/` specs, tickets, ledgers, QA files, and their `.scratch/` counterparts after the directory migration).
---

# Plan 流程协议（计划生态契约）

本文件是 **plan 一套 skill 的共享协议**。它不做事，只规定：三条流程（主流程 / 补充流程 / QA 流程）、每个 skill 的位置与职责、文档形态约定、跨 skill 交接契约。

**谁该读它**：本目录下的 `to-spec` / `to-tickets` / `implement` / `implement-spec` / `plan-sync` / `to-approval` / `plan-approve` / `plan-archive` / `to-qa-testcases` / `run-qa-testcases` / `diagnosing-bugs` / `plan-loop`，以及任何需要解释 plan 流程的 session。这些 skill 各自持有自己的 how；本协议是它们的**公共契约层**，避免各自重述、各自漂移。

> 与 `dsh-plan-view` 插件的关系：插件是**只读为主**的渲染方——第一层「总览 / 地图 / 测例&缺陷 / 台账 / 说明」页签，图内再按单据类分子页（路线 / 工单 / 待拍板 / 台账 / 缺陷 / 测例 / 串联）。唯一写回是派工那一刻把 `session` 绑上票面（即 §二硬规则 3 的执行登记）；归档轮整轮只读。所有文件形态约定（见下文「文档形态」）都是为了让插件能正确读。

---

## 一、三条流程

### 主流程（先决策，再落地）

```
      ┌──────────────────────────────┐
      │                              ↓
grill / wayfinder → to-approval → plan-approve      ← ① 决策循环（一轮轮收敛）
      │
      ↓（决策定案：结论是「要做某件事」）
   to-spec → to-tickets → implement / implement-spec → plan-sync   ← ② 落地链
                                                                  ↑
                                                      （执行时当场回写）
```

### 补充流程（需要拍板的问题 / 缺口）

```
问题发现（用户反馈 / code review / 走查 / QA 缺陷升级）→ to-approval → plan-approve →（依据）→ to-tickets → implement / implement-spec → plan-sync
                                             ↑
                                 依据 = 那份待拍板文档本身
                                 （不追加 spec、不新建 spec）
```

**两条流的分界**：主流程是「**已知要做**，把需求写成 spec 再拆票」；补充流程是「**发现一个问题 / 缺口**，先拍板定论，依据就是拍板文档」。汇合点相同：**拍板结论若要干活，当场落成标准票**（`to-approval` 调 `plan-approve`，`plan-approve` 调 `to-tickets`），接回落地链 ②。落票时机不限结算当场——挂账恢复转票、修复会话按拍板档立返工票同为合法时刻（见二·硬规则 1），格式一律同源 `to-tickets`。

### QA 流程（测试与缺陷闭环）

```
to-qa-testcases → run-qa-testcases ──全绿──→ 票写 qa_accepted → 接回落地链收尾
      │                │
      │ 票写 qa_cases   └─有缺陷→ DEF-NN 缺陷档 → diagnosing-bugs 修复（回写 DEF C 节）
      │                                                │
      └────────── 复测 = 同一条命令翻绿 ←────────────────┘
```

**QA 流与两条流的分界**：QA 流挂在实施图（票型 `task`）之后——测例是票的验收面，不是新需求。缺陷档（`DEF-NN`，一缺陷一文件）本身就是返工依据，**不立拍板档**——这是与补充流程的关键分界：补充流程走 `to-approval` 是因为要拍板定论，测试测出的缺陷按类型（`rd` / `fe` / `arch` / `docs`）直接派发 `diagnosing-bugs`。修复完**回到 `run-qa-testcases` 复测**（同一条命令翻绿），缺陷关闭后票面 `qa_accepted` 才成立；缺陷暴露出需求级分歧时才转 `to-approval`。

---

## 二、每个 skill 的位置与职责

| skill | 流程位置 | 上游 | 下游 | 产出 | 不做什么 |
|:--|:--|:--|:--|:--|:--|
| `grill` / `grilling` | 主流程 ① 输入端 | 用户想法 | `to-approval` | 把模糊决策拷问清楚、问题落文档 | 不写票、不拍板 |
| `wayfinder` | 主流程 ① 输入端（推演地图） | 用户探索 | `to-approval` | `.plan/<effort>/` 推演地图（map + tickets/ + assets） | 不写 spec、不拍板 |
| `to-approval` | ① 与 ② 之间 | grill / 发现的问题 / 裸 id | `plan-approve` | 待拍板文档（`status: pending` + 四字段头 + 原文照抄 + 四要件） | 不拍板、不手写票 |
| `plan-approve` | ① 出口 / ② 入口 | `to-approval` | `to-tickets` | 逐项核定、录结论、**按 ruling 调 `to-tickets`**、推进文档状态（只翻状态、不搬文件） | 不发明票格式、不散件归档 |
| `to-spec` | ② 起点 | 决策定案 | `to-tickets` | `spec.md`（整体写）；**写前读架构正本、写完更新架构正本** | 不拆票 |
| `to-tickets` | ② 第二环（**票格式正本**） | spec / 待拍板文档 / 推演地图 | `implement*` | **一票一文件** `tickets/<NN>-<slug>.md` + `map.md`（若无） | 不写 spec、不实现 |
| `implement` / `implement-spec` | ② 第三环 | 票 | `plan-sync` | 实现 + **合并落地时当场回写票** | 不读盘批量翻状态 |
| `plan-sync` | ② 收尾（对账） | 已落地代码 | 无 | 把「看起来已完成、票面没翻」的票找回来、对账后回写 | 不凭人话翻状态、不写票 |
| `to-qa-testcases` | QA 流（测例构建） | 实施图票（`task`） | `run-qa-testcases` | `qa/cases.md`（一图一份）+ 仓库 `qa/` 可执行资产；被测票写 `qa_cases: true` | 不跑用例、不记缺陷 |
| `run-qa-testcases` | QA 流（执行 + 缺陷台账） | `to-qa-testcases` 产物 | `diagnosing-bugs`（有缺陷时）；复测回到本 skill | `test.md` + `DEF-NN-*.md` + 截图；票写 `qa_tested` / `qa_accepted`；收尾跑 plan-lint | 不修 bug、不定位根因 |
| `diagnosing-bugs` | QA 返工环（根因定位 + 修复） | 缺陷档 E 节「最小复现入口」 | `run-qa-testcases`（复测关闭） | 根因 + 修复 + 回归位；**只回写 DEF 的 C 节**；收尾跑 plan-lint | 不翻缺陷状态机、不跑全量回归、不记缺陷 |
| `plan-archive` | ② 之后（整轮归档期） | 已走完的轮（全部成员） | 无 | 整轮归档（目录结构原样）+ sweep 轮外引用 + 标过时/废弃 | 不自动跑、不改代码、不散件归档 |
| `plan-loop` | 循环编排层（跨三条流程） | 全部既有单据 | 轮内按动作表调度各环节 skill | 轮次推进 + Brief + 收口裁决单 | 不拍板、不发明单据格式、不代替 plan-archive 自动归档 |

**交接契约（硬规则）**：

1. **票的格式由 `to-tickets` 独占**——它是落地链的票格式正本 + 被 `plan-approve` 调用的生成器（wayfinder 图内的推演票不走 to-tickets，走 §三的同构 TRACKER-MARKDOWN 契约），输入必须是 spec / 待拍板文档 / 推演地图，不能是裸结论；调它时也要 override 其默认「合并 `tickets.md`」行为，改用一票一文件。**落票的时机是合法集合**，不限字面调用本 skill：①拍板结算（`plan-approve` 调 `to-tickets`）；②挂账恢复转票（见 §三 挂账台账「恢复口径」）；③修复会话按拍板档立返工票。无论哪个时机落票，格式必须与 `to-tickets` 产出一致（一票一文件 + frontmatter `type` / `blocked_by` / `status`），plan-lint 兜底校验。
2. **回写发生在两处，是同一件事的两种时机**：`implement*` 在每张票合并落地时**当场**翻状态；`plan-sync` 事后对账补齐。两者不是两套流程。
3. **执行登记（多 agent 并发防混）**：agent 拿到票开工的那一刻必须回写票面——frontmatter 形态票写 `status: claimed` + `claimed_by: <agent 名>` + `session: <会话标识>`（DSH 会话写 `session-<uuid>`；zcode 写 `sess_<id>` 或会话名）；wayfinder 推导形态票写 `claimed_by` + `claimed_at`，不写 `status`（格式契约见 TRACKER-MARKDOWN）。票面 session 是页面跳转/串联展示的唯一凭据：DSH 会话可从计划视图直接跳转；外部会话（zcode 等）页面展示名字并提供恢复命令复制（`zcode --resume <id>`）。完工/弃做时同步把状态改为终态，避免长期滞留「执行中」。
4. **`plan-approve` 是「决策 → 票」的主转化点**：拍板结论是「做 X」时，必须调 `to-tickets` 落票，否则结论只是聊天记录，下次会话丢失。挂账恢复转票与修复返工票是另外两个合法落票时机（见规则 1），不需要先有拍板文档在手——依据分别是台账「恢复口径」与拍板档结论。
5. **架构正本（如 `docs/architecture.md`，项目自declare「全局架构唯一正本」者）是全局架构唯一最新事实**：`to-spec` 写前读、写完更新；`plan-approve` 拍板若改变了架构事实，也在末步更新。它不新建——已存在就维护。
6. **QA 缺陷环不经过拍板**：缺陷档（`DEF-NN`）是返工依据，修复交 `diagnosing-bugs`（按 E 节「最小复现入口」契约，修复只回写 C 节），复测回 `run-qa-testcases` 用同一条命令翻绿；票面 `qa_cases` / `qa_tested` / `qa_accepted` 三标记由测试两 skill 写入，验收条件 = AC 全过 + 该票无未关闭缺陷；缺陷暴露需求级分歧时才转 `to-approval`。

---

## 三、文档形态约定（插件能读的前提）

- **一票一文件**：`.plan/<effort>/tickets/<NN>-<slug>.md`。**禁止**把多票写进一个 `tickets.md`——按文件读取的一方会把合并文件当成**一张票**，里面所有票丢失。
- **frontmatter 是权威**：票里 `status` / `type` / `blocked_by` 以 frontmatter 为准，不读正文表格。
- **`blocked_by` 格式（两形态共用的唯一格式，2026-09-27 拍板统一）**：YAML 流式序列，取值**裸写、不加引号**——
  - `blocked_by: []`：无前置（**唯一合法空值**；不得写 `[无]`、`none`、留空）
  - `blocked_by: [03]`：单个前置；`blocked_by: [03, 04]`：多个前置，逗号+空格分隔
  - **禁止加引号**（`["03"]`、`['03']`）——工具侧解析器（`splitNums`）对引号不容忍，会致**整图解析中止**；本插件读取层虽容忍引号，但**正本格式一律裸写**，容忍不等于合法
  - **票 id 形态**：本仓票用两位数字（`03`）；带字面前缀的票（如 `AIT1`、`OPT3`）直接写前缀全称，不加引号
  - **本格式同时适用于 frontmatter 形态票与 wayfinder 推导形态票**——两形态共享同一 `blocked_by` 契约（推演形态的完整契约见 wayfinder `TRACKER-MARKDOWN.md`）；**禁止另立第二种写法**（协议与 wayfinder 两侧曾各写一套、致 27 处带引号票在工具侧整图中止，2026-09-27 收口）
- **文档分层（五层，两类生命周期 · 2026-09-27 拍板）**：`plan` 生态里的文档按**权威寿命**分五层，**新内容该写哪里，按层判**：

  | 层 | 文档 | 写什么 | 寿命 |
  |:--|:--|:--|:--|
  | **长期权威** | ①`arch` 总纲 | 全仓唯一，写「系统是什么」 | **持续维护、永不退役** |
  | **长期权威** | ②领域文档 | 每域一份，写「本域内怎么定义／怎么算」 | **持续维护、永不退役** |
  | **长期权威** | ③需求文档 | 写「用户要什么」 | **持续维护、永不退役** |
  | **一次性** | ④`spec.md` | 写「这一批怎么做」 | **随 effort 生命周期；effort 关闭后作废并归档** |
  | **过程** | ⑤拍板档／推演图／票／开放项记录 | 过程留痕 | → `.archive/`，**不承担权威** |

  - **一句话判据**：**长期权威是「现在是什么」，spec 是「这一批怎么改」。** 前者读完要能脱离 spec 独立读懂；后者用完即废。
  - **需求文档（新文档类，2026-09-27 拍板）**：`type: requirements`；落点 `docs/requirements/<effort>-<主题>.md`；**文件名必须含 effort slug**（＝`.plan/<slug>/` 目录名，故需求文档与 effort **同名可检索**）。承载**用户故事／Problem／Solution／验收与测法／范围外**。同一 effort 可按主题拆多份，但**每份都带 effort slug**。
  - **横／纵判据（决定写 `arch` 还是领域文档）**：内容回答「**系统各部分怎么相连**」→ **横向** → `arch`；回答「**本域内部怎么定义／怎么算**」→ **垂直** → **领域文档**。同一节常横纵兼有，**故一个归宿可指向多处**；**DDL 归领域文档**（数据模型是领域模型的一部分）。
  - **长期权威自指（修正现状反置）**：**长期文档自身即权威**（它是现行事实），**不得把 `spec` 声明为「真相源」**——spec 一作废，该权威依据即悬空。对 spec 的指针**改称「决策来源」**（记「为什么这么定」；spec 归档后指针指向归档路径）。
- **`spec` 生命周期与归宿行（2026-09-27 拍板）**：`spec.md` 是**一次性实施文档**，**随 effort 生命周期**——
  - **关闭 effort 后，spec 整体作废并归档**；作废前必须先把内容按**五类归宿**分流出去；
  - **五类归宿**：①测试决策（接缝／门禁／为什么这么测）→ **需求文档**（附「验收与测法」节）；②Out of Scope → **需求文档**（附「范围外」节）；③实现细节 → **docs**（横向→`arch`／垂直→领域文档）；④数据底座 DDL → **领域文档**；⑤开放项回填记录等过程物 → **归档**（`.archive/`）；
  - **归宿行机制（完成标准）**：spec **每节**须有一行归宿行，取值只能是四种之一——`→ arch §X` ／ `→ docs/<file> §Y` ／ `→ 需求文档 <path> §Z` ／ `→ archive（过程物）`。形态写在该节标题下：
    ```markdown
    > **归宿（<YYYY-MM-DD>）**：→ arch §7.5 ＋ docs/<file> §3
    ```
  - **「更新完成」＝ spec 每节都有归宿行，且指向的目标确实存在。** 语义判断仍要做一次（不可免），但**完成与否由此可机械判定**，且**它同时就是「spec 可否作废」的凭据**——归宿行齐全 ⇒ 可作废；缺失 ⇒ 不可作废；
  - **时点**：docs 更新钉在「**spec 定稿那一刻**」，与 `to-spec` 现有动作合并——**不等到「关闭 effort 后」**（那时上下文已散）。
- **状态头四字段**（待拍板 / spec / map 等文档）：`type` / `date` / `status` / `origin`。
  - `status` 五态：`pending` / `closed` / `superseded-by:<path>` / `active` / `abandoned`。**禁止「待拍项已作废却仍留 pending」**。
  - `origin`：产生原因（`readability-rescue` / `proactive` / `review` / `retrospective`）。
- **审批文档归属**：待拍板默认**落所属图** `.plan/<effort>/待拍板-<slug>-<date>.md`——视图按 effort 归图，只在该图「待拍板」子页出现；**根层 `.plan/待拍板-*.md` 只放全局性拍板**（跨图 / 无图归属的裁决）。挂账恢复转票进某图时，其关联拍板**随迁同图**（与挂账「恢复口径」联动，见挂账台账条）。既有根层已 closed 的历史拍板不强制回迁（相对引用密集、不再进拍板流，原地即历史锚点）。
- **effort 标志**：目录里有 `map.md` 才被当作 effort 加载；没有 `map.md` 的 `tickets/` 目录不被读取。
- **非治理目录**：`.plan/handoffs/`（handoff 交接文档产物区）不属 plan 生态——视图不加载、`plan-lint` 跳过（不查缺 map / 状态头 / 同票双档）。
- **图二型**（插件按票型自动分组展示，无需文档声明）：**推演图**（票型 `research`/`prototype`/`grilling`，终点=决策清零，wayfinder「Plan, don't do」）与**实施图**（票型 `task`，终点=落码验收）。落地工单 `type` 一律写 `task`——**唯一合法值**（2026-09-27 拍板：`impl` 不支持、不识别）。
  - **`impl` 不是票型（2026-09-27 拍板）**：`impl` 源自早期 novel 的目录名（`.plan/<effort>/impl/`、`impl-fe/`），后被误用为 `type` 值沿用；三处正本（本协议、`to-tickets` 票模板、wayfinder `TRACKER-MARKDOWN.md`）**均未将它列为合法票型**。**新写票一律 `task`**；存量 `type: impl` 票由「形态契约变更回扫」条款迁移——**未迁移前该票不被识别为工单**。注意 `impl` 另有两个**非票型**身份，不可混淆、不得清理——插件内部类型名 `MapKind='impl'`（实施图分组标识）与历史目录路径 `impl/`、`impl-fe/`。
- **票面 `status` 词表**（工单 frontmatter，执行态与终态）：执行中 = `claimed`（登记格式见「执行登记」硬规则）；终态 = `done`（**不分票型，全票统一**；允许附日期 `done <YYYY-MM-DD>`）。票态有两种合法形态：**frontmatter 形态**（to-tickets 系，`status` 写在 frontmatter）；**wayfinder 推导形态**（`status` 不入 frontmatter，由收束节推导——`## Answer` 带正文 = `done`、`## Ruled out` 带正文 = `out_of_scope`、`claimed_by` 在位 = `claimed`、其余 = `open`）。两形态共享同一 type 词表；推导形态的格式契约正本 = wayfinder `TRACKER-MARKDOWN.md`。
  - **本条只管「票」——四套状态机互不套用（2026-09-27 拍板）**：`type` 词表里有状态概念的共四类，但**分属四个坐标系，词表不得互相套用**：

    | type | 载体 | 词表 | 回答的问题 |
    |:--|:--|:--|:--|
    | `task` / `research` / `prototype` / `grilling` | frontmatter `status:` | `open` / `claimed` / `done` | 这张**票**走到哪了 |
    | `approval` | frontmatter `status:` | `pending` / `closed` / `superseded-by:<path>` / `active` / `abandoned` | 这个**提问**结案了吗 |
    | `ledger` | 正文 `- 状态:` | `在挂` / `已销` / `已转票` | 这笔**债**还了吗、转移到哪了 |
    | `qa-defect` | 正文 `- 状态:` | `待修复` / `已确认` / `修复中` / `待复测` / `已关闭` / `挂起` | 这个**缺陷**修好并复测通过了吗 |

  - **不得统一**：`approval` 的 `closed` 不可改写为 `done`——它会抹掉 `superseded-by`（被取代）与 `abandoned`（不问了）的区分，而这两个态正是「防止已作废的待拍项滞留」的依据；`ledger` 的「已转票」不可改写为 `done`——**「债务已还清」与「债务转移给他处」是两件不同的事**，混同即账目错误。
  - **载体差异是解析契约**：`ledger` / `qa-defect` 的状态写在**正文固定字段行**（非 frontmatter），是插件台账页／缺陷页与 agent 扫描的解析契约，**不得改形**（见「挂账台账」「缺陷条目」两条）。
  - **判据**：**同一坐标系才可统一**——`task` 与三个推演票型同属「票」，故共用一套票态并已统一为 `done`；其余三类各答各的问题，**跨坐标系套用词表即语义塌陷**。
  - **收口口径**：票态**只有本条一处定义**（README 模板等处的复述须与本节一致）。
- **`type` 取值约定**：`task`（落地工单）、`approval`（待拍板）、`research` / `prototype` / `grilling`（推演地图节点）、`ledger`（挂账台账）、`qa-defect`（QA 缺陷条目）。**这份清单即 `type` 的唯一合法词表**——`impl` **不在其中**（2026-09-27 拍板：不支持该类型，见「图二型」条），这是 2026-09-27 收口前的协议内部矛盾点，现予消除。`type` 值不在上表的文件按说明/杂项解析，不作单据校验对象。完全无 `type` 也无 `status` 的文件归「说明 / 杂项」类；无 `type` 但有 `status` 的存量手写票按其 `status` 归工单（兼容形态，新写票一律带 `type`）。
- **缺陷条目**（`type: qa-defect`，**一缺陷一文件**）：`.plan/<effort>/qa/DEF-NN-<slug>.md`，frontmatter `type: qa-defect` + 状态头，正文 `# DEF-NN 标题` + 固定字段行 `- 严重度:`、`- 类型:`（rd/fe/arch/docs）、`- Assignee:`、`- 状态:`（待修复/已确认/修复中/待复测/已关闭/挂起，取首词匹配、允许附注）、`- 关联用例:`、`- 发现源:`、`- 测试设计缺口:`，其后 A~E 五节（E 节最小复现入口必填——骨架正本见 run-qa-testcases `references/qa-records-skeleton.md`）。
  - **串联**：缺陷与票/挂账的串联靠详情文本写「票 NN」「挂账-NN」。
  - **识别**：qa 目录内不带 `type: qa-defect` 的文件不被视图识别；旧「单文件多小节」形态（`qa/defect.md` 清单总览表）只读兼容——归档轮快照是旧形态，现行一律一缺陷一文件。
  - **无图归属的缺陷**（SOP 回测、整页回测发现，挂不到具体工单/图）：落根层 `.plan/qa/DEF-*.md`（同格式），进第一层「测例&缺陷」tab。
  - **登记正本与用户直报**：缺陷档登记正本 = run-qa-testcases 的 `references/qa-records-skeleton.md`——字段行枚举、A~E 五节骨架、E 节「最小复现入口」的登记纪律以它为准。**用户直报缺陷（不经测试轮）**：会话按该正本立档，`- 发现源:` 按下条人工标记纪律、`- 测试设计缺口:` 必填，E 节复现命令须真跑一次取得红色输出（`diagnosing-bugs` 零重建接单的前提），立档收尾跑 plan-lint，按类型派 `diagnosing-bugs`；执行轮登记、复测、回归基线与台账关闭仍归 run-qa-testcases 主流程，本条只覆盖不经测试轮的直报。
  - **发现源人工标记纪律（2026-09-22 拍板）**：人工发现的缺陷（用户直报、验收走查、用户发现后 AI 协查定位均属之）`- 发现源:` 固定写「用户（人工发现；<语境附注>）」——novel 存量「用户（人工走查）」（DEF-01~08 先例）为等价历史形态；**禁止裸写「用户」**，并附验收文档指针；复盘按发现源透视人工发现率与 agent 走查盲区。
- **测例文档**：`qa/cases.md` **一图一份、不拆文件**——测例是批量设计文档（§0 被测对象/八源盘点/覆盖矩阵为共享上下文），由插件按路径识别为 `cases` 类单列「🧪 测例」子页，无需 frontmatter。
  - **测试标记写回票面**：`to-qa-testcases` 产出 cases.md 后给被测票写 `qa_cases: true`；`run-qa-testcases` 执行完写 `qa_tested: true`；验收通过（AC 全过 + 无未关闭缺陷）写 `qa_accepted: true`——三标记在票卡/详情以徽标展示。
  - **无图归属的回测测例**（SOP 回测、整页回测，挂不到具体工单/图）：落根层 `.plan/qa/cases-<主题>.md`（一主题一文件、不拆单），进第一层「测例&缺陷」tab；能挂到工单/图的测例放图内 `qa/cases.md`。
- **挂账台账**（`type: ledger`）：**每项目各自管账**——在哪个项目干活挂的账记哪个项目的台账，不跨仓寄挂；发现挂错仓的条目：原台账原地留痕销账（标注迁出去向），新台账迁入注记（维持原状态），不静默消失。
  - **两级 + 一账一文件**：**全局台账目录**=`.plan/ledger/`（plan 级跨图债务正本，收跨图/环境/架构类条目，整轮归档时原地不动——轮外全局文档）；**图内台账目录**=`.plan/<effort>/ledger/`（收明确属于该图的条目，随所在 effort 整轮归档——轮内成员）。一账一文件：`挂账-NN-<slug>.md`，frontmatter 带 `type: ledger` + 状态头四字段，正文 `# 挂账-NN 标题` + 固定字段行 `- 状态:`（在挂/已销/已转票）、`- 卡点:`（为什么现在做不了/不做）、`- 启动条件:`（什么情况可以开展）、`- 来源:`（何时谁挂的）——字段行是插件台账页与 agent 扫描的解析契约，不得改形。
  - **归属判据**：来源或恢复落点明确指向某张图的归图内，全局性条目留全局，拿不准的留全局（宁少拆不错拆）。插件视图：第一层「台账」页=全局台账，地图内「台账」子页=该图图内台账。
  - **销账**：在**条目文件自身**改 `- 状态:` 并在正文追加销账注记（日期/去向/证据或 commit），不留静默消失；旧「单文件多小节」形态（`.plan/挂账台账.md` 内 `### 挂账-NN` 小节）只读兼容——归档轮快照里是旧形态，现行一律一账一文件。
  - **agent 扫描启动纪律**：开工/收口时两级台账都扫，逐条对照「启动条件」与当前现状，已满足的项当场启动（按拍板落地协议立票或处理）；启动条件未满足的项不许提前动。
  - **恢复口径**：条目**到达实施阶段**（启动条件满足、要真干活）时**恢复到该条目来源所在的原有 map 立票**——不新开 effort、不另起一张图；恢复后在「来源」字段注记恢复落点，条目 `- 状态:` 改「已转票」并在文件正文留痕；原图若已 `status: closed` 随之重开 `active`（收口条件=该图全部票 done，届时再翻 closed）。
  - **阶段化状态机**：图内台账条目可含 `- 阻塞: <票NN, 票NN,…>` 字段（结构化依赖，**只允许引用同一张图的票**——依赖节点保证都在 map 中；全局台账跨图/无票依赖不写此字段，启动条件人工判断）。状态词据此分段：`- 状态:` 用 **阻塞中**（有阻塞字段且依赖票未全 done）/ **可启动**（无阻塞字段，或依赖票全部 done）。
  - **implement 重算条款**：implement/plan-sync 收口翻完票状态后，必须重算本图 `ledger/` 与全局台账中带 `- 阻塞:` 的条目——依赖票全部 done 即把状态词写回「可启动」（附注触发票号），agent 扫描启动条件时读文件即得，不再现算。计划视图按依赖票状态实时计算并展示阶段（写回延迟不影响页面正确性）。
  - **引用带号纪律**：行文、镜像台账、轮次简报凡指称挂账一律写「挂账-NN」编号（编号以台账文件名与 H1 为准），禁止只用绰号（如 ENV-2、B-3）指称；历史绰号引用须括注编号，镜像与正本编号保持一致。
- **轮内互引一律相对路径**：同一轮的文档互相引用，写相对路径（相对当前文件），不写 `.plan/...` 开头的根相对路径、不写绝对路径。轮收尾后 `plan-archive` 把整轮迁入 `.archive/rounds/<round-id>/`，目录结构原样，相对引用随整树搬迁存活；根相对/绝对引用会断。轮内引用轮外正本不受此限（正本不搬）。
- **形态契约变更回扫**：凡单据形态契约变更——状态头字段、字段行形状、`type` / `status` 词表——变更当轮对存量单据按新契约回扫迁移一次，不得只约束新写文档。本条管**文档形态**的存量回扫；术语的存量回扫由姊妹条款《术语变更双域Sweep协议》管**术语**，两者互不替代。

---

## 四、引用与过时管理（plan-archive 的职责）

归档单元是**轮**：从输入端（grill / wayfinder / 补充流问题拍板）到落地链收尾的一次完整闭环。轮走完后由 `plan-archive` 把整轮迁入 `.archive/rounds/<round-id>/`。规则：

- **整轮 `git mv`，目录结构原样**：成员相对 `.plan/` 的路径在轮目录内原样保留——轮目录就是该轮当时 `.plan/` 的快照，`git log --follow` 可溯。文件搬移只发生在轮归档这一处；`plan-approve` 只翻状态、不搬文件。
- **轮内互引一律相对路径**：整树搬迁后相对引用原样存活，这是「保持目录完整」的前提（见「文档形态约定」）。
- **归档不是删**：轮外全局文档（总架构文档、`.archive/README.md`、`.plan/` 内其他活跃轮、`docs/` 等）指向被归档成员的引用，sweep 后改指 `.archive/rounds/<round-id>/…` 新位置；「仍被实现引用、不能随轮归档」的成员就地加偏差声明、留在原处不搬。
- **已过时但仍有留存价值的结论**：留在原文档，给过时段落加标记（谁取代它、何时、还留着有什么用），不删除。
- **`.archive/README.md` 是归档区纪律 + 轮次索引 + 「现行权威」指针表**：每轮归档同步更新（教训：sweep 若排除 `.archive/`，归档区内部指针会失效留断链）。后续 plan 会话查历史，从轮次索引按轮切读完整视图。

---

## 五、工作区初始化（init）

用户带着 init 意图调用本 skill（「初始化 plan 目录」「init .plan」「给这个仓建 .plan」）时，为新仓库落 plan 工作区骨架。**幂等，不覆盖**：已开工的仓库重跑 init 不得改动任何既有文件。

动作：

1. `mkdir -p .plan/ledger`（全局台账目录，一账一文件 `挂账-NN-<slug>.md`；图内台账随 effort 建在 `<effort>/ledger/`）。
2. `.plan/README.md` **不存在才**按下方模板落盘（`<YYYY-MM-DD>` 换当日；指针区占位换项目实况）；**已存在则报告现状、零改动**——README 的后续维护归收口会话，受「形态契约变更回扫」条款覆盖。
3. 其余目录**不预建**：`spec.md` / `tickets/` 由 to-spec / to-tickets 首次产出时创建，`qa/` 由测试 skill 首次落盘时创建，`.archive/` 由 plan-archive 首轮归档时创建——空目录不进 git，预建只会制造「看起来有结构」的假象。
4. 收尾跑 plan-lint（脚本随 plan 系 skill 安装）：0 发现为初始化完成。

README 模板：

```markdown
---
type: index
date: <YYYY-MM-DD>
status: active
origin: proactive
---

# .plan 工作区索引与流程清单

`.plan/` 是本仓的规划共享记忆（提交入库）。目录约定（契约正本 = 全局 skill `plan-protocol`）：

- `<effort>/spec.md + <effort>/tickets/`（一票一文件）；目录里有 `map.md` 才是 effort，才会被视图加载
- `<effort>/待拍板-*.md` 审批文档默认落所属图；`.plan/` 根层只放全局性拍板
- `ledger/`（全局挂账台账，一账一文件 `挂账-NN-<slug>.md`）；图内台账在 `<effort>/ledger/`
- `qa/`（缺陷一缺陷一文件 `DEF-NN-*.md`，测例 `cases.md` 一图一份；根层 `qa/` 放无图归属的回测产物）
- `.archive/`（整轮归档，由 plan-archive 迁入）

收口纪律：票面终态 = `done`（不分票型，允许附日期）、执行中 = `claimed`（票态词表正本见 §三「票面 `status` 词表」，本节不另立）；收口动作（implement / plan-sync / 测例执行 / 缺陷诊断 / plan-approve）收尾跑 plan-lint，0 发现或当轮修复。

## 指针

- 架构唯一正本：<docs/architecture.md；未设则写「未设」>
- <项目级指针（验收环境 / 契约 / 脚本），随用随补>
```
