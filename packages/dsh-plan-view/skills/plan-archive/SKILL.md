---
name: plan-archive
description: Archive completed `.plan/` content — git-mv finished tickets and documents into `.archive/`, sweep the references that pointed at them, and mark superseded conclusions as outdated/deprecated in place. Run manually when a body of plan work has shipped; never automatic — archiving is irreversible.
disable-model-invocation: true
---

# Plan Archive（归档流程化）

Plan 内容完成后会堆积：老 spec、老待拍板、已完成工单。它们不删，但留着会**污染新决策**——下一轮 agent 读到一份过期 spec，会把其中已废弃的结论当真。这就是 `.archive/` 存在的理由。本 skill 把"归档纪律"变成**可执行的动作**。

**本 skill 是 plan 流程的环节之一（落地链之后、归档期）。** 它在流程中的位置、与 `.archive/README.md` 的关系、引用/过时管理规则，见同仓 `skills/plan-protocol/SKILL.md`（公共协议层）。

**手动触发，不自动跑。** 归档搬动文件且 `git mv` 不可逆——必须由人决定何时、归档哪些。这和 `plan-approve` 一样是带状态的收口动作。

## Process

1. **确认归档范围。** 不要整仓无差别归档。先列出候选：已完成（`status: done/closed`）且无未决引用的工单；已 `closed`/`superseded-by:`/`abandoned` 的待拍板文档；已被后来定稿整体取代的设计稿。把清单交给用户确认范围，再动手。

2. **确保归档区纪律文件存在。** 若 `.archive/README.md` 不存在，先创建它（模板见本文件末尾）。它写两件事：归档纪律（`git mv` 保留历史、「勿据以实现」）与「现行权威」指针表。这一步只做一次；之后每次归档都更新这张表。

3. **归档用 `git mv`，保留历史。**

   ```
   git mv .plan/<path> .archive/<path>
   ```

   不要用普通 `mv` / `cp`+`rm`——`git log --follow .archive/<path>` 必须能溯到原位置。归档区内部按原目录名保留（如 `.archive/ai-novel-workbench/`、`ai-novel-workbench-tickets/`）。

4. **sweep 引用，改指新位置（关键，最易漏）。** 任何指向被归档旧路径的引用都会断。全仓搜旧路径名，逐处改指 `.archive/` 新位置：

   - 搜的范围：**整个仓库的活文档**——`.plan/`、`.archive/README.md` 的「现行权威」表、`docs/`、`CONTEXT.md`、架构正本（novel 的 `docs/architecture.md` 及其 §文档地图）、各设计定稿、handoffs。
   - **也包括 `.archive/` 自身**：2026-09-18 真实事故——某次 sweep 排除 `.archive/`，结果归档区内部的「现行权威」表仍指旧路径，留下断链。归档区的指针同样要维护。
   - 搜旧路径的**文件名**（如 `tech-spec.md`）与**完整相对路径**两遍，避免只换了一处。
   - 改完零残留后才算这一项完成。报告改了几处。

5. **「仍被实现引用、不能整体归档」的文档——就地加偏差声明。** 有些文档代码还在读，不能搬。在文件头加「偏差声明」或「部分过时声明」，指明哪些章节以新定稿为准，不移动。把它登记进归档区 README 的「未归档但仍带过时口径」表。

6. **已过时但仍有留存价值的结论——标注过时 / 废弃，不删除。** 留在原文档，给过时段落加标记：**谁取代它、何时、还留着有什么用**（三个要素缺一不可）。禁止「待拍项已作废却仍留 `status: pending`」——文档状态与正文口径要一致。

7. **更新 `.archive/README.md` 的两张表。** 「现行权威」表：被归档且事实已由正本收编的条目，移除或改指正本（如 novel 的三份旧 spec 已收编进 `docs/architecture.md`，从权威表删去、改指正本）。「归档内容」表：追加本次归档的每行（路径 / 来源 / 说明）。

8. **提交。** 一次归档一个 commit，范围 = `git mv` + 引用 sweep + README 更新。不要混进其他工作——归档是可审计的动作。

## 完成判据

被归档路径在全仓（**含 `.archive/` 自身**）零残留引用；`.archive/README.md` 两张表与现状一致；已过时结论就地标了三要素；一个干净的归档 commit。

## 不要做什么

- **不自动跑。** 触发权在用户。
- **不改代码。** 本 skill 只动计划文档与引用，不碰 `be/` `fe/` 实现。
- **不新写 spec。** 归档的是**已完成**的内容；新需求走 `to-spec`。
- **不删文件。** 一切走 `git mv` 进 `.archive/`；`.archive/` 内的过时结论只标不删。

## `.archive/README.md` 模板（不存在时创建）

```markdown
# .archive · 历史归档（YYYY-MM-DD 起）

> **本目录 = 历史归档，勿据以实现。** 设立缘由：多轮讨论后老文档易堆积冲突、污染 agent 认知。
>
> 归档一律用 `git mv` 保留完整历史：`git log --follow .archive/<path>` 可溯。
> 归档区的原话引用、审计结论、已关闭拍板记录**只作决策留痕**，不得作为实现依据或重新拍板的起点。

## 现行权威（不在本目录）

| 领域 | 权威文档 |
|:--|:--|
| （按本仓库实际权威文档填写；被归档且事实已收编进正本的，此处不列） | … |

## 归档内容

| 归档路径 | 来源 | 说明 |
|:--|:--|:--|
| （每次归档追加一行） | … | … |

## 未归档但仍带过时口径的文档（就地改 + 加声明，不归档）

| 文档 | 处置 |
|:--|:--|
| （仍在被实现引用的文档，加偏差声明后登记） | … |
```
