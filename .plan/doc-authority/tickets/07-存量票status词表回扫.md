---
type: task
blocked_by: [04]
status: done
claimed_by: dsh-session
session: session-plan-protocol-status-alignment
---

# 07 存量票 status 词表回扫（resolved → done）

## 执行记录（2026-09-27 完成）

**用户放行原话**：「07 放行」

**实际迁移 20 张**（与实测范围一致，无多无少）：

| 仓 | 张数 | 落点 |
|:--|:--|:--|
| novel | **15** | `.plan/outline-industry-review/tickets/` 14 张 ＋ `.plan/dna-craft/tickets/04` 1 张 |
| nvwa | **5** | `.plan/dna-ab-full/tickets/OPT1`~`OPT5` |
| dsh-plugin | **0** | 本仓无残留 |

**迁移方式**：`status: resolved <日期>` → `status: done <日期>`（**日期原样保留**）；nvwa 5 张无日期附注，直接 `resolved` → `done`。

**验证（三道，全部通过）**：

| # | 验证 | 结果 |
|:--|:--|:--|
| 1 | 三仓 `grep -rn "^status: resolved"` | **零命中** |
| 2 | 以迁移前基线逐张比对（`sed -n "${lineno}p"` 精确到行） | **20/20 通过，0 失败**；**日期逐字节保留** |
| 3 | 三仓 `plan-lint` | dsh-plugin **54** 文件 ✓／novel **340** 文件 ✓／nvwa **34** 文件 ✓，**均 0 发现** |

**过程中的一次自我纠错（如实记录）**：首次验证脚本用 `grep -m1 "^status: resolved" <file>` 取迁移前的值——**但迁移后该模式已不存在**，取到空值导致 15 张被误报「失败」。**是验证脚本的缺陷，不是迁移错误**；改为读迁移前保存的基线文件（含行号）后全部通过。**教训：验证脚本本身也要先证明它读的是对的东西，否则会伪造出「失败」假象。**

**未做**：未改动任何票的正文、结论或收束节——本票只换词。

---

## 交付什么

把三仓存量票里**用了已废弃票态词 `resolved` 的票**迁移为 `done`，使存量与新词表一致。

## 为什么需要

`resolved` 已于 2026-09-27 退出票态词表（用户原话「resolved 改为 done」）。`plan-protocol` 与 `plan-lint` 均已按新词表收口——**lint 现在会拦 `resolved`**（实测：`✗ task status「resolved」为已废弃词`）。存量票若不动，会持续被 lint 判违规。

## ⚠️ 范围已实测收窄（勿按旧数执行）

**旧说法「103 张要回扫」已作废**——那不成立。理由：**103 张用的是 `done`**，而统一后 `done` 正是唯一合法终态词。**它们一张都不用改。**

**真正的回扫量（【实测】2026-09-27 三仓 grep `^status: resolved`）**：

| 仓 | 张数 | 明细 |
|:--|:--|:--|
| novel | **15** | 集中在 `.plan/outline-industry-review/tickets/`（14 张）＋ `.plan/dna-craft/tickets/04`（1 张） |
| nvwa | **5** | `.plan/dna-ab-full/tickets/` 的 `OPT1`~`OPT5` |
| dsh-plugin | **0** | 本仓无残留 |
| **合计** | **20** | |

**日期附注形态**：novel 的 15 张全部为 `status: resolved <YYYY-MM-DD>`（用户 2026-09-27 裁定「可」保留日期附注形态）→ 迁移为 **`status: done <YYYY-MM-DD>`，日期原样保留**。

## 具体内容

| # | 仓 | 动作 |
|:--|:--|:--|
| 1 | novel | `status: resolved <日期>` → `status: done <日期>`（15 张，**日期保留**） |
| 2 | nvwa | `status: resolved` → `status: done`（5 张） |
| 3 | 三仓 | 顺带核查有无其他词表外别名（`closed`/`complete`/`completed`/`shipped` 等）在票面出现——**本轮实测未发现，但须以 grep 复核为准，不得凭印象** |

## 依赖说明

`blocked_by: [04]` —— **必须先定协议单一词表并改完 wayfinder**，否则回扫判据未定。**lint 侧已先行收口**（本票开立前已完成），故回扫完成后 lint 应即转绿。

## 验收标准（外部可观察）

1. 三仓 `grep -rn "^status: resolved" .plan/` **零命中**；
2. 迁移后 `plan-lint` 在**三仓**均 0 发现（含 novel / nvwa，不只本仓）；
3. **日期信息不丢**：novel 15 张的 `done <YYYY-MM-DD>` 日期与原 `resolved <YYYY-MM-DD>` 逐一对应；
4. **票的语义不变**：迁移只换词，不得顺手改动票的结论或收束节。

## 诚实边界

- **本票只做换词迁移**，不重写票面内容、不补收束节；
- **跨仓改动范围**：novel 与 nvwa 的改动**须经你确认**后执行（此前定过「先只动 dsh-plugin 本仓」，本票跨出该边界）。**本票立而不动，等你的放行话。**
- **`wayfinder/SKILL.md` 与 `TRACKER-MARKDOWN.md` 的文本改动不在本票**——归票 04（那是改契约，不是回扫存量）。
