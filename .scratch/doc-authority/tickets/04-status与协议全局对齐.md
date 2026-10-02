---
type: task
---

# 04 status 与 `plan-protocol` 全局对齐（wayfinder 改从协议）

**Status:** resolved
**Blocked by:** None — can start immediately

## 执行记录（2026-09-27 完成）

**已完成全部落点**：

| 落点 | 改动 | 验证 |
|:--|:--|:--|
| `plan-protocol` §三票面 status 词表 | 主句已统一为「终态 = `done`（不分票型）」；新增「四套状态机互不套用」子条款 | grep 零残留 |
| `plan-protocol` 收口纪律 | 删去复述，改为「正本见 §三，本节不另立」——**消第二处定义** | — |
| `wayfinder/TRACKER-MARKDOWN.md` | 「There is no `status:` field」段改写为**从协议**（词表正本指向 `plan-protocol`）；推导表 `resolved` → **`done`**；新增「`done` 与 `out_of_scope` 不是同义」段 | — |
| `wayfinder/SKILL.md` | **逐处判定**：`:66/:68/:74/:106` 等**票态词**改 `done`；`:30` 计数示例、`:47/:49` 索引模板、`:82/:83/:133` 动词与英文词义**保留**（改词须保义） | `resolved` 仅剩 1 处动词 |
| `to-tickets` | 模板注释已指向协议正本 | — |
| `plan-lint.sh` | 词表移除 `resolved`，单独报废弃词 | 探针实测拦截生效 |
| 插件读取层 | 见票 05 | 产物核对通过 |

**必须保义的区分已保住（用户裁定「区分」）**：

- `wayfinder/SKILL.md:66` — 阻塞判定为「every ticket it lists is `done`」；
- `wayfinder/SKILL.md:68` — 「`out_of_scope` is closed, and closed is not `done`: **it satisfies no blocking edge**」；
- `TRACKER-MARKDOWN.md:70` — 新增整段明示：`done` 是路线经过、`out_of_scope` 是路线刻意绕开；**只有 `done` 满足阻塞边**，塌陷两者会让边界静默算作一步。

**顺手修掉一个真缺陷：陈旧孤儿副本 `mp-wayfinder`**

- **发现**：安装区存在两个 wayfinder 目录——`wayfinder`（`install-skills.sh` 实际维护，§:71 默认命名）与 `mp-wayfinder`（**陈旧孤儿**，早于一次改名遗留，**无任何脚本或配置引用**）；
- **实测**：两者 inode 不同（非硬链），且 `mp-wayfinder` 差 **34 行**、停在旧文本（`resolved` md5 `2438eb2b…` vs 现行 `5b6274ff…`）；
- **对照**：`domain-modeling`/`prototype`/`research` 三个同名对**内容一致**，唯 `mp-wayfinder` 陈旧——**证明它是孤儿而非设计如此**；
- **处置（用户裁定「删除并在后续用我们改好的 wayfinder 替换」）**：删除后用改好的版本重建，**三处现已逐字节一致**（md5 `5b6274ffc681203a9d05f027fdf35179`）。

**验证**：三处 wayfinder 一致性 ✓；`plan-lint` 通过。

---

## 交付什么

把票态**收为单一真相源**：`plan-protocol` 定为 status 的**唯一格式正本**，`wayfinder` 改为**从协议**，仓内不再存在第二套票态口径。

## 为什么需要（本票的定性已被用户纠正，务必按新定性执行）

**用户 2026-09-27 原话（照抄）**：

> 「status 这个表述我理解是错误的，**是和 plan-protocol 对齐，内部保持一致**」
> 「**全局一致，不兼容 wayfinder，wayfinder 要改成和协议一致**」

**被推翻的旧定性**：本 spec 决策 12 曾写「以 mp 原版为准，**撤回我方 status 扩展**」——**这个方向是错的**。用户 ③ 明确：不存在「向原版对齐」，**`plan-protocol` 才是格式正本**。决策 13（`wayfinder-maps` 废弃）已从旁佐证原版工具不是我方基准。

**用户同时否掉了「兼容」路线**：不是「两形态并存但边界清楚」，而是**一套权威**——wayfinder 的推导形态**不再作为合法票态**，wayfinder 文本本身要改。

## 实测到的真实矛盾（改协议的依据）

`plan-protocol` §三第 104 行**自相矛盾**：

- 该行**明文合法化两形态**，并声明「**推导形态的格式契约正本 = wayfinder `TRACKER-MARKDOWN.md`**」；
- 而它指认的那份正本，第 55 行写着：**"There is no `status:` field."**（绝对句，无豁免），且给了理由——存字段「would be a second copy — the kind that goes stale in one home and lies from the other」。

**即：协议一边授权第二份拷贝，一边引用一份禁止第二份拷贝的正本。** 这就是「同一事实两处权威」的教科书形态，也是本 effort 要根治的病。

## 具体内容

| # | 落点 | 动作 |
|:--|:--|:--|
| 1 | `plan-protocol` §三「票面 `status` 词表」条（约 104 行） | **重写**：status 只有一种表达，`plan-protocol` 为**唯一格式正本**；删除「两形态共享同一 type 词表」「推导形态正本=wayfinder」等会造成混读的表述；**终态词统一为 `done`（`resolved` 退出词表）** |
| 2 | `plan-protocol` §三「执行登记」条（约 79 行） | 同步：删去「wayfinder 推导形态票…不写 `status`」一类分叉表述 |
| 3 | `plan-protocol` 收口纪律（约 172 行） | 删「research/prototype/grilling = `resolved`」，统一 `done` |
| 4 | `wayfinder/TRACKER-MARKDOWN.md` | **改**（本票核心）：第 55 行「There is no `status:` field」及其论证段改写为**从协议**；推导表 `resolved` 行改 **`done`**；**第 68 行整段论证建立在 `resolved` 这个词上**（「It is the *prose*, not the heading, that closes the ticket」）——**改词须保义，不得机械替换** |
| 5 | `wayfinder/SKILL.md` | 多处把 `resolved` 当**方法概念**用（「closed is not resolved」「a decision recorded as simply `resolved` reads as settled」，及 `:30/:66/:74/:82/:106/:133`）——**逐处判断：票态词（改）还是方法语义（保留）**，**禁止批量替换**。**⚠️ 见下方「必须保义的区分」** |
| 6 | `to-tickets` | 票模板 `status` 注释（`:68`）指向协议格式正本；`resolved` 改 `done` |
| 7 | 插件读取层 | 见票 05（本票只定词表） |
| 8 | `plan-lint` | `:173-175` 词表与报错文案；`:174` 「插件归一容忍别名」注释须与票 05 口径一致 |

**✅ 已闭合的技术判断点（2026-09-27 用户裁定）**：

> **用户原话（照抄）**：「resolved 改为 done」

**终态词统一为 `done`**，`resolved` 退出词表。**这条裁定的最大收益**：存量 103 张票（novel 87／dsh-plugin 9／nvwa 7）用的**正是 `done`**——**统一后存量票无需改词**。故**回扫必要性大幅下降**：不再是「103 张都要回扫」，而是只需查有没有 `resolved`／`closed`／`complete` 这类**别的别名**在用。回扫票的范围与工作量须按此重估。

---

**⚠️ 必须保义的区分：`done` 与 `out_of_scope` 是两回事（2026-09-27 用户裁定「区分」）**

**用户原话（照抄）**：「区分」

**裁定语义**：`done` 与 `out_of_scope` **必须保持区分**，不得因换词而合并或模糊。

**为什么这是硬要求**：wayfinder `:68` 的核心论证**建立在两个态的区分上**——

> 「`out_of_scope` is closed, and closed is not resolved: **it satisfies no blocking edge.** A ticket blocked by an out-of-scope ticket therefore never unblocks — one of the two is mis-scoped, and you should say which.」

**这条区分是阻塞计算的基础**：范围外的票**永远不解除他人的阻塞**。若两者被读成同义，阻塞链条会静默解开——**一张被明确排除的票会被当成已完成**，下游票被误判为可开工。

**换词时必须做对的事**：

| 要求 | 说明 |
|:--|:--|
| **换词不换区分** | `resolved` → `done` 后，`done` 与 `out_of_scope` 的**语义鸿沟必须原样保留**，不得因两者都像「结束」而被合并 |
| **禁止把该句改成同义反复** | 原句「closed is not resolved」换成「closed is not done」后，中文语感下 `done` 与「关闭」极易混同——**须改写为更明确的表述**（如点明「范围外不是完成、不满足阻塞边」），而不是机械换词 |
| **`out_of_scope` 不进决策计数** | 原论证：「It stays out of **Decisions so far**… a scope boundary isn't a step on it.」——**这条也不能因换词而丢** |
| **推导表须逐行核对** | `TRACKER-MARKDOWN.md:57-68` 的推导表：`## Answer`→`done`、`## Ruled out`→`out_of_scope`，两行**不可对调、不可合并** |

**验收**：票 04 完成后，用一张 `out_of_scope` 票 + 一张依赖它的票**实测**——依赖票**必须仍显示为阻塞**。**这是本票唯一可被机械验证的语义约束，不得只做文本核对。**

## 依赖说明

**无前置**（`blocked_by: []`）。**旧的「阻塞于 Ⅰ/Ⅱ/Ⅲ 裁定」已作废**——那个三选一是「以原版为准」这个错误前提逼出来的，前提推翻，选择题消失。

## 验收标准（外部可观察）

1. `plan-protocol` 中**不存在**「第二套正本」表述——全仓 grep 不得再出现「推导形态的格式契约正本 = wayfinder」；
2. `wayfinder/TRACKER-MARKDOWN.md` 的票态表述**与协议逐项一致**（词表、终态、执行登记）；
3. `plan-lint` 通过；
4. skill 分发**双拷贝 md5 一致**；
5. **域一致性 grep**：全仓搜索票态口径，命中处**只能指向 `plan-protocol` 一处**。

## ⚠️ 回扫范围（不在本票，另立）

存量票回扫（novel 87／dsh-plugin 9／nvwa 7 ＝ **103 张 `status: done`**）**不在本票**——按你 ③ 的新定性，需先定协议单一词表，回扫才有判据。**本票只改格式正本（协议 + wayfinder + 读取层），不动存量票。** 回扫另立票。

## 诚实边界

- **已撤回的旧结论**：本 spec 决策 12 的「向原版对齐」方向、以及基于它推出的「103 张票须补 `## Answer` 节」——**随本票定性更正一并作废**；
- **旧实测数据仍有效但用途变了**：103 张 `done` 票中 0 张有 `## Answer`、60 张有落地记录、43 张两者皆无——这组数据原来用来论证「补 Answer 的成本」，现在用来论证「**为何不能向 wayfinder 推导形态对齐**」（照字面对齐会把 103 张完工票读成 `open`）；
- 本票**不修改** `MapKind='impl'`、`impl/`、`impl-fe/` 等非票型标识（决策 10 保留项）。
