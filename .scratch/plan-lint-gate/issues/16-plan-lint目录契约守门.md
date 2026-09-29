---
type: task
blocked_by: []
status: open
---

# 16: plan-lint 目录契约守门（effort 白名单 + .plan 根层文件形状）

**What to build:** 2026-09-30 两层目录 tree 经用户拍板（「那就按这个来」）后，协议的目录封闭清单尚无机械守门——存量违例（`tickets/` 旧布局并存、nvwa `fengping/`、novel `specs|改造工单|briefs`、`.plan/` 根层 9 份清单外文件）全部绿灯。给 plan-lint 补两条检查，判据 = 写入矩阵（[docs/research/梳理-plan目录写入矩阵-20260930.md](../../../docs/research/梳理-plan目录写入矩阵-20260930.md)）。

**Source spec:** 用户会话拍板；判据来源同上 §〇/§五；与《.plan/待拍板-票型目录映射与视图收集-20260930.md》Q3 并轨（本票即其施工票）。

## 改造项

1. **检查[8] effort 目录白名单**：`.scratch/<effort>/` 内子目录封闭清单 = `issues / assets / approval / qa / ledger`（+ 存量 `tickets / impl / impl-fe` 只读兼容，协议「impl 不是票型」条明文历史路径不得清理）；清单外子目录报违例（含 `specs/`、`briefs/`、`fengping/` 类自建目录）。effort 判据复用检查[2]（含 map.md 或 spec.md）。
2. **检查[9] `.plan/` 根层文件形状**：根层文件只允许 `待拍板-<slug>-<date>.md` / `已拍板-<slug>-<date>.md` 形状（含 `archived:` 标记者照旧豁免归档巡检）；清单外文件（`梳理-*`/`复盘-*`/`参考-*`/无日期审批档等）报违例并提示对应合法落点（`docs/research/`、`docs/requirements/`、`.tmp/`、effort `assets/`）。
3. **存量处置清单随检查产出**：两条检查在 dsh-plugin / novel / nvwa 三仓各跑一遍，输出违例清单作为迁移施工输入（迁移本身按 2026-09-29 议题③裁定由用户单独推进，lint 只报不改）。

## Acceptance

- [ ] 两条检查落 plan-lint.sh（sh 唯一入口纪律延续），不带治理目录参数时整体跳过行为与既有检查一致
- [ ] dsh-plugin 自检：`tickets/` 并存、`.plan/` 根层 9 份清单外文件被报出
- [ ] 三仓试跑违例清单落档（novel specs/改造工单/briefs、nvwa fengping 在列）
- [ ] 协议 §三「目录布局总则」补两检查指针（plan-lint 检查编号表同步）
