---
type: approval
date: 2026-09-30
origin: proactive
---

# 已拍板：mp 源仓 grilling 补丁收编、统一由本仓管理（2026-09-30）

**Status:** closed

> **状态头**：`status: closed`——当场执行型拍板，落地完毕即闭环。

## 一、原话（照抄）

> 当前项目是有直接 修改 mp 源码的情况，如 skills/productivity/grilling/SKILL.md 的情况，将对应被改动的 skills 纳入 plan-view 的 skills，并配置到 install 内，合在一起管理。

## 二、拍板内容与盘点结论

mp 源仓（`~/workdir/skills`，mattpocock/skills 上游 clone）工作区存在一处我方补丁：`skills/productivity/grilling/SKILL.md` 增补「**Every question is written down before it is asked**」节——grill 每轮问题先落审批档（to-approval 同构四字段头 + 逐项四要素 + 五步流程 + closed 纪律），把 grilling 挂接进 plan 审批档生态。该补丁漂移在上游仓、未提交、不受本仓 install 分发管理。

**盘点核实（机器对拍）**：

1. mp 源仓工作区被改文件**全量仅此一件**（`git status` 单 M、无未跟踪 skill、`origin/main..HEAD` ahead=0 无本地独有提交、无 stash）。
2. 该补丁**已有第二份逐字一致拷贝**在本仓正本 `packages/dsh-plan-view/skills/grilling/SKILL.md`（此前会话已收编；`diff` exit=0）。
3. 本仓 install-skills.sh 主循环（glob 自动分发）已有映射 `grilling → mp-grilling`（install-skills.sh:66），安装态 `~/.dsh/skills/mp-grilling/` 与本仓正本逐字一致。
4. `skills/README.md` 档位说明已含补丁语义（「questions written to an approval document before they are asked」）。

**处置**：补丁唯一正本 = 本仓 `skills/grilling/SKILL.md`；mp 源仓 `git restore` 回归纯上游（还原前经逐字对拍证实零损失，还原后工作区干净）。**单一真相源**：我方对上游 skill 的改造只留本仓一处，随 install 统一分发；上游仓永久保持无痕 clone，后续 pull 不产生冲突面。

## 三、落地清单

| 类型 | 动作 | 证据 |
|---|---|---|
| 代码（零改动，配置已存在） | install-skills.sh 无需修改——主循环 glob + 映射早已覆盖 | install-skills.sh:62-66 |
| 数据（源仓还原） | mp 源仓 `git restore skills/productivity/grilling/SKILL.md`；还原前 `diff`（工作区版 vs 本仓版）exit=0 证实两份拷贝逐字一致 | 还原后 `git status` 0 项、ahead=0 |
| 验证 | 本仓正本 = 上游原版 + 补丁节（`git show HEAD:` 对拍）；安装态 mp-grilling = 本仓正本（`diff` exit=0） | 本档 §二 |

## 四、口径沉淀（本拍板的普适规则）

「上游 mp 仓的本地改动」不是正本——凡我方对上游 skill 的改造，落本仓 `packages/dsh-plan-view/skills/<skill>/`（主循环自动分发），mp 源仓立即还原纯上游；发现一处收编一处，不留第二拷贝。此规则与「skills 源同步与引入判定」偏好的方向题条款互补：源同步看上游升级是否可引入，本拍板管我方补丁不许漏出本仓。
