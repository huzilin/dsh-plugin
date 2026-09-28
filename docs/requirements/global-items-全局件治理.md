---
type: requirements
date: 2026-09-29
status: active
origin: proactive
---

# 需求文档：全局件治理（effort: global-items）

> 决策来源：`.plan/待拍板-全局件概念与全局目录-20260929.md`（2026-09-29 五项拍板全 A，已 closed）。本档承载该批的用户故事、验收与测法、范围外——长期保留；spec（`.scratch/global-items/spec.md`）是一次性实施文档，归宿行指向本档。

## Problem（用户面对的问题）

plan 生态的「全局性落点」（审批档、无图归属缺陷/测例、跨图挂账）散落在协议各条款里，没有名字、没有定义、没有判据。后果在 novel 仓目录迁移批集中爆发：`.plan/qa/` 双重身份目录撞上「有 map.md 即迁」规则只能靠会话自行推断；协议内部「属轮成员随轮走」与「不随轮迁」表述相抵；`.plan/research/` 这类清单外目录长期无人发现。同时 DSH 侧 skills 安装目录变更（迁 `~/.dsh/skills`）后安装脚本目标漂移，装了不生效。

## Solution（方案形态）

把「全局件」立为协议正本里的命名概念：封闭三件套（`.plan/` 根层审批档、`.plan/qa/`、`.plan/ledger/`），定义、判据豁免（内含 map.md 不触发 effort 迁移令）、归档口径（常驻不随轮、全局台账不入轮归档清账）全部落 plan-protocol 一处；plan-lint 以 `.plan` 根层白名单机械守门；安装脚本目标跟随 DSH 现行目录；计划视图文案与协议术语统一。

## User Stories（用户故事）

1. As 跨仓 plan 会话，I want 「全局件」在协议正本有一处定义，so that 新仓库的全局落点不用每仓重新推断一遍。
2. As 目录迁移批会话，I want 全局件目录豁免 effort 判据，so that 内含 map.md 的全局 qa 目录不再触发迁移冲突（novel 双重身份从推断转正解）。
3. As 仓库维护者，I want plan-lint 对 `.plan` 根层做白名单检查，so that 清单外子目录（如曾经的 `.plan/research/`）当场暴露而不是等下批迁移人工发现。
4. As 归档会话，I want 全局台账不进入轮归档前置判据的清账范围，so that 长期「在挂」的全局债务不阻塞任何轮归档。
5. As DSH 用户，I want install-skills 装到 DSH 现行 skills 目录（`~/.dsh/skills`），so that 安装即生效、不再死投递。
6. As 计划视图用户，I want 页面文案与协议术语一致（「全局件」），so that 界面自解释、不用跨文档对词。
7. As 归档轮会话，I want 有留存价值的一次性审计产物进 `.archive/` 且登记，so that 证据源可溯且检索面正确收窄。
8. As novel 维护者，I want 双重身份目录的普适裁决入共享协议，so that 已做的保守解零返工自动成为正解。

## 验收与测法

**好测试只测外部可观察行为**：CLI 退出码与报告文本、安装态文件树一致性、渲染层可见文案；不测内部函数形状。

| 面 | 测法（seam） | 通过判据 | 先例 |
|:--|:--|:--|:--|
| plan-lint 白名单 | `/tmp` 夹具仓跑 `plan-lint.sh .plan`（清单外目录、qa/ledger/handoffs、含 map.md 存量目录四态） | 清单外报 `plan-root-whitelist`，其余豁免；本仓全量 0 发现 | 2026-09-29 `/tmp` 夹具四态自测 |
| 协议定义节 | 会话直读 + grep 术语 | 「全局件」定义、封闭清单、豁免、生命周期四处齐；`属轮成员随轮走` 作为现行法断言零残留（仅历史引文/修正注记） | G2/G4 修正批（commit 1a38ef6） |
| 安装目标 | 跑 `install-skills.sh` + `diff -r` 全树 | 安装到 `~/.dsh/skills`；24 skill 零 gap；注入与自检全过 | skills README 分发纪律（21e1a75） |
| 违例处置 | `git log` + 归档区登记 | 违例目录进 `.archive/` 并在 `.archive/README.md` 登记 | skill-doctor-reports 迁移（b2aa101） |
| 视图文案 | 构建 + grep 渲染层文案；真机走查按「留证待审」后补 | 文案挂「全局件」术语、构建零错 | 本 effort 票 05 |

## 范围外

- novel 仓的任何文件改动（Q5 拍板=原地不动零改动；其存量 `.plan/<effort>/` 迁移归该仓存量批次）。
- `map.md` 的创建——map 只由 wayfinder 或用户建（2026-09-29 拍板），本 effort 的 spec/tickets 落盘后视图加载与 lint [2] 缺 map 发现，交用户拍板处置。
- `CONTEXT.md` 收「全局件」词条（Q1 拍板：定义正本在 plan-protocol，避免双正本）。
- 视图行为变更（渲染逻辑不动，只动文案）。
- 旧安装态 `~/.dsh/.agent-presets/` 的删除（dsh 侧资产，不在本仓职权）。
