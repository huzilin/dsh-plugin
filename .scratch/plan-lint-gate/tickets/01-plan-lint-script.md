---
type: task
blocked_by: []
status: done
---

# 01: plan-lint 只读校验脚本 + 说明页悬空引用修复

**What to build:** 一个无依赖 Node 只读脚本 `packages/dsh-plan-view/scripts/plan-lint.mjs`，对给定仓库的 `.plan/**` 做结构校验并输出违规清单（不修改任何文件）；插件「📖 说明」页不再引用不存在的 `plan-lint` skill，改为指向该脚本的真实调用方式。

**Blocked by:** None — can start immediately

**Source spec:** `.plan/待拍板-plan-lint门禁与说明页悬空引用-20260918.md`（裁定 A）

## Acceptance

- [x] `node packages/dsh-plan-view/scripts/plan-lint.mjs <仓库根>` 跑通，校验三类规则：① 同票 id 出现在多目录（双档）② 含票文件的目录缺 map.md（计划视图会整目录跳过）③ 状态头违规（`type: approval` 缺四字段头、status 不在词表内）
- [x] 对 dsh-plugin 本仓跑出真实结果：16 份 md，报出 2 项——正是已知两份无状态头老文档（`待拍板-DSH侧zg硬门禁…`（裸 key-value 无围栏）、`汇报规范hook插件-待拍板`）
- [x] 对 novel 跑一遍抓出 `state-machine/` 缺 map.md：实测报 7 个缺 map 目录，含 `state-machine/改造工单/`（14 张票）
- [x] `PlanView.tsx` GuideView 不再出现「跑 plan-lint」的 skill 指引，改为脚本调用方式（`node …/dsh-plan-view/scripts/plan-lint.mjs 仓库根`）
- [x] tsdown 构建通过，lib 部署副本 md5 一致（`0c7f6e5a…`）

## 落地注

- 2026-09-18 当场实现并部署。规则正本 = plan-protocol §三；脚本只消费。
- 归属：A 案裁定来自 plan-approve 结算《待拍板-plan-lint门禁与说明页悬空引用-20260918》（用户原话「A」）。
- 源码 + 票 + 脚本未 git commit，待归位提交（挂《残留处置》项 2 同批）。
