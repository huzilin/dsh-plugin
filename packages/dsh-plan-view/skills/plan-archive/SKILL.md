---
name: plan-archive
description: Archive completed plan work one round at a time — a finished round (grill/wayfinder → impl, the whole directory tree) is git-mv'd into `.archive/rounds/<round-id>/` with its structure intact, approval docs already flipped to `archived:` travel with the round while unmarked ones stay in `.plan/`, and superseded conclusions are marked outdated in place. Run manually when a round has shipped; never automatic — archiving is irreversible.
disable-model-invocation: true
---

# Plan Archive（按轮归档）

Plan 内容完成后会堆积：整轮走完的推演地图、票、spec、待拍板。它们不删，但留在治理目录会**污染新决策**——下一轮 agent 读到一份过期 spec，会把其中已废弃的结论当真。这就是 `.archive/` 存在的理由。本 skill 把"归档纪律"变成**可执行的动作**。

## 归档单元：轮（round）

一段 plan 工作的自然单位不是单个文档，而是**一轮完整任务**：从输入端（grill 拷问 / wayfinder 推演 / 补充流问题拍板）到落地链收尾（implement 完成、plan-sync 对账完毕）的一次闭环。一轮走完，属于这轮的全部内容**整轮一次归档**，不散件挑拣。

**为什么按轮**：

- 轮内文档互相引用成网，散件归档必然拆断引用、拆散上下文；整轮搬迁，上下文与引用一起走。
- 归档区按轮组织，后续 plan 会话要查历史时**按轮切读**：一轮目录就是当时完整的视图（推演地图 + 票 + 拍板 + 交接一条线），不用跨散件拼图。

**归档时机 = effort 全消后的轮归档**：不设独立批量归档时机——qa 中缺陷和台账全消、effort 才能翻转，全部解决后才归档。全局 qa/ledger 为**全局件**，常驻 `.plan/qa|ledger/`、不随轮迁（非轮成员——随轮走的只是图内 qa/ledger；词表正本 = `plan-protocol` §三「全局件」条）。

**一轮的物理成员**（归档前先列清单）：

- effort 目录：`.scratch/<effort>/`（`map.md` + `issues/` + `spec.md` + `assets/` + 图内 `qa/`、`ledger/`）
- 该轮已翻标的**图内**待拍板文档（该 effort 的 `.scratch/<effort>/approval/` 下、带 `archived: <归宿>` 标记者——G1 判别器 = 标记本身；未翻标者留下，不搬）
- **全局审批档（`.plan/approval/` 下已翻 `archived:` 标记者）随该轮一并搬走**（不为全局档单设归档时机，搭 effort 归档的车）。判别器同 G1 = **标记本身**——已翻标者搬，未翻标者留 `.plan/approval/` 继续等。全局档跨图、无轮归属，故只有「标记」能决定它何时走
- 该轮的 handoff / 过程文档（现行落 `.tmp/handoffs/`，存量 `.plan/handoffs/` 只读兼容）

**轮完成前置判据（G4，全满足才可搬）**：

1. 轮内全部票终态（`resolved` / `out_of_scope`，plan-sync 对账完毕）且被测票 `qa_accepted` 齐；
2. 轮内缺陷全部「已关闭」；
3. 轮内台账条目全部「已销 / 已转票」；
4. spec 已带 `superseded-by:` 注记或归宿行齐备；审批档全 `closed` / `superseded-by:` / `abandoned` 或已翻 `archived:`。

未满足先补标再归档，不带病搬迁。

**本 skill 是 plan 流程的环节之一（整轮落地之后、归档期）。** 它在流程中的位置、与各 skill 的交接契约，见 `plan-protocol` skill（公共协议层）。

**手动触发，不自动跑。** 归档搬动文件且 `git mv` 不可逆——必须由人决定何时、归档哪一轮。这和 `plan-approve` 一样是带状态的收口动作。

## Process

1. **确认归档轮次。** 不要整仓无差别归档。按「轮完成前置判据」列出候选轮，每轮附成员清单（effort 目录 + 已翻标待拍板 + handoff），交给用户确认范围，再动手。

2. **确保归档区纪律文件存在。** 若 `.archive/README.md` 不存在，先创建它（模板见本文件末尾）。它写三件事：归档纪律（`git mv` 保留历史、「勿据以实现」）、「轮次索引」表、「现行权威」指针表。这一步只做一次；之后每次归档都更新这两张表。

3. **头部归档标识 + 整轮 `git mv`，目录结构原样。** 先给全部轮成员补头部标识——frontmatter 增 `archived: <round-id>`（无 frontmatter 的文件在首行加 `<!-- archived: <round-id> -->` 注释）——然后搬：

   ```
   git mv .scratch/<成员相对路径> .archive/rounds/<round-id>/<成员相对路径>
   git mv .scratch/<effort>/approval/<已翻标待拍板> .archive/rounds/<round-id>/<原相对路径>
   git mv .plan/approval/<已翻标全局待拍板> .archive/rounds/<round-id>/approval/<原文件名>
   ```

   - `round-id` = `YYYY-MM-DD-<主题slug>`（取轮收尾日期 + effort 名或主要拍板主题）。
   - **成员相对源目录的路径在轮目录内原样保留**——轮目录就是这一轮当时 `.scratch/`（＋随轮审批档）的快照。这是「保持目录完整」的硬约束：轮内所有相对引用因此原封不动继续有效。
   - 头部标识与 `git mv` 同批完成——任何 agent 之后直读归档文件（哪怕脱离轮上下文、哪怕检索命中），第一眼即见「已归档、勿据以实现」。
   - 不用普通 `mv` / `cp`+`rm`——`git log --follow .archive/rounds/<round-id>/<path>` 必须能溯到原位置。

4. **轮内引用核查（相对路径纪律）。** 整树搬迁后，轮内互引只有一种情况会断：写了仓库根相对路径或绝对路径。逐份抽查轮内文档互引：

   - 轮内互引按 plan-protocol「文档形态约定」一律相对路径；归档时逐份抽查是兜底。
   - 发现轮内引用写成 `.plan/...` / `.scratch/...` 开头或绝对路径的，就地改成相对路径。
   - 轮内指向轮外（架构正本等全局文档）的引用不用改——正本不搬。

5. **轮外断链巡检（只报不改，R2）。** 前提：全量权威已收敛 docs、权威文档**禁止持有指向 tracker 区（`.plan/`/`.scratch/`）的活引用**（spec 已一次性化＋归宿行＋禁反向指向——`to-spec` 的「决策来源」记在归宿行/审批档内，随轮归档可达）。因此归档时轮外**不应存在**指向被归档成员的活引用：

   - 巡检范围：轮外全部活文档——`docs/`（总架构文档及其文档地图）、CONTEXT.md、`.plan/` 内其他活跃轮、`.archive/` 自身（含既有轮次索引与现行权威表）、`.tmp/`。
   - 搜旧路径的**文件名**与**完整相对路径**两遍；发现活引用即**登记协议违例**（写侧纪律回溯项，报告给用户），**不代改**——修复归该文档归属会话。
   - 「仍被实现引用、不能随轮归档」的成员不在此列：它根本不搬，就地加偏差声明留在原处（步 6）。

6. **「仍被实现引用、不能随轮归档」的成员——就地加偏差声明，留在原处不搬。** 有些文档代码还在读，不能搬。在文件头加「偏差声明」或「部分过时声明」，指明哪些章节以新定稿为准；轮次索引里为它记一行缺席说明。把它登记进归档区 README 的「未归档但仍带过时口径」表。

7. **已过时但仍有留存价值的结论——标注过时 / 废弃，不删除。** 留在原文档，给过时段落加标记：**谁取代它、何时、还留着有什么用**（三个要素缺一不可）。禁止「待拍项已作废却仍留 `status: pending`」——文档状态与正文口径要一致。

8. **更新 `.archive/README.md` 的两张表。** 「轮次索引」表：本轮追加一行（round-id / 主题 / 起止 / 成员清单 / 缺席成员说明）——后续会话查历史从这里按轮切读。「现行权威」表：被归档且事实已由正本收编的条目，移除或改指正本（如已收编进总架构文档的旧 spec，从权威表删去、改指正本）。

9. **检索面收口 + 提交。** 确认 `.zcodeignore`（DSH 侧 `excludedDirectories`）已排 `.archive/`——**归档完成 = 出检索面**，未排则提醒用户配置。然后一轮一个 commit，范围 = 头部标识 + `git mv` + 轮内引用核查 + 断链巡检报告 + README 更新。不要混进其他工作——归档是可审计的动作。

## 完成判据

轮成员整体迁入 `.archive/rounds/<round-id>/` 且目录结构原样、全部带 `archived:` 头部标识；源目录里该轮零散件残留（未翻标审批档按 G1 留 `.plan/` 属正常）；轮内互引全部相对路径有效；断链巡检已报告（轮外零未登记活引用）；README 轮次索引与现行权威表和现状一致；检索面已排除 `.archive/`；已过时结论就地标了三要素；一个干净的归档 commit。

## 不要做什么

- **不自动跑。** 触发权在用户。
- **不改代码。** 本 skill 只动计划文档与引用，不碰实现。
- **不新写 spec。** 归档的是**已走完**的轮次；新需求走 `to-spec`。
- **不删文件。** 一切走 `git mv` 进 `.archive/`；`.archive/` 内的过时结论只标不删。
- **不散件归档。** 单个文档不单独搬家——它属于某轮，就等那轮一起走。文件搬移只发生在轮归档（`plan-approve` 只翻状态，不搬文件）。
- **不代改轮外引用。** 巡检只登记；代改会掩盖写侧纪律违例（R2）。
- **不搬全局 qa/ledger。** `.plan/qa/`（无图归属缺陷与回测测例）与 `.plan/ledger/`（全局台账）**不是轮成员，永不随轮搬**。它们是常驻件、有自己的生命周期。
- **但全局审批档例外——要搬。** `.plan/approval/` 下**已翻 `archived:` 标记**的全局档随该轮一并搬走（归档 effort 时把已翻标的全局 approval 一并归档）。判别器同 G1：**看标记，不看目录**——已翻标者搬，未翻标者留在 `.plan/approval/` 继续等。全局档跨图、无轮归属，标记是它唯一的"可以走了"信号；**不要**把未翻标的档一起卷走，那会把仍在用的提问埋进历史快照。

## `.archive/README.md` 模板（不存在时创建）

```markdown
# .archive · 历史归档（YYYY-MM-DD 起）

> **本目录 = 历史归档，勿据以实现。** 设立缘由：多轮讨论后老文档易堆积冲突、污染 agent 认知。
>
> 归档一律整轮 `git mv` 保留完整历史：`git log --follow .archive/rounds/<round-id>/<path>` 可溯。
> 轮目录 = 该轮当时 `.scratch/`（＋随轮审批档）的快照，目录结构原样；轮内引用为相对路径，整树搬迁不失效。
> 成员头部带 `archived: <round-id>` 标识；本目录已出检索面（.zcodeignore / DSH excludedDirectories）。
> 归档区的原话引用、审计结论、已关闭拍板记录**只作决策留痕**，不得作为实现依据或重新拍板的起点。

## 轮次索引（按轮切读历史，从这查）

| round-id | 主题 | 起止 | 成员清单 | 缺席成员及原因 |
|:--|:--|:--|:--|:--|
| （每轮归档追加一行；后续会话按轮目录读完整视图） | … | … | … | … |

## 现行权威（不在本目录）

| 领域 | 权威文档 |
|:--|:--|
| （按本仓库实际权威文档填写；被归档且事实已收编进正本的，此处不列） | … |

## 未归档但仍带过时口径的文档（就地改 + 加声明，不归档）

| 文档 | 处置 |
|:--|:--|
| （仍在被实现引用的文档，加偏差声明后登记） | … |
```
