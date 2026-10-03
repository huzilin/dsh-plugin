---
name: plan-protocol
disable-model-invocation: true
description: "The plan-ecosystem contract — where each plan skill sits, what it owns, and how they hand off. Load when any of to-spec / to-tickets / implement / implement-spec / plan-sync / to-approval / plan-approve / plan-archive / to-qa-testcases / run-qa-testcases / diagnosing-bugs / plan-loop is invoked, when explaining the flows or the QA defect loop, when asked to init a fresh plan workspace (`.plan/` + `.scratch/`) in a repo, or whenever a session involves code development or code retrieval that reads or writes plan documents (`.scratch/` trackers — specs, maps, issues tickets, per-effort qa/ledger/assets; `.plan/` approvals and global qa/ledger)."
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
问题发现（用户反馈 / code review / 走查 / QA 缺陷升级）→ to-approval → plan-approve（结算＋影响域清单） ──清单驱动──> to-tickets → implement / implement-spec → plan-sync
                                             ↑
                                 依据 = 那份待拍板文档本身
                                 （不新建 spec；effort 未关闭且其 spec
                                 存活时，口径变更回写 spec 走销号分流
                                 ——2026-10-04 E' 拍板）
```

**两条流的分界**：主流程是「**已知要做**，把需求写成 spec 再拆票」；补充流程是「**发现一个问题 / 缺口**，先拍板定论，依据就是拍板文档」。汇合点相同：**拍板结论若要干活，由 plan-approve 在影响域清单登记票项**（`to-approval` 调 `plan-approve`；2026-09-28 拍板——plan-approve **只结算、不落票**），落票由**清单驱动后置**执行：plan-loop「决策已定案但工单未拆」行动行或实施会话按清单项调 `to-tickets`，接回落地链 ②。其余合法落票时机——挂账恢复转票、修复会话按拍板档立返工票——见二·硬规则 1；无论哪个时机，格式一律同源 `to-tickets`。**spec 回写例外（2026-10-04 E' 拍板）**：拍板涉口径变更且目标 effort 未关闭（未随轮归档）时，结论**先回写该 effort 的 spec**（改相应节或追加续批节）并当场销号分流权威文档，再拆票——spec 是归档前唯一变更入口，不得直改权威文档绕过 spec。

### QA 流程（测试与缺陷闭环）

```
to-qa-testcases → run-qa-testcases ──全绿──→ 票写 qa_accepted → 接回落地链收尾
      │                │
      │ 票写 qa_cases   └─有缺陷→ DEF-NN 缺陷档 → diagnosing-bugs 修复（回写 DEF C 节）
      │                                                │
      └────────── 复测 = 同一条命令翻绿 ←────────────────┘
```

**QA 流与两条流的分界**：QA 流挂在实施图（票型 `task`）之后——测例是票的验收面，不是新需求。缺陷档（`DEF-NN`，一缺陷一文件）本身就是返工依据，**不立拍板档**——这是与补充流程的关键分界：补充流程走 `to-approval` 是因为要拍板定论，测试测出的缺陷按类型（`rd` / `fe` / `arch` / `docs`）直接派发 `diagnosing-bugs`。修复完**按 `- 发现源:` 分流复测**（2026-10-02 裁定）：**QA 轮来源**（自动化）回到 `run-qa-testcases` 复测，同一条命令翻绿后关闭；**用户来源**（人工）由 `diagnosing-bugs` 尝试用 E 节复现命令自动复测，跑得通即同路径关闭，**跑不通则如实标 `待复测`**（=「已修，待人验」的完整答案，不得谎写 `已关闭`）。缺陷关闭后票面 `qa_accepted` 才成立；缺陷暴露出需求级分歧时才转 `to-approval`。

---

## 二、每个 skill 的位置与职责

| skill | 流程位置 | 上游 | 下游 | 产出 | 不做什么 |
|:--|:--|:--|:--|:--|:--|
| `grill` / `grilling` | 主流程 ① 输入端 | 用户想法 | `to-approval` | 把模糊决策拷问清楚、问题落文档 | 不写票、不拍板 |
| `wayfinder` | 主流程 ① 输入端（推演地图） | 用户探索 | `to-approval` | `.scratch/<effort>/` 推演地图（map + issues/ + assets） | 不写 spec、不拍板 |
| `to-approval` | ① 与 ② 之间 | grill / 发现的问题 / 裸 id | `plan-approve` | 待拍板文档（正文 `**Status:** pending` ＋ 三字段头 + 原文照抄 + 四要件） | 不拍板、不手写票 |
| `plan-approve` | ① 出口 | `to-approval` | 无（下游由影响域清单驱动） | 逐项核定、录结论、**登记影响域清单（含票项）**、推进文档状态（只翻状态、不搬文件、**不当场落票**——2026-09-28 拍板） | 不发明票格式、不散件归档、不当场调 `to-tickets` |
| `to-spec` | ② 起点 | 决策定案 | `to-tickets` | `.scratch/<feature-slug>/spec.md`（整体写）；**写前读架构正本、写完更新架构正本** | 不拆票 |
| `to-tickets` | ② 第二环（**票格式正本**） | spec / 待拍板文档 / 推演地图 | `implement*` | **一票一文件** `issues/<NN>-<slug>.md`（map 只由 wayfinder 建——2026-09-29 拍板「to-tickets 不自动补 map」，无 map 且无 spec 的目录不被视图加载，plan-lint 校验[2]守门；有 spec 即 spec-only 实施图照常加载） | 不写 spec、不实现、不建 map |
| `implement` / `implement-spec` | ② 第三环 | 票 | `plan-sync` | 实现 + **合并落地时当场回写票** | 不读盘批量翻状态 |
| `plan-sync` | ② 收尾（对账） | 已落地代码 | 无 | 把「看起来已完成、票面没翻」的票找回来、对账后回写 | 不凭人话翻状态、不写票 |
| `to-qa-testcases` | QA 流（测例构建） | 实施图票（`task`） | `run-qa-testcases` | `qa/cases.md`（一图一份）+ 仓库 `qa/` 可执行资产；被测票写 `qa_cases: true` | 不跑用例、不记缺陷 |
| `run-qa-testcases` | QA 流（执行 + 缺陷台账） | `to-qa-testcases` 产物 | `diagnosing-bugs`（有缺陷时）；复测回到本 skill | `test.md` + `DEF-NN-*.md` + 截图；票写 `qa_tested` / `qa_accepted`；收尾跑 plan-lint | 不修 bug、不定位根因 |
| `diagnosing-bugs` | QA 返工环（根因定位 + 修复 + **按来源推动复测**） | 缺陷档 E 节「最小复现入口」 | 自动化来源 → `run-qa-testcases` 复测；人工来源 → 自身尝试自动复测，不行则标 `待复测` | 根因 + 修复 + 回归位；**只回写 DEF 的 C 节**；收尾跑 plan-lint | 不关自动化来源缺陷（复测归 run-qa-testcases）、不跑全量回归、不记缺陷、不改 A/B/E 节 |
| `plan-archive` | ② 之后（整轮归档期） | 已走完的轮（全部成员） | 无 | 整轮归档（目录结构原样）+ sweep 轮外引用 + 标过时/废弃 | 不自动跑、不改代码、不散件归档 |
| `plan-loop` | 循环编排层（跨三条流程） | 全部既有单据 | 轮内按动作表调度各环节 skill | 轮次推进 + Brief + 收口裁决单 | 不拍板、不发明单据格式、不代替 plan-archive 自动归档 |

**交接契约（硬规则）**：

1. **票的格式由 `to-tickets` 独占**——它是落地链的票格式正本 + 被 `plan-approve` 调用的生成器（wayfinder 图内的推演票不走 to-tickets，走 §三的同构 TRACKER-MARKDOWN 契约），输入必须是 spec / 待拍板文档 / 推演地图，不能是裸结论；调它时也要 override 其默认「合并 `tickets.md`」行为，改用一票一文件。**落票的时机是合法集合**，不限字面调用本 skill：①**定案拆票（清单驱动）**——plan-loop「决策已定案但工单未拆」行动行或实施会话按拍板档影响域清单票项（2026-09-28 拍板：`plan-approve` 不再当场调 `to-tickets`）；②挂账恢复转票（见 §三 挂账台账「恢复口径」）；③修复会话按拍板档立返工票。无论哪个时机落票，格式必须与 `to-tickets` 产出一致（一票一文件 + frontmatter `type` ＋ 正文 `**Status:**` / `**Blocked by:**`），plan-lint 兜底校验。
2. **回写发生在两处，是同一件事的两种时机**：`implement*` 在每张票合并落地时**当场**翻状态；`plan-sync` 事后对账补齐。两者不是两套流程。
3. **执行登记（多 agent 并发防混）**：agent 拿到票开工的那一刻必须回写票面——**正文 `**Status:** claimed`** ＋ frontmatter `claimed_by: <agent 名>` / `session: <会话标识>`（DSH 会话写 `session-<uuid>`；zcode 写 `sess_<id>` 或会话名）；wayfinder 票另加 `claimed_at`（RFC 3339，用于判死会话残留），格式契约见 wayfinder `TRACKER-MARKDOWN.md`。票面 session 是页面跳转/串联展示的唯一凭据：DSH 会话可从计划视图直接跳转；外部会话（zcode 等）页面展示名字并提供恢复命令复制（`zcode --resume <id>`）。完工/弃做时同步把状态改为终态，避免长期滞留「执行中」。
4. **`plan-approve` 是「决策 → 影响域清单」的结算点**（2026-09-28 拍板：摘除主动落票）：拍板结论是「做 X」时，必须在影响域清单登记票项（条目 → 归宿 + ☐），否则结论只是聊天记录，下次会话丢失；落票由清单驱动后置执行——plan-loop「决策已定案但工单未拆」行动行或实施会话按清单项调 `to-tickets`（格式独占不变）。挂账恢复转票与修复返工票是另外两个合法落票时机（见规则 1），不需要先有拍板文档在手——依据分别是台账「恢复口径」与拍板档结论。**结算会话内禁止加载/调用 `to-tickets`**（2026-10-04 用户指令，抢跑实证：grill 会话进行中、Q1 待原型走查，结算 agent 在部分裁定落地时即调 to-tickets）——部分裁定不构成落票触发，档有未决项保持 `pending`，立票在档翻 `closed` 后按清单项显式触发。**销号的适用条件＝存在对应 effort 的 live spec**（2026-10-04 E' 拍板边界）：grill 中无 effort spec 的拍板（词汇/ADR 类、图内拍板）无销号流程，结论 inline 落盘即闭环。
5. **架构正本（如 `docs/architecture.md`，项目自declare「全局架构唯一正本」者）是全局架构唯一最新事实**：`to-spec` 写前读、写完更新；`plan-approve` 拍板若改变了架构事实，**末步改目标 effort 的 spec 相应节并当场销号分流**（2026-10-04 E' 拍板：变更入口单一化为 spec，不再直改权威文档——effort 已归档或无存活 spec 时才直改正本）。它不新建——已存在就维护。
6. **QA 缺陷环不经过拍板**：缺陷档（`DEF-NN`）是返工依据，修复交 `diagnosing-bugs`（按 E 节「最小复现入口」契约，修复只回写 C 节），**复测按 `- 发现源:` 分流**（QA 轮来源回 `run-qa-testcases` 同命令翻绿；用户来源由 `diagnosing-bugs` 尝试自动复测，跑不通标 `待复测`——2026-10-02 裁定）；票面 `qa_cases` / `qa_tested` / `qa_accepted` 三标记由测试两 skill 写入，验收条件 = AC 全过 + 该票无未关闭缺陷；缺陷暴露需求级分歧时才转 `to-approval`。

---

## 三、文档形态约定（插件能读的前提）

- **目录布局总则（2026-09-28 目录迁移令，tracker 类回归原版 local 布局）**：**tracker 类对象（spec / map / issues 票）落 `.scratch/<feature-slug>/`**；**审批文档（拍板）留 `.plan/`**（原版 grilling 本就落 `.plan/`，迁移令不改其语义）。其余按「官方有 / 官方无」分流：
  - 官方有的（`spec.md` / `map.md` / `issues/NN-<slug>.md`）→ `.scratch/<feature-slug>/`；
  - 官方没有、**与 effort 挂钩**的（qa / ledger / assets）→ `.scratch/<feature-slug>/qa|ledger|assets/`（轮内成员，随 effort 整轮归档）；
  - 官方没有、**全局性**的（属「全局件」封闭清单，定义见下文「全局件」条）：审批档留 `.plan/approval/`（2026-09-30 收拢拍板）；全局缺陷与回测测例、全局挂账台账常驻 `.plan/qa|ledger/`（2026-09-29 拍板：归档 = effort 全消后的轮归档，不为它们单设归档时机）；**全局审批档与之不同——它搭 effort 归档的车**（2026-10-02 裁定：归档 effort 时把已翻 `archived:` 标的全局 approval 合并到一起归档）；调研 / 复盘文档 → `docs/research/`（挂文档树，三字段头 ＋ 正文 `**Status:**`）——**全局场景但非全局件**，不落 `.plan/`；
  - 一次性杂项（交接 handoff / 审计 audits）→ `.tmp/handoffs/`、`.tmp/audits/`（出仓出检索面；有留存价值转 `.archive/` 或 `.plan/`，不默认驻留）——同为全局场景、非全局件。
  - **`.plan/` 下无 effort（2026-09-29 二次拍板，取代同日「存量旧布局可读」兼容）**：effort 的唯一合法落点是 `.scratch/<slug>/`——`.plan/` 的子目录一律不构成 effort，**无论是否含 `map.md`**（视图对 `.plan` 关 effort 扫描；`.plan/` 下识别出 map/spec 即数据违例，由 plan-lint 报、迁移票迁 `.scratch/`，视图与工具不再迁就旧布局）。「存量迁移撤出施工范围」（2026-09-29 早间裁定）就此反转：存量 `.plan/<effort>/` 视为违例数据，迁完即合规。
- **全局件（2026-09-29 拍板，封闭清单正本；审批成员 2026-09-30 收拢拍板目录化；生命周期 2026-10-02 二分）**：**跨图 / 无 effort 归属、常驻 `.plan/`** 的 plan 生态单据。清单**封闭**为三件：
  1. **全局性审批档**：`.plan/approval/待拍板-*` / `已拍板-*`（2026-09-30 收拢拍板：由 `.plan/` 根层散放收拢为独立 `approval/` 子目录，与 effort 内 `approval/` 同形；根层前缀形状仅存量兼容，新写一律入目录——落点细则见「审批文档归属」条）；
  2. **全局缺陷与回测测例**：`.plan/qa/DEF-*.md` + `.plan/qa/cases-<主题>.md`（无图归属件，见「缺陷条目」「测例文档」条）；
  3. **全局挂账台账**：`.plan/ledger/挂账-NN-<slug>.md`（见「挂账台账」条）。
  - **封闭含义**：新全局场景入清单须修订本协议（经拍板），不得自行在 `.plan/` 下新落子目录；plan-lint 对 `.plan/` 做封闭清单守门（检查[6]：清单子目录 = `approval/ qa/ ledger/`；2026-09-29 拍板 + 2026-09-30 审批成员目录化）。
  - **全局 ≠ `.plan/`**：调研/复盘（`docs/research/`）与一次性交接/审计（`.tmp/`）同为全局场景，但**不是全局件**——各有归宿与生命周期（research 用 `status: active/closed`，不占 `.plan/`）。
  - **判据归属（2026-09-29 二次拍板）**：全局件目录（`approval/`、`qa/`、`ledger/`）**不参与 effort 判据**——它们是全局件锚点不是图；目录内**不得内嵌 map.md/tickets/**（历史遗留内嵌图=违例数据，迁 `.scratch/<slug>/`，如 novel「全页面人工验收测线」图 2026-09-29 迁出）。`.plan/` 下任何子目录含 `map.md`/`spec.md` 均按违例报，视图不加载。写侧唯一合法 effort 落点仍为 `.scratch/<slug>/`（不变）。
  - **生命周期（2026-10-02 二分，取代旧统一表述）**——全局件分两组，归档行为不同：

    | 组 | 成员 | 归档行为 |
    |:--|:--|:--|
    | **常驻组** | `.plan/qa/`（全局缺陷＋回测测例）、`.plan/ledger/`（全局台账） | **永不随轮搬**——常驻、非轮成员 |
    | **搭车组** | `.plan/approval/`（已翻 `archived:` 标记的全局审批档） | **随 effort 归档一并搬走**（2026-10-02 裁定：「归档 effort 时，同时把全局的 approval 合并到一期一起归档」）；判别器同 G1 = 标记本身 |

  - **全局台账/qa 不进入**归档前置判据③的清账范围（判据③只清图内台账）——全局挂账长期「在挂」不阻塞任何轮归档；**其清账由 `plan-loop` 的全局件行动行驱动**（2026-10-02 裁定：不再依赖无人认领的「扫描启动纪律」，改为明确归属方——见下条「全局件推进入口」）。
  - **全局件推进入口（2026-10-02 裁定）**：全局件不属于任何图，**图收口时天然被跳过**，故**唯一认领方 = `plan-loop` 的全局件行动行**（全局缺陷、全局台账、全局测例各一行，与图内同类同池排序、同规推进）。这是对上一条「独立驱动」的归属补全——此前协议说了纪律却没说谁执行。
- **一票一文件**：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`。**禁止**把多票写进一个 `tickets.md`／`issues.md`——按文件读取的一方会把合并文件当成**一张票**，里面所有票丢失。
- **目录契约守门（plan-lint 检查[8][9] · 2026-09-30 拍板，plan-lint-gate 票 16；判据正本 = 各仓 `docs/research/梳理-plan目录写入矩阵-20260930.md` 两层 tree）**：
  - **检查[8] effort 目录白名单**：effort（`.scratch/<slug>/` 含 map.md 或 spec.md）的直接子目录封闭清单 = `issues / assets / approval / qa / ledger / prototype` ＋ 存量只读兼容 `tickets / impl / impl-fe`（历史路径不得清理）；清单外自建子目录报 `effort-dir-whitelist`——视图按契约不收集，产物按写入矩阵归 `assets/` 等合法落点。**`prototype/`＝原型产物目录（2026-10-04 拍板）**：prototype skill 的产物（UI 自包含单文件 html／LOGIC 脚本＋README）落此，随 effort 整轮归档；spec／票面按相对路径 `prototype/<name>.html` 引用；plan-view effort「原型」tab 展示（视图侧 = plan-lint-gate 票 24）。
  - **检查[9] `.plan` 根层文件形状**：全局审批档正本落点 = `.plan/approval/`（2026-09-30 收拢拍板），根层 `.md` 一律违例（README 层级说明档豁免），报 `plan-root-shape`——审批档入 `approval/`，其余按写入矩阵分流 `docs/research/`、`docs/requirements/`、`.tmp/`、effort `assets/`。子目录白名单归检查[6]管。
- **状态以正文行为准**（2026-10-02 拍板 Q10=乙，取代旧「frontmatter 是权威」条）：票的 `Status:` **写在正文首部**；`type` 留 frontmatter；**阻塞边写正文 `**Blocked by:**`**。解析方一律读正文行。
  - **唯一例外是 `type`**：它不回答「走到哪了」，只回答「这是什么单据」，且视图靠它分流（`type: approval` / `qa-defect` 等），故留 frontmatter。
  - 旧文里「不读正文表格」的告诫仍成立——**读的是正文的固定行（`**Status:**` / `**Blocked by:**`），不是表格**。
- **阻塞边格式**（2026-10-02 拍板改正文行；唯一格式，**裸写、不加引号**）：写正文 `**Blocked by:**` 行——
  - `**Blocked by:** None — can start immediately`：无前置（**唯一合法空值**；不得写 `[无]`、`none`、留空）
  - `**Blocked by:** 03`：单个前置；`**Blocked by:** 03, 04`：多个前置，逗号+空格分隔
  - **禁止加引号**（`["03"]`、`['03']`）——工具侧解析器（`splitNums`）对引号不容忍，会致**整图解析中止**；本插件读取层虽容忍引号，但**正本格式一律裸写**，容忍不等于合法
  - **票 id 形态**：本仓票用两位数字（`03`）；带字面前缀的票（如 `AIT1`、`OPT3`）直接写前缀全称，不加引号
  - **执行票与推演票共用同一格式**（推演票的完整契约见 wayfinder `TRACKER-MARKDOWN.md`）；**禁止另立第二种写法**（协议与 wayfinder 两侧曾各写一套、致 27 处带引号票在工具侧整图中止，2026-09-27 收口）。2026-10-02 载体由 frontmatter 改正文行——**旧 frontmatter `blocked_by:` 写法作废**。
- **文档分层（五层，两类生命周期 · 2026-09-27 拍板）**：`plan` 生态里的文档按**权威寿命**分五层，**新内容该写哪里，按层判**：

  | 层 | 文档 | 写什么 | 寿命 |
  |:--|:--|:--|:--|
  | **长期权威** | ①`arch` 总纲 | 全仓唯一，写「系统是什么」 | **持续维护、永不退役** |
  | **长期权威** | ②领域文档 | 每域一份，写「本域内怎么定义／怎么算」 | **持续维护、永不退役** |
  | **长期权威** | ③需求文档 | 写「用户要什么」 | **持续维护、永不退役** |
  | **一次性** | ④`spec.md` | 写「这一批怎么做」 | **随 effort 生命周期；effort 关闭后作废并归档** |
  | **过程** | ⑤拍板档／推演图／票／开放项记录 | 过程留痕 | → `.archive/`，**不承担权威** |

  - **一句话判据**：**长期权威是「现在是什么」，spec 是「这一批怎么改」。** 前者读完要能脱离 spec 独立读懂；后者用完即废。
  - **需求文档（新文档类，2026-09-27 拍板）**：`type: requirements`；落点 `docs/requirements/<effort>-<主题>.md`；**文件名必须含 effort slug**（＝`.scratch/<slug>/` 目录名，故需求文档与 effort **同名可检索**）。承载**用户故事／Problem／Solution／验收与测法／范围外**。同一 effort 可按主题拆多份，但**每份都带 effort slug**。
  - **横／纵判据（决定写 `arch` 还是领域文档）**：内容回答「**系统各部分怎么相连**」→ **横向** → `arch`；回答「**本域内部怎么定义／怎么算**」→ **垂直** → **领域文档**。同一节常横纵兼有，**故一个归宿可指向多处**；**DDL 归领域文档**（数据模型是领域模型的一部分）。
  - **长期权威自指（修正现状反置）**：**长期文档自身即权威**（它是现行事实），**不得把 `spec` 声明为「真相源」**——spec 一作废，该权威依据即悬空。对 spec 的指针**改称「决策来源」**（记「为什么这么定」；spec 归档后指针指向归档路径）。
- **`spec` 生命周期与归宿行（2026-09-27 拍板；2026-10-04 E' 拍板修订退役时点与变更入口）**：`spec.md` 是**一次性实施文档**兼 **effort 归档前的变更总线**，**随 effort 生命周期**——落点 `.scratch/<feature-slug>/spec.md`（2026-09-29 目录迁移）。
  - **关闭 effort（＝随轮归档，G4）后，spec 整体作废并归档**；作废前必须先把内容按**五类归宿**分流出去。**effort 票尽 ≠ effort 关闭**（2026-10-04 E' 拍板取代 2026-09-28「票尽必标」）：票全终态时 spec 合法存活，后续续批拍板/缺陷口径回写 spec；
  - **五类归宿**：①测试决策（接缝／门禁／为什么这么测）→ **需求文档**（附「验收与测法」节）；②Out of Scope → **需求文档**（附「范围外」节）；③实现细节 → **docs**（横向→`arch`／垂直→领域文档）；④数据底座 DDL → **领域文档**；⑤开放项回填记录等过程物 → **归档**（`.archive/`）；
  - **归宿行机制（完成标准）**：spec **每节**须有一行归宿行，取值只能是四种之一——`→ arch §X` ／ `→ docs/<file> §Y` ／ `→ 需求文档 <path> §Z` ／ `→ archive（过程物）`。形态写在该节标题下：
    ```markdown
    > **归宿（<YYYY-MM-DD>）**：→ arch §7.5 ＋ docs/<file> §3
    ```
  - **「更新完成」＝ spec 每节都有归宿行，且指向的目标确实存在。** 语义判断仍要做一次（不可免），但**完成与否由此可机械判定**，且**它同时就是「spec 可否作废」的凭据**——归宿行齐全 ⇒ 可作废；缺失 ⇒ 不可作废；
  - **取代登记（2026-10-04 E' 拍板取代 2026-09-28「票尽必标」，plan-lint 校验[5]）**：spec 标 `superseded-by:` 的合法时点＝**effort 归档（G4 前置判据④）**；提前标注而 effort 仍有未终态票＝**中途退役**，plan-lint 报 `premature-supersede`（novel 2026-10-03 事故病灶：spec 死后十票无收纳点，收口票 sweep 清单漏圈权威文档）。注记写法不变（2026-10-02 拍板）：**无头 spec**（正本形态）写**首行 HTML 注释** `<!-- superseded-by: <归宿> -->`；有头文档写**正文首部 `**Status:** superseded-by:<归宿>`**（首选）或**头部 10 行内**引用块。**取代声明必须头部机械可检索**，埋正文深处不算（doc-authority 复盘实证：23% 标记可检索率正是旧病）；正文「提及」他人被取代不算自身已标。销号清单全清的机械校验为加法项待立项；
  - **时点**：docs 更新钉在「**变更落 spec 那一刻**」——spec 定稿（`to-spec` 现有动作）与后续每次续批变更（E' 销号分流）都当场 apply，**不等到「关闭 effort 后」**（那时上下文已散）。
  - **变更总线与销号清单（2026-10-04 E' 拍板，novel sweep 漏圈事故闭环）**：effort 未关闭期间，**一切口径变更（续批拍板/缺陷修复方案）先改 spec 相应节（或追加续批节），再当场分流权威文档**——不得直改权威文档绕过 spec（变更入口单一化）。分流动作走**销号清单**：spec 附「分流清单」（节×归宿目标逐行列出），逐项适配、逐项销（形态对齐拍板档影响域清单销号）；清单全清＝spec 可退役凭据（归宿行机制的 checklist 化）。执行归属：`plan-approve` 结算涉架构/领域事实变更时，末步改 spec 并销号（取代「末步直改架构正本」）。
- **文档头三字段 ＋ 正文状态行**（2026-10-02 拍板「全文档统一走正文行」，Q10=乙）：
  - **frontmatter 保三字段**：`type` / `date` / `origin`。**状态不进 frontmatter。**
  - **状态写正文首部的固定行**：`**Status:** <值>`（票/审批档等）。为什么在正文——状态是读者打开文件第一眼要找的东西，且同一份文档不该让「值」和「载体的形态」分居两处。
  - `origin`：产生原因（`readability-rescue` / `proactive` / `review` / `retrospective`）。
  - **`archived:` 归档标记仍写 frontmatter**（它是「已归档」这一事实的机器可检索标记，与状态机无关，见 §四「归档标识」）。
  - **审批档 `status` 五态**：`pending` / `closed` / `superseded-by:<path>` / `active` / `abandoned`，写正文 `**Status:**` 行。**禁止「待拍项已作废却仍留 pending」**。
  - **`superseded-by:<path>` 是路径值**，必须写在**正文首部 10 行内**（机械可检索），埋正文深处不算。
- **无头文档（2026-10-02 拍板）**：**spec.md 是无头文档**——`to-spec` 的产出模板自 `## Problem Statement` 起，无 frontmatter、无 H1、无状态行；该形态**与上游 mp 原版逐字一致**（2026-10-02 对拍 `/Users/huzilin/workdir/skills/skills/engineering/to-spec/SKILL.md` 确认），属原版既定行为，**不改模板、不补头**。上表 spec 行原写的「frontmatter `type`/`date`/`origin` ＋ 正文 `**Status:**`」**对本类不适用**，已由本条取代。
  - **标记一律用头部注释**：无头文档的**任何头部标记**（`archived:` / `superseded-by:`）**不用 frontmatter，改写在文件首行的 HTML 注释**——格式 `<!-- <键>: <值> -->`，如 `<!-- superseded-by: docs/architecture.md -->`、`<!-- archived: <round-id> -->`。**位置在首行**（正文第一行之前），保证任何 agent 直读第一眼可见、机器可 grep；埋正文深处不算。
  - **为什么用注释而非补头**：spec 是**一次性过程物**（effort 关闭即作废归档），不是长期权威；给它补 frontmatter 会把「过程物」伪装成「有状态头的正式单据」，与「spec 不承担权威」的既有口径相悖。注释是「顺带标一笔」的形态，与它的生命周期地位相符。
  - **凡无头文档的判定**：首行不是 `---` 的治理文档即无头类；其状态/标记**只读注释行与正文**，不读 frontmatter（本就没有）。
  - **`superseded-by:` 的机械检索**：无头 spec 的取代声明**同时认**首行注释与**正文首部 10 行内**（两个位置任一命中即算），与有头文档同规，埋深处不算。
- **审批文档归属（两级，2026-09-29 拍板；全局成员 2026-09-30 收拢拍板）**：**grill-with-doc / wayfinder 生成**的审批档落**所属 effort** 的 `.scratch/<effort-slug>/approval/待拍板-<slug>-<date>.md`（独立 `approval/` 目录——随图归组展示、随 effort 归档）；**全局性审批**（跨图 / 无 effort 归属，如治理类拍板）落 **`.plan/approval/`**（2026-09-30 收拢拍板：由 `.plan/` 根层散放收拢为同名独立子目录，与 effort 内 `approval/` 同形；全局件之一，见「全局件」条）。**落点参数化与声明契约（同日拍板 A）**：to-approval 调用必传 `<effort-slug | global>`（人工无参时问归属，不静默推断——`disable-model-invocation` 防自发不防明文，plan-loop / 子代理等明文调用同规）；图内档 frontmatter 加 `effort: <slug>` 声明、全局档不带（路径即声明），plan-lint 检查[10] `approval-scope` 机械校验声明与落点一致；plan-loop 收口裁决单**默认落 `.plan/approval/`**（跨图收口产物，2026-09-30 拍板「plan-loop，默认就放到 .plan/approval/」）。挂账恢复转票进某图时，其关联拍板**随迁同图**（与挂账「恢复口径」联动，见挂账台账条）。存量兼容：09-29 迁移提根层至 `.plan/` 根的档已于 09-30 收拢进 `.plan/approval/`（本仓实证）；根层 `待拍板-*`/`已拍板-*` 前缀形状仅存量兼容读取（plan-lint 检查[9] 对根层报违例驱动迁移），旧布局 `.plan/<effort>/待拍板-*` 不再有（视图对 `.plan` 关 effort 扫描后此类档入全局 approval/ 组）。
- **effort 标志**：`.scratch/` 下目录里有 `map.md` 才被当作 effort 加载；没有 `map.md` 的 `issues/` 目录不被读取（2026-09-29 议题①裁定：map.md = 文件、effort = 目录、判据 = 目录含 map.md，判据不变、目录根从 `.plan/` 改 `.scratch/`）。**2026-09-29 拍板扩展**：目录无 `map.md` 但含 `spec.md` = **spec-only 实施图**，同被视图加载（to-spec/to-tickets 直出的 effort，无路线 Destination，工单/审批子页照常）；视图加载与 plan-lint 检查[2] 的判据同步为「含 map.md **或** spec.md」，且**只在 `.scratch/`（与归档轮目录）生效**——`.plan/` 下不加载任何 effort，细则见「全局件」条。
- **非治理目录**：一次性交接 / 审计产物落 `.tmp/handoffs/`、`.tmp/audits/`（2026-09-28 拍板 6b）——不属 plan 生态，视图不加载、`plan-lint` 不扫（`.tmp/` 在仓根，本就在两个治理目录之外）；存量 `.plan/handoffs/`（历史轮快照）只读兼容，plan-lint 豁免（不查缺 map / 文档头 / 同票双档）。
- **图二型**（插件按票型自动分组展示，无需文档声明）：**推演图**（票型 `research`/`prototype`/`grilling`，终点=决策清零，wayfinder「Plan, don't do」）与**实施图**（票型 `task`，终点=落码验收）。落地工单 `type` 一律写 `task`——**唯一合法值**（2026-09-27 拍板：`impl` 不支持、不识别）。
  - **`impl` 不是票型（2026-09-27 拍板）**：`impl` 源自早期 novel 的目录名（`.plan/<effort>/impl/`、`impl-fe/`），后被误用为 `type` 值沿用；三处正本（本协议、`to-tickets` 票模板、wayfinder `TRACKER-MARKDOWN.md`）**均未将它列为合法票型**。**新写票一律 `task`**；存量 `type: impl` 票由「形态契约变更回扫」条款迁移——**未迁移前该票不被识别为工单**。注意 `impl` 另有两个**非票型**身份，不可混淆、不得清理——插件内部类型名 `MapKind='impl'`（实施图分组标识）与历史目录路径 `impl/`、`impl-fe/`。
- **票面 `Status:` 词表**（2026-10-02 拍板 Q1/Q4，**三值**，写正文 `**Status:**` 行，不分票型全票统一）：
  - `open`（票已建、无人做）→ `claimed`（有 session 在做）→ `resolved`（已解决，终态）。允许附日期 `resolved <YYYY-MM-DD>`。
  - **载体与词表均为唯一一套**——原「frontmatter 形态 / wayfinder 推导形态」两形态并存的做法已废止（原版明文只认正文 `Status:` 行，见 wayfinder `TRACKER-MARKDOWN.md`）。
  - **`out_of_scope` 不是 `Status:` 的第四个取值**：它由 `## Ruled out` 带正文**派生**，只存在于「收束」这一维度（见「四套状态机」表）。收束优先读，故已收束票上的 `Status:` 行是惰性残留，**不得改写成 `resolved`/`out_of_scope`**。
  - **登记格式**：开工那一刻写 `**Status:** claimed` ＋ frontmatter `claimed_by: <agent 名>` ＋ `session: <会话标识>`（DSH 写 `session-<uuid>`；zcode 写 `sess_<id>` 或会话名）——见「执行登记」硬规则。
  - **本条只管「票」——四套状态机互不套用（2026-09-27 拍板）**：`type` 词表里有状态概念的共四类，但**分属四个坐标系，词表不得互相套用**：

    | type | 载体 | 词表 | 回答的问题 |
    |:--|:--|:--|:--|
    | `task` / `research` / `prototype` / `grilling` | 正文 `**Status:**` | `open` / `claimed` / `resolved` ＋派生 `out_of_scope` | 这张**票**走到哪了 |
    | `approval` | 正文 `**Status:**` | `pending` / `closed` / `superseded-by:<path>` / `active` / `abandoned` | 这个**提问**结案了吗 |
    | `ledger` | 正文 `- 状态:` | `在挂` / `已销` / `已转票` | 这笔**债**还了吗、转移到哪了 |
    | `qa-defect` | 正文 `- 状态:` | `待修复` / `已确认` / `修复中` / `待复测` / `已关闭` / `挂起` | 这个**缺陷**修好并复测通过了吗 |

    **载体已统一到正文行**（2026-10-02 拍板 Q10=乙）；**词表仍互不套用**（四类各答各的问题）。

  - **不得统一**：`approval` 的 `closed` 不可改写为 `resolved`——它会抹掉 `superseded-by`（被取代）与 `abandoned`（不问了）的区分，而这两个态正是「防止已作废的待拍项滞留」的依据；`ledger` 的「已转票」不可改写为 `resolved`——**「债务已还清」与「债务转移给他处」是两件不同的事**，混同即账目错误。
  - **正文状态行是解析契约**：`ledger` / `qa-defect` 的状态写在**正文固定字段行**，是插件台账页／缺陷页与 agent 扫描的解析契约，**不得改形**（见「挂账台账」「缺陷条目」两条）。
  - **判据**：**同一坐标系才可统一**——`task` 与三个推演票型同属「票」，故共用一套票态（三值）；其余三类各答各的问题，**跨坐标系套用词表即语义塌陷**。
  - **缺陷/台账的正文行是「状态机制判据」的明文例外**（2026-10-02 Q13）：它们的值**内容推不出来**（是人工推进的路由事实），按判据本该进 header，但**插件解析契约优先**——**不得以判据为由把它们的字段行改形或搬进 frontmatter**。
  - **收口口径**：票态**只有本条一处定义**（README 模板等处的复述须与本节一致）。
- **`type` 取值约定**：`task`（落地工单）、`approval`（待拍板）、`research` / `prototype` / `grilling`（推演地图节点）、`ledger`（挂账台账）、`qa-defect`（QA 缺陷条目）。**这份清单即 `type` 的唯一合法词表**——`impl` **不在其中**（2026-09-27 拍板：不支持该类型，见「图二型」条），这是 2026-09-27 收口前的协议内部矛盾点，现予消除。`type` 值不在上表的文件按说明/杂项解析，不作单据校验对象。完全无 `type` 也无状态行的文件归「说明 / 杂项」类；无 `type` 但有状态行（正文 `**Status:**`，或存量 frontmatter `status:`）的存量手写票按其状态归工单（兼容形态，新写票一律带 `type` ＋ 正文 `**Status:**`）。
- **缺陷条目**（`type: qa-defect`，**一缺陷一文件**）：图内 `.scratch/<effort>/qa/DEF-<effort-slug>-NN-<slug>.md`（编号全局唯一 `DEF-<effort-slug>-NN`，2026-09-28 拍板；存量 `DEF-NN` 短号等价兼容），frontmatter 仅 `type: qa-defect` ＋ `date`/`origin`（**无状态字段**，2026-10-02 拍板 Q11「按正文，单写」；`superseded-by:` 为可选保留字段），正文 `# DEF-NN 标题` + 固定字段行 `- 严重度:`、`- 类型:`（rd/fe/arch/docs）、`- Assignee:`、`- 状态:`（待修复/已确认/修复中/待复测/已关闭/挂起，取首词匹配、允许附注）、`- 关联用例:`、`- 发现源:`、`- 测试设计缺口:`，其后 A~E 五节（E 节最小复现入口必填——骨架正本见 run-qa-testcases `references/qa-records-skeleton.md`）。
  - **串联**：缺陷与票/挂账的串联靠详情文本写「票 NN」「挂账-NN」。
  - **识别**：qa 目录内不带 `type: qa-defect` 的文件不被视图识别；旧「单文件多小节」形态（`qa/defect.md` 清单总览表）只读兼容——归档轮快照是旧形态，现行一律一缺陷一文件。
  - **无图归属的缺陷**（SOP 回测、整页回测发现，挂不到具体工单/图）：落根层 `.plan/qa/DEF-*.md`（同格式），进第一层「测例&缺陷」tab。
  - **登记正本与用户直报**：缺陷档登记正本 = run-qa-testcases 的 `references/qa-records-skeleton.md`——字段行枚举、A~E 五节骨架、E 节「最小复现入口」的登记纪律以它为准。**用户直报缺陷（不经测试轮）**：会话按该正本立档，`- 发现源:` 按下条人工标记纪律、`- 测试设计缺口:` 必填，E 节复现命令须真跑一次取得红色输出（`diagnosing-bugs` 零重建接单的前提），立档收尾跑 plan-lint，按类型派 `diagnosing-bugs`；执行轮登记、复测、回归基线与台账关闭仍归 run-qa-testcases 主流程，本条只覆盖不经测试轮的直报。
  - **发现源人工标记纪律（2026-09-22 拍板）**：人工发现的缺陷（用户直报、验收走查、用户发现后 AI 协查定位均属之）`- 发现源:` 固定写「用户（人工发现；<语境附注>）」——novel 存量「用户（人工走查）」（DEF-01~08 先例）为等价历史形态；**禁止裸写「用户」**，并附验收文档指针；复盘按发现源透视人工发现率与 agent 走查盲区。
- **测例文档**：图内 `qa/cases.md`（`.scratch/<effort>/qa/cases.md`）**一图一份、不拆文件**——测例是批量设计文档（§0 被测对象/八源盘点/覆盖矩阵为共享上下文），由插件按路径识别为 `cases` 类单列「🧪 测例」子页，无需 frontmatter。每条测例**必须有唯一编号** `<腿前缀>-NN`（协议腿 D-NN / 呈现腿 P-NN / API 腿 A-NN），以可 grep 的固定形状出现（`### <编号>` 标题或表格行首列），禁止只存在于段落行文中；执行记录同文件按轮次追加（「末轮为准」，不开新文件），`run-qa-testcases` 支持按编号子集精确重跑（`--cases P-13,P-07`）（2026-09-28 六条批复 4/5）。
  - **测试标记写回票面**：`to-qa-testcases` 产出 cases.md 后给被测票写 `qa_cases: true`；`run-qa-testcases` 执行完写 `qa_tested: true`；验收通过（AC 全过 + 无未关闭缺陷）写 `qa_accepted: true`——三标记在票卡/详情以徽标展示。
  - **无图归属的回测测例**（SOP 回测、整页回测，挂不到具体工单/图）：落根层 `.plan/qa/cases-<主题>.md`（一主题一文件、不拆单），进第一层「测例&缺陷」tab；能挂到工单/图的测例放图内 `qa/cases.md`。
- **调研 / 复盘文档落点（2026-09-28 六条批复 1）**：`.plan/` 专门放审批文档，**调研/复盘不进 `.plan/`**——落 **`docs/research/<name>.md`**（挂文档树、文档地图可指；frontmatter `type: research` / `retrospective` ＋ `date`/`origin`，正文 `**Status:** active/closed` 区分在役/留档）。存量 `.plan/调研-*`、`.plan/复盘-*` 不自动迁移（归存量迁移推进）。
- **挂账台账**（`type: ledger`）：**每项目各自管账**——在哪个项目干活挂的账记哪个项目的台账，不跨仓寄挂；发现挂错仓的条目：原台账原地留痕销账（标注迁出去向），新台账迁入注记（维持原状态），不静默消失。
  - **两级 + 一账一文件**：**全局台账目录**=`.plan/ledger/`（plan 级跨图债务正本，收跨图/环境/架构类条目，常驻 `.plan/`——2026-09-29 拍板全局件不随轮走）；**图内台账目录**=`.scratch/<effort>/ledger/`（收明确属于该图的条目，随所在 effort 整轮归档——轮内成员）。一账一文件：`挂账-NN-<slug>.md`，frontmatter 仅 `type: ledger` ＋ `date`/`origin`（**无状态字段**——状态由正文 `- 状态:` 行走，见下），正文 `# 挂账-NN 标题` + 固定字段行 `- 状态:`（在挂/已销/已转票）、`- 卡点:`（为什么现在做不了/不做）、`- 启动条件:`（什么情况可以开展）、`- 来源:`（何时谁挂的）——字段行是插件台账页与 agent 扫描的解析契约，不得改形，**且是状态的唯一载体**（与缺陷同规：`- 状态:` 单写，frontmatter 不放状态）。
  - **归属判据**：来源或恢复落点明确指向某张图的归图内，全局性条目留全局，拿不准的留全局（宁少拆不错拆）。插件视图：第一层「台账」页=全局台账，地图内「台账」子页=该图图内台账。
  - **销账**：在**条目文件自身**改 `- 状态:` 并在正文追加销账注记（日期/去向/证据或 commit），不留静默消失；旧「单文件多小节」形态（`.plan/挂账台账.md` 内 `### 挂账-NN` 小节）只读兼容——归档轮快照里是旧形态，现行一律一账一文件。
  - **agent 扫描启动纪律**：开工/收口时两级台账都扫，逐条对照「启动条件」与当前现状，已满足的项当场启动（按拍板落地协议立票或处理）；启动条件未满足的项不许提前动。
  - **恢复口径**：条目**到达实施阶段**（启动条件满足、要真干活）时**恢复到该条目来源所在的原有 map 立票**——不新开 effort、不另起一张图；恢复后在「来源」字段注记恢复落点，条目 `- 状态:` 改「已转票」并在文件正文留痕；原图若已 `status: closed` 随之重开 `active`（收口条件=该图全部票 resolved，届时再翻 closed）。
  - **阶段化状态机**：图内台账条目可含 `- 阻塞: <票NN, 票NN,…>` 字段（结构化依赖，**只允许引用同一张图的票**——依赖节点保证都在 map 中；全局台账跨图/无票依赖不写此字段，启动条件人工判断）。状态词据此分段：`- 状态:` 用 **阻塞中**（有阻塞字段且依赖票未全 resolved）/ **可启动**（无阻塞字段，或依赖票全部 resolved）。
  - **implement 重算条款**：implement/plan-sync 收口翻完票状态后，必须重算本图 `ledger/` 与全局台账中带 `- 阻塞:` 的条目——依赖票全部 resolved 即把状态词写回「可启动」（附注触发票号），agent 扫描启动条件时读文件即得，不再现算。计划视图按依赖票状态实时计算并展示阶段（写回延迟不影响页面正确性）。
  - **引用带号纪律**：行文、镜像台账、轮次简报凡指称挂账一律写「挂账-NN」编号（编号以台账文件名与 H1 为准），禁止只用绰号（如 ENV-2、B-3）指称；历史绰号引用须括注编号，镜像与正本编号保持一致。
- **轮内互引一律相对路径**：同一轮的文档互相引用，写相对路径（相对当前文件），不写 `.scratch/...`／`.plan/...` 开头的根相对路径、不写绝对路径。轮收尾后 `plan-archive` 把整轮迁入 `.archive/rounds/<round-id>/`，目录结构原样，相对引用随整树搬迁存活；根相对/绝对引用会断。轮内引用轮外正本不受此限（正本不搬）。
- **形态契约变更回扫**：凡单据形态契约变更——状态头字段、字段行形状、`type` / `status` 词表——变更当轮对存量单据按新契约回扫迁移一次，不得只约束新写文档。本条管**文档形态**的存量回扫；术语的存量回扫由姊妹条款《术语变更双域Sweep协议》管**术语**，两者互不替代。
- **门禁同批更新（2026-10-02 拍板 C）**：**凡改变单据形态或词表的拍板，落地时必须同批更新 `plan-lint.sh` 并重新分发**（改源文件 `skills/plan-approve/scripts/plan-lint.sh` 后跑 `install-skills.sh`，确认全部副本内容一致），不得只改协议文本。协议是尺子的说明书，门禁是尺子本身——**说明书改了、尺子没改，等于门禁替旧形态背书**：任何照门禁修文档的 agent 都会把单据越修越背离新协议，且门禁「全绿」制造假合规信号。就本项而言「协议改 ＋ 门禁改 ＋ 分发验证」三者齐备才算闭环。
  - **成因实证（2026-10-02）**：当日「状态载体改正文行、词表三值」拍板落地时只改了协议文本与各 skill 的 `SKILL.md`，漏改 `plan-lint.sh` 本体。结果门禁仍明文拒绝 `resolved`（要求已作废的 `done`）、仍强制要求 frontmatter `blocked_by`，**与协议方向正面相反**；而门禁当时对此「全绿」，恰因它验的是旧形态。此洞直到下一轮回扫任务书暴露矛盾才被发现——**故本项纪律的价值不在「记得改」，而在取消「记得」这个依赖**。
  - **收口检查挂点**：`plan-approve` / `plan-sync` 收口跑门禁时，若本轮动过 §三形态条款，须核对门禁脚本内容是否同期变更；`plan-loop` 盘点「已拍板未认领」清单时，形态类拍板须核门禁已同批更新。
- **术语残留断言（plan-lint 检查[7] `terms-residue` · 2026-09-29 拍板，novel 术语 sweep 移交方案 C，plan-lint-gate 票 13）**：词表驱动的**全仓活面**残留断言。各仓维护一份机器可读词表（约定名 `terms.txt`，落点各仓自定，novel 拟 `tools/terms.txt`）——它就是术语 SOP「废弃词枚举清单」步骤的机器可读形态。**「验」归本检查（只读断言无标记残留=0），「改」（sweep 替换动作）归各仓术语 SOP**，不进 plan-lint。
  - **调用**：`plan-lint.sh [--terms <词表> --terms-roots <dir,dir,…>] [治理目录…]`（选项在治理目录之前）。不带 `--terms` 时检查[7]整体跳过（无词表仓零影响）；`--terms-roots` 缺省＝当前目录全扫——治理目录之外也要扫，残留散布 be/fe/docs/README/CONTEXT 等全仓活面。带 `--terms` 且找不到治理目录时跳过检查[1]-[6]只跑[7]。
  - **词表行格式**（词为固定串，grep -F 语义）：`词`；`词<TAB>标记1|标记2`（本词专属合法留痕标记）；`旧词 => 新词`（建议替换方向，残留报告随之给出——调词汇表后走本检查确定如何替换）；`@mark 标记1|标记2`（扩充全局标记集）；`#` 注释。
  - **留痕豁免**：全局内置默认标记集 20 个（novel `protocol_driver.py` d4() MARKS 2026-09-25 D-4 收口先例 generalize）：旧「／原「／历史引文／已废除／已废弃／退役／存照／口径注／留观／冻结／更名／已废／快照／deprecated／遗留／当时／旧称／旧口径／判据废／对照。**行级判定**——整行含任一标记（默认集＋`@mark` 扩充＋词行专属）即该行全部命中豁免。
  - **扫描纪律（三条防坑，各对应一次实证事故，验收硬项）**：①UTF-8 原生枚举（python3 `os.walk`），**禁止** `git ls-files` 裸输出喂循环（quotepath 八进制转义致中文文件名整批静默漏扫）；②枚举/处理/排除三计数对账并全打印，不齐即中止（防静默跳过、单命令假绿）；③排除区显式清单（`.git`/`.archive`/`.tmp`/`.zvec-grep`/`node_modules` 按名单剪——**不做「一切隐藏目录」泛化剪，`.plan`/`.scratch` 是必扫治理活面**；隐藏文件与 `*.pb.go` 生成物、`*.sql` 迁移冻结史、`*results*.json` 冻结运行日志、二进制后缀、超 5MB 单文件按名剪）。执行体＝skill scripts/ `terms_check.py`（python3 stdlib，bash 3.2 对中文枚举/计数是实证雷区）；sh 保持唯一入口（2026-09-23 拍板 2A 延续）。
  - **零命中词警告（硬性要求）**：词表某词全仓零命中 → ⚠ 曝出交人工核对——词表 typo＝静默零命中＝假绿。警告不计发现数、不翻退出码。
  - **结果并入**：检查[7]发现数并入 plan-lint 总发现数与退出码（0=清零／1=有残留／2=用法错误）；**输出禁套 rtk**（其压缩/统计改写已实证失真）。

---

## 四、引用与过时管理（plan-archive 的职责）

归档单元是**轮**：从输入端（grill / wayfinder / 补充流问题拍板）到落地链收尾的一次完整闭环。轮走完后由 `plan-archive` 把整轮迁入 `.archive/rounds/<round-id>/`。归档**定义**（2026-09-28 triage 定稿）：整轮 `git mv` 进 `.archive/rounds/<round-id>/` ＋ 轮内引用相对化 ＋ 轮外断链巡检 ＋ `.archive/README.md` 两表更新 ＋ 前置判据核验 ＋ **完成即出检索面**（`.zcodeignore` 排 `.archive/`；DSH 侧 `excludedDirectories` 同步——2026-09-28 拍板「归档完成 = 出检索面」）。规则：

- **归档时机 = effort 全消后的轮归档（2026-09-29 G2 裁定）**：不设独立批量归档时机——qa 中缺陷和台账全消、effort 才能翻转，全部解决后才归档；全局 qa/ledger 为**全局件（常驻组）**，常驻 `.plan/qa|ledger/`、**不随轮迁**（非轮成员——随轮走的只是图内 qa/ledger）；**但全局审批档属搭车组，随该轮一并搬**（2026-10-02 裁定，见 §三「全局件」条生命周期表）。
- **前置判据（G4，全满足才可搬）**：①轮内票全终态（`resolved`/`out_of_scope`）且被测票 `qa_accepted` 齐；②缺陷全关闭；③台账条目全「已销/已转票」（**只清图内台账**；全局台账不在此判据内——全局件常驻组，见 §三「全局件」条）；④spec 已带 `superseded-by:` 注记且归宿行齐备（销号清单全清；2026-10-04 E' 拍板：spec 退役只发生在归档）＋审批档全 `closed`/`superseded-by:`/`abandoned` 或已翻 `archived:`。未满足先补标再归档。
- **整轮 `git mv`，目录结构原样（G3）**：源 = `.scratch/`（tracker 类）——成员相对 `.scratch/` 的路径在轮目录内原样保留，轮目录就是该轮当时 `.scratch/`（＋随轮审批档）的快照，`git log --follow` 可溯。文件搬移只发生在轮归档这一处；`plan-approve` 只翻状态、不搬文件。一轮跨多个 feature-slug 时成员按引用关系归组。
- **头部归档标识（R1）**：归档成员**必须做头部标识**——frontmatter 增 `archived: <round-id>`（无头文件在首行加 `<!-- archived: <round-id> -->` 注释）；任何 agent 直读该文件第一眼即见「已归档、勿据以实现」。写入动作在归档 `git mv` 同批完成。
- **轮内互引一律相对路径**：整树搬迁后相对引用原样存活，这是「保持目录完整」的前提（见「文档形态约定」）。
- **轮外断链巡检，不代改（R2）**：前提 = 全量权威已收敛 docs、权威文档**禁止持有指向 tracker 区（`.plan/`/`.scratch/`）的活引用**（spec 已一次性化＋归宿行＋禁反向指向）——归档时轮外**不应存在**指向成员的活引用；巡检发现即登记协议违例（回溯写侧纪律），**只报不改**。与此联动，`to-spec` 的「决策来源」指针记在**归宿行/审批档内**（随轮归档可达），长期文档不留指向 tracker 区的指针。
- **归档不是删**：轮外全局文档（总架构文档、`.archive/README.md`、`.plan/` 内其他活跃轮、`docs/` 等）指向被归档成员的引用，巡检登记后由该文档归属会话修复；「仍被实现引用、不能随轮归档」的成员就地加偏差声明、留在原处不搬。
- **已过时但仍有留存价值的结论**：留在原文档，给过时段落加标记（谁取代它、何时、还留着有什么用），不删除。
- **`.archive/README.md` 是归档区纪律 + 轮次索引 + 「现行权威」指针表**：每轮归档同步更新（教训：sweep 若排除 `.archive/`，归档区内部指针会失效留断链）。后续 plan 会话查历史，从轮次索引按轮切读完整视图。
- **审批档归档处置（G1，2026-09-29 Q3 拍板「随轮搬」）**：已标 `archived: <归宿>` 的审批档**随轮搬**进 `.archive/rounds/<round-id>/`（内容权威已在归宿文档）；未标者**留 `.plan/`**——判别器 = 标记本身。**`archived:` 标记条款（票 10）**：
  - **定义与适用范围**：`archived: <归宿>` 是审批档（过程层）的**归档完成标记**，写在 frontmatter；**不含 ADR、CONTEXT.md 词汇表**（知识层免标——ADR 原地翻自身 status、词汇表三态 `active/deprecated/superseded-by` 自维护，均不进 `.archive/`）。
  - **两个翻标挂点（2026-09-29 v2 拍板）**：①**结算即翻**——结论已全部在场吸收的档（词汇/ADR inline 写就、无 spec/票 项），`plan-approve` 结算当场翻 `archived: absorbed→CONTEXT.md#词条 ／ ADR-NNNN`；②**to-spec 完成翻**——含 spec 项的档，`to-spec` 写完 spec 并 discharge 时翻 `archived: <spec 落点>`。域写入归 grill 会话 inline（既有纪律）；票项由票文件自身 + plan-loop「定案未拆票」行跟踪，不进审批档；**不做清单回填**（无 ☐/☑ 状态化清单——2026-09-29 拍板「清单回填不做，交给 grill」）。
  - **不嵌入状态机**：`archived:` 独立于 `status` 五态之外，`plan-approve` 翻标不改 `status`（closed 仍是 closed）；`superseded-by:` 回归原语义（被后续拍板取代）。翻标口径 = 影响**动作落地**（spec 节写完/词条改完/ADR 立完/票立完）即算，不含票执行进度（归票状态机）。plan-lint 对审批档**零检查**（2026-09-29 拍板「这个就不通知了」：implemented 必已翻标、补充流程档无挂点会永久误报；漏 to-spec 提醒归 plan-loop Brief）。

---

## 四·补、文件类型与获取（2026-09-28 收编裁定：获取条款全部落本协议）

**状态机制判据**：状态**由内容唯一决定**的（resolved/out_of_scope）→ 正文标题派生；状态**内容推不出来**的（open/claimed/严重度/Assignee 等路由事实）→ 正文固定行或 header 字段。**2026-10-02 拍板 Q10=乙：载体统一到正文行**；判据保留为「为什么这么分」的解释，不再作为「该放 header」的依据——**缺陷/台账的正文行是判据的明文例外**（见 §三「四套状态机」条）。逐类：

| 类型 | 落点 | 状态表示与获取 |
|:--|:--|:--|
| map | `.scratch/<slug>/map.md` | 无状态字段；读正文即状态（Decisions so far 只索引不存态） |
| 推演票 | `.scratch/<slug>/issues/NN-<slug>.md` | 正文 `**Status:**`（三值）＋**派生**：`## Answer` 有正文=resolved、`## Ruled out` 有正文=out_of_scope、`claimed_by` 在位=claimed、其余=open；frontier = open 且阻塞边全终态（wayfinder `TRACKER-MARKDOWN.md` 为格式契约正本） |
| 执行票 | 同上 | 读正文 `**Status:**`（词表见「票面 `Status:` 词表」）；frontier = open 且阻塞边全终态 |
| spec | `.scratch/<slug>/spec.md` | **无头文档**（2026-10-02 拍板；to-spec 原版模板自 `## Problem Statement` 起，无 frontmatter/无状态行）——标记写**首行 HTML 注释** `<!-- superseded-by: <归宿> -->`（或正文首部 10 行内）；void 判据 = 每节归宿行且目标存在 ＋ 归档时必标 superseded-by（2026-10-04 E' 拍板：票尽不再触发必标，中途退役报 premature-supersede——「取代登记」条） |
| 审批档 | `.plan/` | 正文 `**Status:**` 五态（`superseded-by:<path>` 写正文首部 10 行内）＋ frontmatter `archived:` 归档标记（双翻标挂点见 §四） |
| 调研/复盘 | `docs/research/` | 正文 `**Status:** active/closed` |
| 测例集 / 执行记录 | `.scratch/<slug>/qa/cases.md` / `test.md` | 无 frontmatter——固定名 + H1 形状识别；测例按编号 grep 直达，执行状态记 test.md 按编号逐条（末轮为准） |
| 缺陷 | 图内 `.scratch/<slug>/qa/`、全局 `.plan/qa/` | **正文 `- 状态:` 行单写**（2026-10-02 Q11 拍板取消 frontmatter `status`）；终态=已关闭；`superseded-by:` 为可选 frontmatter 字段 |
| 台账 | 全局 `.plan/ledger/`、图内 `.scratch/<slug>/ledger/` | 正文 `- 状态:` 行（已销/已转票=终态）；运行态由 `- 阻塞:` 依赖票派生（阻塞中/可启动） |
| 全局件（概念，2026-09-29 拍板；2026-10-02 生命周期二分） | `.plan/approval/` 审批档 + `.plan/qa/` + `.plan/ledger/` | 封闭三件套（定义见 §三「全局件」条）；各成员状态获取同其单据类型（审批档/缺陷/台账行）；**qa/ledger 常驻不随轮；已翻标的 approval 随轮搭车**；均豁免 effort 判据；推进归 `plan-loop` 全局件行动行 |
| research 笔记 | `.scratch/<slug>/assets/` | 无状态；经票 frontmatter `assets:` 数组获取 |
| 归档轮 | `.archive/rounds/<round-id>/` | 已出检索面；获取 = 显式考古（`.archive/README.md` 轮次索引） |

**派生可靠性不靠写手自觉，靠 plan-lint 机械校验闭节形状**（对冲即兴形状静默失效）；无 frontmatter 类的识别靠固定名 + H1，状态不翻转、结论前置，无重复查态成本。

---

## 五、工作区初始化（init）

用户带着 init 意图调用本 skill（「初始化 plan 目录」「init 计划工作区」「给这个仓建 .plan/.scratch」）时，为新仓库落 plan 工作区骨架。**幂等，不覆盖**：已开工的仓库重跑 init 不得改动任何既有文件。

动作：

1. `mkdir -p .plan/ledger`（全局台账目录，一账一文件 `挂账-NN-<slug>.md`；图内台账随 effort 建在 `.scratch/<effort>/ledger/`）。
2. `.plan/README.md` **不存在才**按下方模板落盘（`<YYYY-MM-DD>` 换当日；指针区占位换项目实况）；**已存在则报告现状、零改动**——README 的后续维护归收口会话，受「形态契约变更回扫」条款覆盖。
3. 其余目录**不预建**：`map.md` / `issues/` 由 wayfinder / to-tickets 首次产出时创建，`spec.md` 由 to-spec 首次产出时创建，`qa/` 由测试 skill 首次落盘时创建，`.archive/` 由 plan-archive 首轮归档时创建——空目录不进 git，预建只会制造「看起来有结构」的假象。
4. 收尾跑 plan-lint（脚本随 plan 系 skill 安装，扫 `.scratch/` 与 `.plan/` 两治理目录）：0 发现为初始化完成。

README 模板：

```markdown
---
type: index
date: <YYYY-MM-DD>
status: active
origin: proactive
---

# 计划工作区索引与流程清单

本仓规划共享记忆分两目录（提交入库）：`.scratch/` 放 tracker 类（spec/map/issues 票＋图内 qa/ledger/assets），`.plan/` 放审批文档与全局 qa/ledger。目录约定（契约正本 = 全局 skill `plan-protocol`）：

- `.scratch/<feature-slug>/`：`map.md`（有它才是 effort，才会被视图加载）+ `issues/NN-<slug>.md`（一票一文件）+ `spec.md`
- `.scratch/<slug>/qa|ledger|assets/`：图内测例/缺陷/台账/调研笔记（随 effort 归档）
- `.plan/` 只放**全局件**（封闭三件套，正本见全局 skill `plan-protocol`「全局件」条）：`.plan/approval/` 全局审批文档（2026-09-30 收拢拍板，根层形状仅存量兼容）、`.plan/qa/` 无图归属缺陷与回测测例、`.plan/ledger/` 全局挂账台账；清单外新目录不得落 `.plan/`（plan-lint 检查[6]守门）
- `docs/research/`：调研/复盘文档；`docs/requirements/`：需求文档（文件名含 effort slug）
- `.tmp/`：一次性交接/审计（出检索面）；`.archive/`：整轮归档（由 plan-archive 迁入）

收口纪律：票面终态 = `resolved`（不分票型，允许附日期）、执行中 = `claimed`（票态词表正本见 §三「票面 `Status:` 词表」，本节不另立）；收口动作（implement / plan-sync / 测例执行 / 缺陷诊断 / plan-approve）收尾跑 plan-lint，0 发现或当轮修复。

## 指针

- 架构唯一正本：<docs/architecture.md；未设则写「未设」>
- <项目级指针（验收环境 / 契约 / 脚本），随用随补>
```
