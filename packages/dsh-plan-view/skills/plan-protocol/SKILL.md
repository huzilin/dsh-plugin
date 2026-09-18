---
name: plan-protocol
description: The plan-ecosystem contract — where each plan skill sits, what it owns, and how they hand off. Load when any of to-spec / to-tickets / implement / implement-spec / plan-sync / to-approval / plan-approve / plan-archive is invoked, or when explaining the two plan flows.
disable-model-invocation: true
---

# Plan 流程协议（计划生态契约）

本文件是 **plan 一套 skill 的共享协议**。它不做事，只规定：两条流程、每个 skill 的位置与职责、文档形态约定、跨 skill 交接契约。

**谁该读它**：本目录下的 `to-spec` / `to-tickets` / `implement` / `implement-spec` / `plan-sync` / `to-approval` / `plan-approve` / `plan-archive`，以及任何需要解释 plan 流程的 session。这些 skill 各自持有自己的 how；本协议是它们的**公共契约层**，避免各自重述、各自漂移。

> 与 `dsh-plan-view` 插件的关系：插件是**只读**渲染方，按 frontmatter 显示「路线 / 工单 / 待拍板」三页。它不生产文件，只消费。所有文件形态约定（见下文「文档形态」）都是为了让插件能正确读。

---

## 一、两条流程

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

### 补充流程（执行 / 测试中暴露的问题）

```
find-bug → to-approval → plan-approve →（依据）→ to-tickets → implement / implement-spec → plan-sync
                                             ↑
                                 依据 = 那份待拍板文档本身
                                 （不追加 spec、不新建 spec）
```

**两条流的分界**：主流程是「**已知要做**，把需求写成 spec 再拆票」；补充流程是「**发现一个问题 / 缺口**，先拍板定论，依据就是拍板文档」。汇合点相同：**拍板结论若要干活，当场落成标准票**（`to-approval` 调 `plan-approve`，`plan-approve` 调 `to-tickets`），接回落地链 ②。

---

## 二、每个 skill 的位置与职责

| skill | 流程位置 | 上游 | 下游 | 产出 | 不做什么 |
|:--|:--|:--|:--|:--|:--|
| `grill` / `grilling` | 主流程 ① 输入端 | 用户想法 | `to-approval` | 把模糊决策拷问清楚、问题落文档 | 不写票、不拍板 |
| `wayfinder` | 主流程 ① 输入端（推演地图） | 用户探索 | `to-approval` | `.plan/<effort>/` 推演地图（map + tickets/ + assets） | 不写 spec、不拍板 |
| `to-approval` | ① 与 ② 之间 | grill / 发现的问题 / 裸 id | `plan-approve` | 待拍板文档（`status: pending` + 四字段头 + 原文照抄 + 四要件） | 不拍板、不手写票 |
| `plan-approve` | ① 出口 / ② 入口 | `to-approval` | `to-tickets` | 逐项核定、录结论、**按 ruling 调 `to-tickets`**、推进文档状态（只翻状态、不搬文件） | 不发明票格式、不散件归档 |
| `to-spec` | ② 起点 | 决策定案 | `to-tickets` | `spec.md`（整体写）；**写前读架构正本、写完更新架构正本** | 不拆票 |
| `to-tickets` | ② 第二环 | spec / 待拍板文档 / 推演地图 | `implement*` | **一票一文件** `tickets/<NN>-<slug>.md` + `map.md`（若无） | 不写 spec、不实现 |
| `implement` / `implement-spec` | ② 第三环 | 票 | `plan-sync` | 实现 + **合并落地时当场回写票** | 不读盘批量翻状态 |
| `plan-sync` | ② 收尾（对账） | 已落地代码 | 无 | 把「看起来已完成、票面没翻」的票找回来、对账后回写 | 不凭人话翻状态、不写票 |
| `plan-archive` | ② 之后（整轮归档期） | 已走完的轮（全部成员） | 无 | 整轮归档（目录结构原样）+ sweep 轮外引用 + 标过时/废弃 | 不自动跑、不改代码、不散件归档 |

**交接契约（硬规则）**：

1. **`to-tickets` 的输入必须是 spec / 待拍板文档 / 推演地图**，不能是裸结论。票的格式由它独占——任何 skill 都不得手搓 ticket 文件（包括 `to-approval` / `plan-approve` 调 `to-tickets` 时也要 override 其默认「合并 `tickets.md`」行为，改用一票一文件）。
2. **回写发生在两处，是同一件事的两种时机**：`implement*` 在每张票合并落地时**当场**翻状态；`plan-sync` 事后对账补齐。两者不是两条流程。
3. **`plan-approve` 是唯一的「决策 → 票」转化点**：拍板结论是「做 X」时，必须调 `to-tickets` 落票，否则结论只是聊天记录，下次会话丢失。
4. **架构正本（`docs/architecture.md`，novel 项目）是全局架构唯一最新事实**：`to-spec` 写前读、写完更新；`plan-approve` 拍板若改变了架构事实，也在末步更新。它不新建——已存在就维护。

---

## 三、文档形态约定（插件能读的前提）

- **一票一文件**：`.plan/<effort>/tickets/<NN>-<slug>.md`。**禁止**把多票写进一个 `tickets.md`——按文件读取的一方会把合并文件当成**一张票**，里面所有票丢失。
- **frontmatter 是权威**：票里 `status` / `type` / `blocked_by` 以 frontmatter 为准，不读正文表格。
- **状态头四字段**（待拍板 / spec / map 等文档）：`type` / `date` / `status` / `origin`。
  - `status` 五态：`pending` / `closed` / `superseded-by:<path>` / `active` / `abandoned`。**禁止「待拍项已作废却仍留 pending」**。
  - `origin`：产生原因（`readability-rescue` / `proactive` / `review` / `retrospective`）。
- **effort 标志**：目录里有 `map.md` 才被当作 effort 加载；没有 `map.md` 的 `tickets/` 目录不被读取。
- **`type` 取值约定**：`task`（落地工单）、`approval`（待拍板）、`research` / `prototype` / `grilling`（推演地图节点）。没有 `type` 的文件仍可见，但归「说明 / 杂项」类。
- **轮内互引一律相对路径**：同一轮的文档互相引用，写相对路径（相对当前文件），不写 `.plan/...` 开头的根相对路径、不写绝对路径。轮收尾后 `plan-archive` 把整轮迁入 `.archive/rounds/<round-id>/`，目录结构原样，相对引用随整树搬迁存活；根相对/绝对引用会断。轮内引用轮外正本不受此限（正本不搬）。

---

## 四、引用与过时管理（plan-archive 的职责）

归档单元是**轮**：从输入端（grill / wayfinder / find-bug 补充流）到落地链收尾的一次完整闭环。轮走完后由 `plan-archive` 把整轮迁入 `.archive/rounds/<round-id>/`。规则：

- **整轮 `git mv`，目录结构原样**：成员相对 `.plan/` 的路径在轮目录内原样保留——轮目录就是该轮当时 `.plan/` 的快照，`git log --follow` 可溯。文件搬移只发生在轮归档这一处；`plan-approve` 只翻状态、不搬文件。
- **轮内互引一律相对路径**：整树搬迁后相对引用原样存活，这是「保持目录完整」的前提（见「文档形态约定」）。
- **归档不是删**：轮外全局文档（总架构文档、`.archive/README.md`、`.plan/` 内其他活跃轮、`docs/` 等）指向被归档成员的引用，sweep 后改指 `.archive/rounds/<round-id>/…` 新位置；「仍被实现引用、不能随轮归档」的成员就地加偏差声明、留在原处不搬。
- **已过时但仍有留存价值的结论**：留在原文档，给过时段落加标记（谁取代它、何时、还留着有什么用），不删除。
- **`.archive/README.md` 是归档区纪律 + 轮次索引 + 「现行权威」指针表**：每轮归档同步更新（这是 2026-09-18 一次真实断链事故后的教训——sweep 排除 `.archive/` 导致内部指针失效）。后续 plan 会话查历史，从轮次索引按轮切读完整视图。
