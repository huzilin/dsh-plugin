---
type: task
blocked_by: [01, 02]
status: done
---

# 03 `implement*` / `to-spec` 落「读时检查 + 定稿即更新 docs」

## 执行记录（2026-09-27 完成）

**⚠️ 本票执行中发现的一个重大前提错误，已当场纠正（用户指正）**

本票原写「锚点：`packages/dsh-plan-view/skills/implement/SKILL.md`」——**这个路径不存在**。实测：`implement` / `implement-spec` **在本仓没有源正本**，`install-skills.sh` 自己写明「implement* 无正本不在此列」，它们只存在于上游仓与安装态。

**用户裁定（原话照抄）**：

> 「2 是标准，必须这么实现，已经第二次这个问题 ，上次我严正声明过禁止」

**裁定语义**：**凡我方要改的 skill，必须先在本仓建源正本、再经 `install-skills.sh` 分发**；**禁止直接改安装态**（`~/.dsh/.agent-presets/...`）——那是散落的第二份拷贝，改它等于绕开单一真相源。**此类错误已是第二次，用户此前已严正声明禁止。**

**已按标准落地**：

| # | 动作 |
|:--|:--|
| 1 | 在本仓建源正本 `skills/.optional/implement/SKILL.md`、`skills/.optional/implement-spec/SKILL.md`（**保留用户既有定制**：落地即翻票、plan-lint 收口等，逐条并入，未丢弃） |
| 2 | 读时检查写入两个正本（`implement-spec` 升为**必做步骤 2**；`implement` 置于正文首段） |
| 3 | `install-skills.sh` 增加**受管档位**：`implement`/`implement-spec`/`to-spec` 改为**每次覆盖同步**（原为「已存在则跳过」，且 id 生成 `sed 's/-//g'` 会把 `implement-spec` 错拼成 `implementspec`，**根本装不到**） |
| 4 | 其余 `.optional` skill 维持「只播一次、不覆盖」——它们是用户可就地定制的上游 skill，覆盖会毁掉本地改动 |

**分发验证**：`mp-implement`／`mp-implement-spec`／`mp-to-spec` **三份双拷贝逐字节一致**；读时检查与归宿段均已入安装态（各 grep 命中 1）。

---

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
