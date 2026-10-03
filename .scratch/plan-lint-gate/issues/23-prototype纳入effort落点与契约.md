---
type: task
---

# 23: prototype skill 纳入 effort 落点契约（skill 改造＋白名单＋lint）

**What to build:** 用户 2026-10-04 拍板两点：①prototype 产物随 effort 保存（`.scratch/<effort>/prototype/` 子目录）；②UI 原型不挂当前项目前端，生成自包含单文件 html，便于挂 spec 与 plan-view effort「原型」tab 展示。落地面：prototype skill 三文件（SKILL.md 本仓落点契约节＋Rules 1 例外；UI.md sub-shape 章→独立 html 形态、wire/cleanup 对应改造；LOGIC.md 落点注）＋plan-protocol 检查[8] 白名单加 `prototype`＋写入矩阵正本文档同步（tree/成员数/新节）＋plan-lint 检查[8] 白名单。正本关系：mp 原版偏离处在 skill 内显式标注，其余逐字保留。

**Blocked by:** None

**Status:** resolved 2026-10-04

## Acceptance

- [x] prototype skill 三文件改造完成（偏离 mp 原版处显式标注：落点契约＋sub-shape 退役＋单文件骨架）。
- [x] plan-protocol 检查[8] 白名单封闭清单加 `prototype`，写明产物形态与引用方式。
- [x] plan-lint 检查[8] case/头注释/echo 三处同步，`prototype/` 不再报 effort-dir-whitelist。
- [x] 写入矩阵正本（docs/research/梳理-plan目录写入矩阵-20260930.md）tree/判据/新节三处同步。
- [ ] 视图侧（effort「原型」tab＋服务端收集）＝票 24，另立。

## 执行记录（2026-10-04）

改动七文件：`skills/prototype/SKILL.md`（落点契约节＋Rules 1 例外）、`skills/prototype/UI.md`（sub-shape 章整章替换为独立 html 形态＋`#variant=` hash 切换骨架＋wire/production-gate/cleanup 三处对应改造）、`skills/prototype/LOGIC.md`（步骤 5 落点注）、`skills/plan-protocol/SKILL.md`（检查[8] 条）、`skills/plan-approve/scripts/plan-lint.sh`（检查[8] 三处＋头注释）、`docs/research/梳理-plan目录写入矩阵-20260930.md`（三处）。分发同步 install-skills.sh（prototype 走主循环默认映射，无需改脚本）。
