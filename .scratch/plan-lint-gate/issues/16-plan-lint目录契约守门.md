---
type: task
blocked_by: []
status: done 2026-09-30
claimed_by: dsh-plugin 会话（implement-spec 直推）
---

# 16: plan-lint 目录契约守门（effort 白名单 + .plan 根层文件形状）

**What to build:** 2026-09-30 两层目录 tree 经用户拍板（「那就按这个来」）后，协议的目录封闭清单尚无机械守门——存量违例（`tickets/` 旧布局并存、nvwa `fengping/`、novel `specs|改造工单|briefs`、`.plan/` 根层 9 份清单外文件）全部绿灯。给 plan-lint 补两条检查，判据 = 写入矩阵（[docs/research/梳理-plan目录写入矩阵-20260930.md](../../../docs/research/梳理-plan目录写入矩阵-20260930.md)）。

**Source spec:** 用户会话拍板；判据来源同上 §〇/§五；与《.plan/待拍板-票型目录映射与视图收集-20260930.md》Q3 并轨（本票即其施工票）。

## 改造项

1. **检查[8] effort 目录白名单**：`.scratch/<effort>/` 内子目录封闭清单 = `issues / assets / approval / qa / ledger`（+ 存量 `tickets / impl / impl-fe` 只读兼容，协议「impl 不是票型」条明文历史路径不得清理）；清单外子目录报违例（含 `specs/`、`briefs/`、`fengping/` 类自建目录）。effort 判据复用检查[2]（含 map.md 或 spec.md）。
2. **检查[9] `.plan/` 根层文件形状**：根层文件只允许 `待拍板-<slug>-<date>.md` / `已拍板-<slug>-<date>.md` 形状（含 `archived:` 标记者照旧豁免归档巡检）；清单外文件（`梳理-*`/`复盘-*`/`参考-*`/无日期审批档等）报违例并提示对应合法落点（`docs/research/`、`docs/requirements/`、`.tmp/`、effort `assets/`）。
3. **存量处置清单随检查产出**：两条检查在 dsh-plugin / novel / nvwa 三仓各跑一遍，输出违例清单作为迁移施工输入（迁移本身按 2026-09-29 议题③裁定由用户单独推进，lint 只报不改）。

## Acceptance

- [x] 两条检查落 plan-lint.sh（sh 唯一入口纪律延续），不带治理目录参数时整体跳过行为与既有检查一致
- [x] dsh-plugin 自检：`.plan/` 根层 9 份清单外文件全部被报出（`tickets/` 为存量只读豁免**不报**——与改造项 1 口径一致，迁移按裁定由用户单独推进，本票原文「tickets/ 并存被报出」系措辞矛盾，落地时以此注为准修正）
- [x] 三仓试跑违例清单（见落地注）；README 层级说明档豁免（比照检查[1][2]惯例，novel `.plan/README.md` 误报已修）
- [x] 协议 §三补「目录契约守门（检查[8][9]）」条款（一票一文件条之后）

## Answer

落地 commit `b212c18`（plan-lint.sh 检查[8][9] + 协议 §三「目录契约守门」条）。实现要点：两检查以 `case "${PD##*/}"` 按治理目录分流（[8] 仅 .scratch、[9] 仅 .plan），bash 3.2 兼容无关联数组；[8] effort 判据 = 直接子目录含 map.md 或 spec.md（与视图加载判据一致），非 effort 目录不查；[9] 白名单 = `待拍板-*|已拍板-*` + README 豁免。协议 §三新增「目录契约守门」条（判据正本指向写入矩阵文档）。

**三仓违例清单（2026-09-30 实测；lint 只报不改，迁移由用户推进）**：
- dsh-plugin：[8] 0；[9] 9 —— `.plan/` 根层：handoffs-2026-09-18-plan-view-interaction-blueprint / ponytail-触发诊断与最佳实践 / skill-doctor-dsh-适配方案 / 参考-DSH-WebUI插件挂载点-20260921 / 复盘-废弃方案复活为何多轮整治未解-20260927 / 梳理-skills全量对照盘点-20260928 / 梳理-文件类型与获取总表-20260928 / 汇报规范hook插件-待拍板 / 需求-dsh-ignore文件检索排除与读取拦截-20260928
- novel：[8] 3 —— `state-machine/specs|改造工单`、`workflows/briefs`；[9] 2 —— `.plan/prompt-按新协议整理目录与权威文档.md`、`.plan/roadmap-self-serve-loop.md`
- nvwa：[8] 2 —— `jiaomai-gongyue/fengping`、`jiaomai-gongyue/shoufaka`（后者为本检查新发现，此前人工 sweep 漏盘）；[9] 1 —— `.plan/审批-合集拆书收尾-20260918.md`（「审批-」前缀不在词表）
