---
type: task
blocked_by: [04]
status: done
claimed_by: dsh-session
session: session-plan-protocol-status-alignment
---

# 05 插件读取层适配 status 统一

## 执行记录（2026-09-27）

**已完成**：`resolved` 符号级改名通过。

**已否决一项（原第 3 项）**：**不移除 `displayStatus()` 的 frontmatter 分支**——**实测证明它是承重的**。

| 实测 | 结果 |
|:--|:--|
| 本仓 `status: done` 的**真票**（`tickets/` 下） | **10 张** |
| 其中带 `## Answer` 收束节的 | **0 张** |
| 若移除 frontmatter 分支 | **这 10 张全部读成 `open`**——已完成的票在页面上显示为待办 |

**归零判据**：`displayStatus()` 的双分支**不是「同一事实两个家」的坏味道，而是「两种合法载体」的读取适配**——协议 §三已明文「票态有两种合法形态」，且明确规定 frontmatter 是权威（「票里 `status` / `type` / `blocked_by` 以 frontmatter 为准」）。**协议授权两个载体，读取层就必须读两个载体。** 移除分支 = 读取层不支持协议承认的形态。

**故本票收敛为「改名」，不含「删分支」。** 原第 3 项列为**已评估并否决**，理由与证据留存于此，避免下一轮被当作「漏做」重开。

**原「诚实边界」的过渡期风险已实测结清**：本次只改符号名、**未收敛词表**（`DONE_STATUS` 的 `closed`/`complete`/`completed`/`shipped` 容忍别名保留），故**存量票显示零变化**——没有出现原担心的「完工票被读成待办」。

---

## 已实施

| # | 落点 | 改动 |
|:--|:--|:--|
| 1 | `TicketStatus` 联合类型 | `'resolved'` → `'done'` |
| 2 | `ParsedTicket` 字段 | `resolved: boolean` → `done: boolean`（含赋值与全部消费点） |
| 3 | `displayStatus()` | 两处返回值改 `'done'`；**分支结构保留**（见上「已否决」） |
| 4 | `DONE_STATUS` | 移除 `resolved`；**保留** `closed`/`complete`/`completed`/`shipped` 容忍别名 |
| 5 | `DOT` / `STATUS_LABELS` / `STATUS_ORDER` | 键改 `done`；标签 `Resolved` → **`Done`** |
| 6 | 全部消费点（统计、筛选、叶子计算、空态判断） | 随字段改名同步 |
| 7 | **不改**：`// resolved fs path`、`kind resolved`、`Resolve each ticket's refs` 等**英文词义用法** | 与票态无关 |

**验证**：

| # | 验证 | 结果 |
|:--|:--|:--|
| 1 | 重建 | `tsdown` 构建通过（`lib/client.js` 197.21 kB / `lib/index.js` 173.34 kB） |
| 2 | 产物核对 | `lib/client.js` 中 `resolved` **残留 0 处**；`done` 入产物 27 处 |
| 3 | 产物状态表 | `STATUS_LABELS` = `{open, claimed, done: "Done", out_of_scope}`；`DOT` 表键同步 |
| 4 | 源码非票态用法 | 仅剩 3 处英文词义（第 7 项），**有意保留** |

**构建环境备案**：本仓 `node_modules` 原为空、`tsdown` 缺失。经 `pnpm install --filter dsh-plan-view --ignore-workspace` **仅装本插件自身依赖**；`tsdown` 取自 `/Users/huzilin/workdir/deepseek-harness/node_modules/.bin`（该仓已有）。**未安装、未修改 deepseek-harness 任何内容**——其 `pnpm-lock.yaml` 的既有改动与本轮无关，已核实未被我触碰。

---

## 交付什么

把计划视图的**读取逻辑**改到与协议单一票态一致，使「页面显示的状态」与「票面真实状态」不再依赖第二套口径。

## 为什么需要

插件目前**同时理解两种形态**——`displayStatus()`（`src/client/PlanView.tsx:105-114`）**先读收束节、再读 frontmatter**。

> **〔定性修正（2026-09-27 实测）〕** 本票原写此双分支「正是同一事实两个家、一旦不一致页面就撒谎」。**该定性经实测被否**：**两个载体都是协议承认的合法形态**（§三「票态有两种合法形态」＋「frontmatter 是权威」），双分支是**正确适配**而非坏味道。原定性的错误在于把「两处各写一套词表」的病，误套到「一个载体一种读法」的正常设计上。**本票因此删去了「移除分支」这一动作。**

## 具体内容

| # | 落点 | 动作 |
|:--|:--|:--|
| 1 | `TicketStatus` 联合类型（`:20`） | **改符号**：`'resolved'` → `'done'` |
| 2 | `ParsedTicket.resolved` 字段（`:24`、`:64`） | 改名 `done`（含全部消费点） |
| 3 | ~~`displayStatus()` 移除 frontmatter 分支~~ | **已否决**（见「执行记录」） |
| 4 | `DONE_STATUS`（`:93`） | 移除 `resolved`，保留容忍别名 |
| 5 | `DOT` / `STATUS_LABELS` / `STATUS_ORDER`（`:333-335`） | 随改名 |
| 6 | 统计与筛选引用（`:912/:922/:928/:1224/:1502/:2144` 等） | 随改名，逐处核对 |
| 7 | `normalizeRef()`（`:137`，剥离引号） | **本轮未动**——属存量容错，与票态无关，留观察 |

## 依赖说明

`blocked_by: [04]` —— 必须先定协议单一词表，读取层才知道该认哪些值。

## 验收标准（外部可观察）

1. ✓ **同一张票**在页面上显示的状态与票面权威一致；
2. ✓ **不出现误读**：完工票**未**因读取层改动而显示为待办（本仓 10 张 `done` 票零变化）；
3. ✓ 构建通过，产物含新符号、零旧符号；
4. ✓ **存量票显示零变化**（未收敛词表，容忍别名保留）。

## 诚实边界

- 本票**只动读取层，不动存量票**——回扫归票 07（已完成）；
- **GUI 目视核对未做**：`lib/` 已重建且产物核对通过，但**未在浏览器中实际刷新确认读数**（本会话 `agentOpenTools: false`，页面操作能力受限）。**这是本票唯一未闭环的验收项**，如实标注——**产物级验证通过 ≠ 页面级验证通过**。
