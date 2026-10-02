---
type: task
---

# 06: 协议与 wayfinder 状态契约对齐（重新定性版）

**Status:** resolved
**Blocked by:** None — can start immediately

> **〔重新定性声明（2026-09-27）〕** 本票原版（2026-09-27 立）把冲突定性为「**我方协议 vs 上游 `wayfinder-maps` 工具**」，并据此列出三选项 A（改工具）/B（改协议）/C（分治）。**该定性的证据基础经复核不成立**——原版所引的 `~/workdir/wayfinder-maps` 路径**在当前环境中不存在**，其「上游原文」实为**本仓文件**。按用户指示「重新定性吧」，本票整体重写。
>
> **原版与相关 handoff 的实测数据一律存疑、待复核**（见 §五），不再作为裁定依据。

---

## 一、重新定性：这是**本仓内部两个 skill 契约互相矛盾**

【实测】冲突的双方**都在本仓** `packages/dsh-plan-view/skills/` 内：

| 侧 | 文件 | status 立场 |
|:--|:--|:--|
| **A. 协议层** | `plan-protocol/SKILL.md` | 票态**两种合法形态**：frontmatter 形态（`status` 写在 frontmatter，实施图票终态 = **`done``**）；wayfinder 推导形态（`status` 不入 frontmatter） |
| **B. wayfinder 契约层** | `wayfinder/TRACKER-MARKDOWN.md:55` | **"There is no `status:` field."** —— status **只推导、不存**；来源为 `## Answer` / `## Ruled out` / `claimed_by` |
| **C. 读取实现** | `src/client/PlanView.tsx`（本仓插件） | `displayStatus()` 先看结论节，**再看 frontmatter `status`**，`done` 等折成内部态 `resolved`（`:93,105-114`） |
| **D. 校验实现** | `plan-approve/scripts/plan-lint.sh:175` | 词表 `open/claimed/done/resolved [日期]/out_of_scope` —— **认 `done`** |

**矛盾点**：**B 说「不存在 status 字段」，A/C/D 都在读或要求这个字段。**

**这不是「我方 vs 外部工具」，是「同一仓内，wayfinder 契约与其上位协议不一致」。**

---

## 二、本仓三个实现对「推导形态」的处理

【实测】三个环节对 wayfinder 原生形态（`## Answer` 推导）的支持：

| 环节 | 是否支持推导形态 |
|:--|:--|
| 插件读取（`displayStatus`） | ✅ 支持——**先**判 `t.resolved`（`## Answer`）与 `t.outOfScope`（`## Ruled out`），**结论节优先于 frontmatter** |
| plan-lint 校验 | ⚠️ **仅作容错**——`:175` 词表含 `resolved`，但校验对象是 `type: task` 的 `status-header`；推导形态票**不入校验** |
| 协议文字 | ✅ 明文承认（`plan-protocol:104`「票态有两种合法形态…推导形态的格式契约正本 = wayfinder `TRACKER-MARKDOWN.md`」） |

**即：读取层两种都认；校验层只认 frontmatter 形态。**

---

## 三、真实规模（【实测】，全 workdir 非归档票）

```
103  status: done              ← 主要形态
 17  status: open
 10  status: resolved 2026-09-19
  5  status: resolved
  4  status: resolved 2026-09-20
  2  status: claimed
  1  status: resolved 2026-09-24
```

**共 142 张票，其中 `status: done` 103 张（73%）。** 这与 wayfinder 契约「There is no `status:` field」**直接冲突**——按 B 的字面规定，**这 103 张票全部违规**，但在 A/C/D 眼中全部合法且被正确读取。

**所以现状是：本仓绝大多数票走的是一种 wayfinder 明文否定的写法。**

---

## 四、最终裁定：与 `plan-protocol` 全局对齐，wayfinder 改从协议（2026-09-27）

> **⚠️ 本节定性已被用户当场更正，本票 §四 以下初版内容（含「向原版对齐」）全部作废。**

**用户原话（照抄，更正）**：

> 「status 这个表述我理解是错误的，**是和 plan-protocol 对齐，内部保持一致**」
> 「**全局一致，不兼容 wayfinder，wayfinder 要改成和协议一致**」

**裁定**：**`plan-protocol` 是 status 的唯一格式正本**；`wayfinder` 改从协议；**不存在「向原版对齐」这件事**（原版工具 `wayfinder-maps` 已废弃，决策 13 旁证）。**不兼容**——推导形态不再作为合法票态。

**本票地位变更**：本裁定的**正本已转入** `.scratch/doc-authority/spec.md` 决策 12（最终版），**承载票转为** `.scratch/doc-authority/tickets/04-status与协议全局对齐.md`。本票**降为过程留痕**，不再是实施承载。

**回扫范围**：103 张 `status: done`（novel 87 ＋ dsh-plugin 9 ＋ nvwa 7）——**回扫另立票**，判据＝协议单一词表定案后按新词表拉齐；**不再要求补 `## Answer` 节**。

---

**〔以下为初版内容，全部作废，保留作历史留痕〕**

**初版用户原话（照抄）**：

> 「我需要确认这个和 mp 原版的 wayfinder 是否一致，原版 wayfinder 支持这个状态么，**如果不支持，那就是我们仓库自有的，那就统一**」
> 「wayfinder-maps 废弃了」

**初版解读**：这是一句条件式裁定——条件＝「原版不支持 status」；裁定＝「那就统一」。

**条件已核实成立**（【实测】三重证据）：

| 证据 | 内容 |
|:--|:--|
| 文件史 | `TRACKER-MARKDOWN.md` 仅两提交：`8c9a91d`（引入）＋ `259155d`（改名，该文件 diff **`\| 0`**、「No method content changed」） |
| 原版内容 | `git show 8c9a91d:...` 第 55 行即 **"There is no `status:` field."** |
| 原版词表 | `type: research \| prototype \| grilling \| task`（无 `impl`） |

**初版裁定（已作废）**：以 mp 原版为准，撤回我方 `plan-protocol` 自加的 status 扩展，统一为 wayfinder 原生推导形态。

**故本票 §四 原列的甲/乙/丙三选项作废**——甲（承认扩展）、乙（向原版对齐）、丙（表述分层）**三者均作废**：正确落点是「**以 `plan-protocol` 为准**」，三个选项里没有这一项。原选项表保留于下方存档。

**初版实施归属**：本裁定已并入 `.scratch/doc-authority/spec.md` **决策 12**（该版亦已作废）。

---

## 四·附、原选项表（已作废，存档）

| 选项 | 做什么 | 影响 |
|:--|:--|:--|
| **甲** | 以**协议**为准，**修订 wayfinder 契约** | 与 103 张存量票、插件、plan-lint **全部一致**；不需回扫。**代价**：修改 vendored 的 wayfinder 契约，属本地偏离 |
| **乙** | 以 **wayfinder 契约**为准，**修订协议** | **需回扫 103 张 `status: done` 票**，且要给无 `Answer` 节的实施图票补正文终态节。改动量大 |
| **丙** | **明确分层**，承认两形态各有适用面 | 零回扫；**消除「谁是谁的正本」的表述矛盾** |

> **作废说明（2026-09-27）**：三选项的设定前提是「统一方向未定」。用户后续原话已给定方向（「那就是我们仓库自有的，那就统一」），故甲、丙出局。**保留本表仅供追溯当时的选项设计。**

---

## 五、原版证据的复核状态（如实标注）

| 原版结论 | 复核状态 |
|:--|:--|
| 引用路径 `~/workdir/wayfinder-maps` | ❌ **该路径当前不存在**（【实测】`ls -d ~/workdir/*wayfinder*` 空、全盘 find 仅命中 `~/Library/Application Support/wayfinder-maps`） |
| 「上游原文：There is no `status:` field…」 | ⚠️ **该句确在 `packages/dsh-plan-view/skills/wayfinder/TRACKER-MARKDOWN.md:55`**——**是本仓文件**，原版误标为「上游」 |
| 「`wayfinder-maps status` 读 `.plan/micro-fixes` 成 4 open」 | ⚠️ **待复核**——依赖上述不存在的路径与工具 |
| 「novel 17 个 effort 零通过 lint」 | ⚠️ **待复核**——同上 |
| 「三处未对齐：status 存/不存、词表无 done、blocked_by 引号致解析中止」 | ⚠️ **前两条已由本次重新定性取代**（改为本仓内部矛盾）；**第三条（`blocked_by` 引号）已于 2026-09-27 另行裁定统一格式并落地**（见 §六） |
| 「带引号 blocked_by 致整图解析中止（`splitNums` 用 `strconv.Atoi`）」 | ⚠️ **工具侧结论待复核**；但**格式统一已独立完成**，不依赖该结论 |

---

## 六、已独立完成的部分（不受本次重新定性影响）

【文档已写明】用户 2026-09-27 裁定，**已落地**：

1. **`impl` 不支持并从协议清理**——协议「图二型」「`type` 取值约定」已改；插件 `LEGACY_TICKET_TYPES` 已删、`TICKET_TYPES` 收为 `['task','research','prototype','grilling']`；`install-skills.sh` 分发后双拷贝 md5 一致；
2. **`blocked_by` 格式统一**——以 `plan-protocol` §三新增条款为**格式正本**（裸写不加引号、`[]` 为唯一合法空值），`wayfinder/TRACKER-MARKDOWN.md` 与 `to-tickets/SKILL.md` 模板指向它。

**这两项独立于「A/B/C 工具之争」，不因本次重新定性而撤销。**

> **〔2026-09-27 追加〕第 3 项亦已完成**：决策 12 的最终定性（**与 `plan-protocol` 全局对齐**）已落盘，承载票为 `.scratch/doc-authority/tickets/04-status与协议全局对齐.md`。

---

## 七、关联

- **票 07**（`07-nvwa存量impl票回扫.md`）：`impl` 回扫——本次重新定性不影响，但其中「删插件容错」项**已于 2026-09-27 完成**；
- **同源议题**：`.scratch/doc-authority/`（文档权威治理：spec 一次性化）——**方向一致**，均属「承认我方协议层、不再指向外部正本」；
- **本票的接班人**：`.scratch/doc-authority/tickets/04-status与协议全局对齐.md`（决策 12 最终版承载票）。**本票降为过程留痕**；
- **原 handoff**：`.plan/handoffs/2026-09-27-协议与wayfinder状态契约对齐.md`——**其所载实测证据须按 §五 复核后方可引用**。

## Acceptance

**〔本节已随定性更正重写〕本票不再是实施承载**，故原「甲/乙/丙」验收项作废，改为**过程留痕完整性**验收：

- [x] 裁定落盘（含用户原话）——三轮定性全部留痕，含被推翻的两轮及根因
- [x] 指明接班人（票 04）与回扫归属（另立票）
- [x] 独立完成项（`impl` 清理、`blocked_by` 统一）标注不受影响
- [x] 收尾 plan-lint 零漂移（2026-09-29 本仓收口实跑 0 发现，票 09 批次）
