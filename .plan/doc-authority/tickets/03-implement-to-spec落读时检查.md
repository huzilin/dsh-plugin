---
type: task
blocked_by: [01, 02]
status: open
---

# 03 `implement*` / `to-spec` 落「读时检查 + 定稿即更新 docs」

## 交付什么

给 `implement` / `implement-spec` 加**读时检查**硬规则，给 `to-spec` 加**定稿即更新 docs** 动作。前者是过渡期护栏，后者是时点钉死。

## 为什么需要

本 spec 的产品级立意是「spec 退化为一次性实施文档」。但**光有协议条款不够**——执行 skill 不照做，规则就是废纸。实测：上游 `to-spec` / `implement` 对「文档作废」**零覆盖**，唯 `plan-archive` 有 8 处提及，而它在**归档时才动作（太晚）**。

## 具体内容

| 来源决策 | 落点 skill | 要加的内容 |
|:--|:--|:--|
| 决策 8（拍板项 3 选 A） | `implement` / `implement-spec` | 动手前**检查目标 spec 是否存在取代声明／是否已归档**；有则**先读 docs 正本**，并在票面留痕「**已核新正本：\<path\>**」 |
| 决策 9 | `to-spec` | docs 更新**钉在「spec 定稿那一刻」**，与现有动作合并——**不等到「关闭 effort 后」**（那时上下文已散） |

**决策 8 的定位必须一并写明**：这是**过渡期护栏**，不是终态机制——spec 一次性化全面落地前，历史 spec 仍会被读到。

## 锚点（写在哪）

- `packages/dsh-plan-view/skills/implement/SKILL.md`（及 `implement-spec`，若为独立 skill）
- `packages/dsh-plan-view/skills/to-spec/SKILL.md`

**分发**：改源仓后执行 `bash packages/dsh-plan-view/scripts/install-skills.sh`，落到 `~/.dsh/.agent-presets/full/skills/`。

## 依赖说明

`blocked_by: [01, 02]` —— **必须先有协议条款才知道该检查什么**。决策 8 的「取代声明」形态、决策 9 的「docs 正本」落点，都定义在票 01／02 的条款里；协议未定就写 skill，必然写成两套。

## 验收标准（外部可观察）

1. `implement` 流程中存在**可执行**的「检查 spec 是否作废」步骤，非建议性措辞；
2. `to-spec` 流程中 docs 更新动作**挂在定稿节点**，非关闭节点；
3. **双拷贝 md5 一致**（源仓 vs `~/.dsh/.agent-presets/full/skills/`）；
4. **反向验证**：构造一份带取代声明的 spec，跑 `implement` 流程应停下要求先读 docs。

## 诚实边界

本票产物是 **skill 指令文本**，不是运行时代码——**「读时检查」由 agent 按指令执行，无程序化门禁**。这是决策 8 选择的形态（选 A）的固有代价，如实标注。
