---
type: approval
date: 2026-09-27
origin: review
---

> **〔重大更正与作废声明（2026-09-27）〕** 本文的**核心定性错误**：全文把冲突描述为「我方协议 vs **上游 `wayfinder-maps` 工具**」，所引路径 `~/workdir/wayfinder-maps` **在当前环境中不存在**（【实测】`ls -d ~/workdir/*wayfinder*` 为空；全盘 find 仅命中 `~/Library/Application Support/wayfinder-maps`）。文中被称为「上游原文」的 *"There is no `status:` field…"*，**实为本仓文件** `packages/dsh-plan-view/skills/wayfinder/TRACKER-MARKDOWN.md:55`。
>
> **因此本文 §二「两处未对齐」、§三「后果（17 个 effort 零通过）」及 A/B/C 三选项的**证据基础不成立**，一律待复核、不得引用。**
>
> **重新定性后的裁定正本** = `plan-lint-gate/tickets/06-协议与wayfinder状态契约对齐.md`（本票重写版）——冲突实为**本仓内部两个 skill 契约互相矛盾**（`plan-protocol` 要求 frontmatter `status`；`wayfinder/TRACKER-MARKDOWN.md` 明文否定该字段），选项改为甲（改 wayfinder 契约）/乙（改协议＋回扫 103 票）/丙（消从属声明、明确并行分层）。
>
> **本文中被独立裁定并已落地的两项保留有效**：① `impl` 不支持并从协议清理（§十二 裁定 3-1）；② `blocked_by` 格式两侧统一（§十二 裁定 3-2）。**这两项不依赖上述错误定性。**

# 待拍板：协议与 wayfinder 的状态契约对齐——「票面状态写在哪儿」由哪一侧改

**Status:** superseded-by: .scratch/plan-lint-gate/tickets/06-协议与wayfinder状态契约对齐.md

> **本文怎么来的**：novel 仓 2026-09-27 合并前体检，你拍板决策项 **D3**，原话「这个参考 /plan-protocol 是不是有哪里没对齐，如果是协议和 wayfinder 本身没对齐，那需要让协议对齐，然后再适配」。该决策经 handoff（`.plan/handoffs/2026-09-27-协议与wayfinder状态契约对齐.md`）移交本仓，落票 `06-协议与wayfinder状态契约对齐.md`（open）。票 06 与 handoff 都把「待裁定」标为三选一、**未定案、勿径自实施**，故本文把选择摆给你。
>
> **性质标注约定**：【实测】= 我本轮亲自跑过命令 / 读过代码；【文档已写明】= 既有文档原文；【我的推断】= 我的判断，不是事实。**凡与 handoff／票 06 说法不一致处，本文以实测为准并显式标注**——本轮实测推翻了 handoff 的一处关键论据。

---

## 一、你的原话（照抄）

1. **D3 拍板原文**（novel `.plan/待拍板-合并前体检与spec-batch并入-20260927.md`，经 handoff 转述）：
   > 「这个参考 /plan-protocol 是不是有哪里没对齐，如果是协议和 wayfinder 本身没对齐，那需要让协议对齐，然后再适配」

   【我的推断】这句话里有一个**条件句**：「如果是协议和 wayfinder 本身没对齐，那需要让协议对齐」。你的措辞默认了「改的是协议、工具是基准」。**本轮的实测结论是：这个默认前提恰好反了**——要对齐的那一侧是工具，不是协议。这是本文最需要你看的一点，详见第五节。

2. **票 06 的待裁定表述**（`.scratch/plan-lint-gate/tickets/06-协议与wayfinder状态契约对齐.md`）：
   > 「**〔我的推断〕**推荐 **A**——协议已声明两形态共存，未对齐的是工具实现单边只认一种；改工具比回扫全仓单据更符合「单一真相源」，且不动已验证的 to-tickets 契约。」

3. **handoff 的结论**（第五节）：
   > 「**推荐 A 的理由**：协议 §三**已声明**两形态共存（推演图＝推导形态／实施图＝frontmatter 形态），未对齐的是**工具实现单边只认一种**；改工具比回扫全仓单据更符合单一真相源原则。**此项待你拍板**（票 06 未定案，勿径自实施）。」

---

## 二、这是什么问题（说人话）

同一张工单文件，开头有一段 `---` 包起来的「frontmatter」（元数据区），状态（这票是待办、在做、还是做完了）写在两个地方之一：

- **写法甲（frontmatter 形态）**：状态直接写在元数据区里，`status: done`；
- **写法乙（推导形态）**：元数据区不写状态，靠正文里有没有 `## Answer`（结论节）反推出来——有结论节就是做完了。

协议规定**实施图**（真正要写代码的图）用**写法甲**，**推演图**（只做调研、不做事的图）用**写法乙**。协议自己是知道有两种写法的。

问题出在工具：有个独立命令行工具 `wayfinder-maps`（自带网页界面，用来浏览这些图），**只认写法乙**。它把 `status:` 这个字段标注为「已废弃」，还专门写了一句注释解释为什么不去读它——「读它就是留了第二份会过期的副本」。

后果是：**用写法甲的图，这个工具全都读不对。**

---

## 三、实测：坏成什么样（本轮亲跑，可复现）

测试环境：`~/workdir/wayfinder-maps`，HEAD `94a3be9`。本轮因网络不通，用本机缓存的 Go 1.26.8 工具链离线构建：

```bash
export PATH="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.8.darwin-arm64/bin:$PATH"
cd ~/workdir/wayfinder-maps
GOTOOLCHAIN=local GOPROXY=off CGO_ENABLED=0 go build -o /tmp/wfm ./cmd/wayfinder-maps
```

（`CGO_ENABLED=0` 是绕开本机未缓存的 `webview_go` 依赖，只影响 `app` 原生窗口子命令，`status`/`lint` 不受影响。【实测】）

### 3.1 全仓量化：novel 17 个图，零通过

```
agent-output-extraction   exit=2 (解析中止)   merge-prep-adapt        exit=1 (逐票报错)
chronicle-review          exit=2              micro-fixes             exit=1
dna-craft                 exit=2              outline-generation-chain exit=2
mcp-recall                exit=2              outline-industry-review  exit=1 (31 条)
qa-env                    exit=2              retry-ia                 exit=1 (10 条)
qa                        exit=2              telemetry-viz            exit=1
research                  exit=2              test-env                 exit=2
review                    exit=2              workflows                exit=2
state-machine             exit=2
```

【实测】与 handoff 相符（它数 16 个，本轮多一个 `state-machine`）。两类失败：
- **A 类＝引号**：解析直接中止（exit=2），**连图都读不出来**；
- **B 类＝状态**：逐票报错（exit=1）。

### 3.2 B 类的实害：已收口的图被读成「四票待办」

```
$ /tmp/wfm status ~/workdir/novel/.plan/micro-fixes
评审批遗留小修 · 路线图
0 resolved · 0 claimed · 4 open · 0 out of scope     ← 四票 frontmatter 全是 status: done

Frontier — ready to claim, first by number wins:     ← 已完结的票被列为「待认领前沿」
  01  01: arc 级收口 nextArcLocator 吞错修复…        task
  ...
```

【实测】这不是「多报几条 lint」，是**状态读数错了**。任何按这个读数派活、排期的会话都会被误导。这是本次最该修的一条。

### 3.3 A 类：一个引号就中止全图

```
$ /tmp/wfm lint ~/workdir/novel/.plan/outline-generation-chain
wayfinder-maps: 05-卷纲承载与卷纲生成卷收口.md: blocked_by: "\"04\"" is not a ticket number
```

【实测】根因在 `internal/wayfinder/parse.go:289-315`：`splitList` 只剥 `[`/`]`、**不剥引号**，`splitNums` 直接 `strconv.Atoi`。故 `["04"]` 报错。**契约正本模板写的是裸数字**（`to-tickets/SKILL.md:68`、wayfinder `TRACKER-MARKDOWN.md:37`），所以这是工具不够宽容，不是文档写错。

### 3.4 handoff 少算了一件事：B 选项的真实成本是 87 张票，不是 23 处

handoff 把选项 B 的迁移成本表述为「novel 23 处／nvwa 2 处／stock_dashboard 2 处」（带引号 `blocked_by`）。**那只是 A 类的量。** 选项 B 若真要执行，要回扫的是**所有写了 `status:` 的实施图票**：

| 项 | 数量 | 命令 |
|:--|:--|:--|
| novel 全部票 | **106** | `ls */tickets/*.md` |
| 其中 `status: done` | **87（82%）** | `grep -rl '^status: done'` |
| 其中 `status: claimed` | 0 | `grep -rl '^status: claimed'` |
| 正文已有 `## Answer`（即改写成写法乙后**能**被正确读出） | **15** | `grep -rl '^## Answer'` |

【实测】**87 张票要改，而其中只有 15 张写得出 `## Answer`**——其余 72 张是实施图票，正文本来就没有「结论节」这个概念（结论节是推演图的产物）。所以选项 B 不是「去掉 87 个字段」这么简单，而是**要给 72 张实施图票发明并补写正文终态节**。【我的推断】这把 B 的成本从「批量删字段」抬高到「给绝大多数票补写新正文结构」，handoff 与票 06 的成本描述偏低了。

---

## 四、决定性发现：选项 A 不是新设计——本仓插件**已经这么实现了**

【实测】`packages/dsh-plan-view/src/client/PlanView.tsx` 已经同时认两种写法，代码注释把这件事故意写明了：

```ts
// Status vocabulary shared by both conventions in the wild: wayfinder's
// body-section markers (`## Answer` / `## Ruled out`) and a plain frontmatter
// `status` field, which is what non-wayfinder repos write. Both are honoured;
// the section markers win when present, since they carry more detail.
const DONE_STATUS = new Set(['done', 'closed', 'resolved', 'complete', 'completed', 'shipped'])
```

具体表现（均在 `PlanView.tsx`）：
- `:107-113` `displayStatus()`：正文结论节优先，其次读 frontmatter 的 `status`，`done`/`closed`/`complete`/`shipped` 一律折成内部态 `resolved`；
- `:93` 还有 `OUT_STATUS`／`CLAIMED_STATUS` 两组词表，容忍 `abandoned`／`wip`／`doing` 等**协议词表之外**的野生写法；
- `:142-144` `parseBlockedBy()`：`.replace(/[\[\]]/g, '')` 去括号后按逗号切分——**顺带天然容忍引号**（`"04"` 会被后续 `normalizeRef` 处理掉）。

**推论（这条改变了选择题的性质）**：

【实测】DSH 计划视图（就是你日常看的那个页面）**今天就能正确渲染 novel 全部 17 个图**，包括那 87 张 `status: done` 的票、那 23 处带引号的 `blocked_by`。**读不对的只有 `wayfinder-maps` 这个独立工具。**

所以：
- handoff 说「两套契约给出相反指令」「两工具判据不同」——**表述不够准**。准确的表述是：**插件已经统一了两种写法，`wayfinder-maps` 是那个没跟上的单边**。
- 选项 A **不是「改工具去迁就文档」**，而是**把独立工具对齐到本仓插件早已实现、且已发布的契约**。这比 handoff 的论证更强：不需要发明新契约，只需要让两个实现一致，而基准已有现成的。

【我的推断】这也解释了 handoff 提到的那个「多个会话的困惑源」——为什么历轮 `plan-lint.sh` 零发现、wayfinder 却报错。不是「两把尺子各有道理」，而是**三把尺子里两把（插件、plan-lint.sh）都接受写实现状，只有 wayfinder-maps 不接受**。

---

## 五、要你拍板的事

**一句话**：状态写在哪儿，以哪一侧为准？

**这一项是「文档有空白」**——协议 §三 已写明两种写法共存（见下），但**没有任何一处文档规定「当工具与协议不一致时，谁是基准」**。协议只描述了「有两种形态」，没说「工具必须两种都认」。这个空白就是本次分歧的缝。

### 协议侧的原文（照抄，供你核对）

`packages/dsh-plan-view/skills/plan-protocol/SKILL.md` §三「票面 `status` 词表」：

> 执行中 = `claimed`（登记格式见「执行登记」硬规则）；终态按票型分——实施图票 `task` / `impl` 终态 = `done`；推演图票 `research` / `prototype` / `grilling` 终态 = `resolved`（允许附日期 `resolved <YYYY-MM-DD>`）。票态有两种合法形态：**frontmatter 形态**（to-tickets 系，`status` 写在 frontmatter）；**wayfinder 推导形态**（`status` 不入 frontmatter，由收束节推导——`## Answer` 带正文 = `resolved`、`## Ruled out` 带正文 = `out_of_scope`、`claimed_by` 在位 = `claimed`、其余 = `open`）。两形态共享同一 type 词表；推导形态的格式契约正本 = wayfinder `TRACKER-MARKDOWN.md`。

同节「frontmatter 是权威」：

> 票里 `status` / `type` / `blocked_by` 以 frontmatter 为准，不读正文表格。

**注意这两句合起来的含义**：协议明说「frontmatter 是权威」**且**「两种形态都合法」。而工具说的是「frontmatter 里那个字段已废弃、永不读它」。**这才是真正的正面冲突点**——冲突不在「有两种形态」（双方都承认），而在**「frontmatter 的那个 `status` 到底算不算数」**。

### 三个选项

| 选项 | 做什么 | 成本 | 影响 |
|:--|:--|:--|:--|
| **A**<br>**（推荐）** | **改工具对齐插件现状**：`wayfinder-maps` 识别 `task`/`impl` 型票的 frontmatter `status`（认 `done`/`claimed`），仅在推演图票上坚持推导形态；顺带加去引号容忍 | 改 `parse.go` `Derive()` 按 type 分支 + `lint.go` 词表放行 `done` + `splitList` 去引号。【我的推断】量级约十余行，改在 `~/workdir/wayfinder-maps` | 工具能读全部图；**不动**协议、不动 87 张票、不动 to-tickets 契约、不动已发布的插件 |
| **B** | **改协议**：实施图也改用推导形态，正文 `## Answer` 表终态，frontmatter 不存 `status` | **回扫 87 张票，且要给其中 72 张无结论节的实施图票发明并补写正文终态节**（§3.4 实测）；还要改本仓插件（去掉 frontmatter 读取分支）与 to-tickets 契约 | 协议与工具完全统一；但代价最大，且降级了实施图票的表达力（实施图本来就没有「决策结论」语义） |
| **C** | **明确「两工具分治」**：`wayfinder-maps` 只用于推演图，实施图只用 `plan-lint.sh` | 零代码改动，只在协议写明工具边界 | 零改动；但**不解决 B 类实害**（你仍会在 wayfinder 里看到「已收口读成待办」），且 A 类引号中止仍要单独处置 |

### 我的推荐：A

三条理由，按分量排序：

1. **基准已经存在且已发布。** 本仓插件早已实现双形态共存（§四实测）。选 A 不是「发明新契约去迁就文档」，而是**让 `wayfinder-maps` 对齐本仓插件**。**这是 handoff 没看到、但最有力的一条。**
2. **A 修的是实害，B 修的是洁癖。** §3.2 那条「已收口读成四票待办」会误导派活排期，A 直接消除它；B 花 87 张票的力气换来的是「两份文档形态一致」，而两份形态**协议本来就都承认合法**。
3. **A 成本最低、回退最容易。** 十余行、独立仓、不动任何既有契约。B 要动协议 + 插件 + 87 张票三处，任一处漏改就是新的漂移源。

**另外无论选哪项，都建议做引号容忍**（§3.3）：契约正本模板本来就规定裸数字，工具不该因为一个格式小瑕疵就中止整个图的解析。这一条与 A/B/C 无关，属独立缺陷。【我的推断】它甚至可以单独先修。

### 需要你额外确认的一点（关于你原话的前提）

你的原话是「**如果是协议和 wayfinder 本身没对齐，那需要让协议对齐**」——**方向是「改协议」**。而我的实测结论是：协议这边没有问题（它明说两种形态都合法），**没对齐的是工具**，且本仓插件已经证明了「两种都认」是可行的、已发布的实现。

【我的推断】所以我建议把「让协议对齐」理解为「**让两侧对齐**」，对齐方向改为「工具补齐」；而不是字面执行「改协议」。**这是对你原话前提的修正，必须由你确认，我不擅自改方向。** 如果你坚持「协议必须让路」，那就是选项 B，我会照 B 执行。

---

## 六、附带需要一并裁定的下游

novel 侧已立票 `.plan/merge-prep-adapt/tickets/01-blocked_by形态回扫.md`（open），等本仓结论：

- 选 **A** 或 **C**（工具容忍）→ 该票转「**不动文档**」并关闭（23 处引号无需回扫）；
- 选 **B**（回扫）→ 按该票执行 23 处去引号。

【实测】该票的处置完全跟随本次裁定，**无需单独拍板**，此处列出只为让你知道有关联动作。

---

## 七、拍板后我会做什么

| 裁定 | 动作 |
|:--|:--|
| **A** | 改 `~/workdir/wayfinder-maps`（`parse.go` `Derive()` 按 type 分支、`lint.go` 词表放行 `done`/`claimed`、`splitList` 去引号）→ `go build` + `go test ./internal/wayfinder/` 过 → 实机复验 `.plan/micro-fixes` 应读成 **4 resolved** → 通知 novel 侧关票 01 |
| **B** | 改 `plan-protocol` 源仓 §三（经 `install-skills.sh` 分发，校验两处 md5 一致）→ 同步改本仓 `PlanView.tsx` 读取逻辑 → 回扫 novel 87 张票（含 72 张补正文终态节）→ 同步 to-tickets 契约 |
| **C** | 在 `plan-protocol` §三写明工具适用范围与边界 → 单独修引号中止 → 通知 novel 侧关票 01 |

三项均需：收尾跑两侧 plan-lint 零漂移（dsh-plugin 现为 38 md 绿）。

---

## 八、已知坑（勿踩）

- **勿把 A 类／B 类报错数当缺陷数**：它们是同一根因（工具单边契约）的两个表现面，不是 40 多个独立缺陷。
- **勿用 `wayfinder-maps` 的报错反推「计划文档坏了」**：同一批文档被插件正确渲染、被 `plan-lint.sh` 判零发现。
- **`wayfinder-maps` 传参是 effort 目录**（含 `map.md` 者），不是 `.plan` 根；传根目录报「no map.md in .plan」是用法错，不是图坏。
- **协议源仓文件有他会话在途未提交改动**（`git diff` 显示 `SKILL.md` +2 行，属 QA 缺陷登记条款，与本议题无关）。**若选 B/C 要改该文件，动手前先核 `git status`，勿覆盖。**（【实测】本轮已确认该改动仍在工作树中未提交。）

---

## 九、本轮实测证据清单（可复现）

| 结论 | 复现命令 |
|:--|:--|
| 17 图零通过 | `cd ~/workdir/novel/.plan && for d in */; do [ -f "$d/map.md" ] \|\| continue; /tmp/wfm lint "${d%/}"; done` |
| 已收口读成待办 | `/tmp/wfm status ~/workdir/novel/.plan/micro-fixes` |
| 引号致解析中止 | `/tmp/wfm lint ~/workdir/novel/.plan/outline-generation-chain` |
| 87/106 票带 `status: done` | `cd ~/workdir/novel/.plan && grep -rl '^status: done' */tickets/*.md \| wc -l` |
| 仅 15 票有 `## Answer` | `cd ~/workdir/novel/.plan && grep -rl '^## Answer' */tickets/*.md \| wc -l` |
| 引号分布 27 处 | `grep -rn 'blocked_by:.*"' ~/workdir/*/.plan/*/tickets/*.md \| wc -l` |
| 插件已实现双形态 | 读 `packages/dsh-plan-view/src/client/PlanView.tsx:88-144` |
| 协议两形态原文 | 读 `packages/dsh-plan-view/skills/plan-protocol/SKILL.md` §三「票面 `status` 词表」 |
| 工具单边契约 | 读 `~/workdir/wayfinder-maps/internal/wayfinder/{parse.go:10-11,57,68-79,289-315,354, lint.go:41,69-75}` |

---

## 十、裁定记录

### 裁定 1（2026-09-27）—— 方向修正**被接受**：对齐基准是工具，不是协议

**你的原话**（`/plan-approve` 调用，2026-09-27）：

> 既然 impl 不合法，那我期望做的就是收口
> 1. 清理掉 plan 内任何 impl type 的说明
> 2. 统一 impl 和 task 的类型，以及 plan-view 插件的展示层。

**性质说明**：你这轮的话**没有直接回答 A/B/C 三选一**，而是转向了同源的另一个收口项（`impl` 票型别名）——即本文 §三 之外的第四处词表缺口。**A/B/C 主体（wayfinder 工具侧 `status`/`done` 契约）仍为 live**，见下方「裁定 2」。

**「impl 不合法」这一前提经实测更正**：`impl` **不是「不合法」**，而是**被协议追认为合法历史别名**（旧表述「实施图票型 `task`/`impl`」＋「早期别名，不再新用」）。真正的缺陷是**协议内部自相矛盾**——「图二型」条承认它合法，「`type` 取值约定」清单（`SKILL.md:98`）却不收它。三处正本（协议词表、`to-tickets` 模板、wayfinder `TRACKER-MARKDOWN.md:36`）中，后两者从未列 `impl`。

**裁判落地**（按你的两条要求执行，2026-09-27 当场完成）：

| 你的要求 | 落地动作 | 状态 |
|:--|:--|:--|
| ①清理 plan 内任何 `impl` type 的说明 | 协议 `SKILL.md:96`「图二型」删「票型 `task`/`impl`」表述、改「票型 `task`，唯一合法值」＋新增「`impl` 历史别名（2026-09-27 拍板废弃）」子条；`:97` status 词表删 `impl`；`:99`「`type` 取值约定」补「本清单即唯一合法词表，`impl` 不在其中，协议内部矛盾现予消除」；`:165` README 模板收口纪律删 `impl`；`run-qa-testcases/SKILL.md:54` 全量回归筛图条件删 `impl`；`plan-lint.sh:19-23` 词表注释改写 | **已完成** |
| ②统一 impl/task 类型与 plan-view 展示层 | 选**做法乙（彻底清零）**、但范围**限定 dsh-plugin 本仓**。已完成：协议词表只收 `task`；插件 `PlanView.tsx:357-363` 引入 `LEGACY_TICKET_TYPES = new Set(['impl'])` 作**存量读取容错**（声明废弃＋读取容忍双轨）；`:406-415` 补「`impl` 三身份勿混」注释；`:1001` 陈旧注释改写。**跨仓回扫后置**→ 立票 07 | **部分完成** |

**为什么插件保留 `'impl'` 读取**（与你「彻底清零」的取向的唯一偏离，须你知悉）：插件 `ticketKind()`（`:386`）以 `TICKET_TYPES` 判定文档是否归「工单」类；nvwa 尚有 **15 张 `type: impl` 存量票**未回扫（跨仓动作按你「先只动 dsh-plugin 本仓」的裁定 deferred）。若此刻移除 `'impl'`，那 15 张票会被判成 `'note'`、**静默掉出工单视图**——正是该处 2026-09-24 注释反复警示的失效模式。故采「声明废弃 + 读取容错」双轨，待票 07 回扫清零后再删容错。**容忍 ≠ 合法**：`impl` 已不进协议词表。

**同时厘清的非票型身份**（不可清理，已在协议与代码注释中写明）：`MapKind='impl'`（插件内部类型名／实施图分组标识）、历史目录路径 `impl/`、`impl-fe/`。

**派生**：立票 [`07-nvwa存量impl票回扫.md`](../.scratch/plan-lint-gate/tickets/07-nvwa存量impl票回扫.md)（open；跨仓回扫 15 票＋收尾删插件容错）。

**协议两处 md5 一致复核**：`plan-protocol` 源仓＝安装态 `efee23cdba8054dfcec98276bf9adc2a`；`run-qa-testcases` 源仓＝安装态 `c47fab67d5d46ca7378d5f1b7f0ee565`。【实测】

### 裁定 2（未决）—— A/B/C 主体仍待你定

本文 §五 的三个选项（wayfinder 工具侧 `status` 字段与 `done` 词表）**未因裁定 1 结算**，仍为 live：你的原话未涉及「工具是否补齐 `status` 读取」。该项与 `impl` 收口**同根因**（枚举在各实现间不同步），但**是两个独立动作面**。

**【我的推断，待你确认】**：裁定 1 已确立「协议词表是唯一正本、工具应向其对齐」的取向，据此 A 的论据进一步增强；且 `impl` 已按「工具应收编协议词表」的同一逻辑处理完毕，**建议 A/B/C 一并按 A 结算**（改 `wayfinder-maps`：`Derive()` 按 type 分支 ＋ `lint.go` 放行 `done`/`claimed` ＋ `splitList` 去引号容忍）。若你确认，我改工具并复验 `.plan/micro-fixes` 读成 4 resolved。

---

## 十一、原「待你回复」节（已被裁定 1 部分履行，保留存档）

请就第五节第 1 项（选项 A / B / C）给出裁定；并请确认第五节末的**方向修正**（是否接受把「让协议对齐」改为「让工具对齐」，即选项 A）。若你维持原方向，直接说「B」即可，我照办、不辩解。

> **存档说明（2026-09-27）**：方向修正已由裁定 1 实质性确立（协议词表定为唯一正本、`impl` 按「别名废弃」收口）；但 A/B/C 本身未答，故本文**不置 closed**，保持 `pending` 直到裁定 2 落定。

---

## 十二、裁定 3（2026-09-27）——`impl` 不支持并清理 + `blocked_by` 两侧统一

### 你的原话（照抄）

> 「【待拍板-协议与wayfinder状态契约对齐】
> 1. 不必支持 impl，并清理协议中的这个类型。
> 2. 统一 block 的格式，plan-protocol 和 wayfinder 保持一致」

### 裁定 3-1：`impl` 不支持，并从协议中清理

**裁定语义**：**「不必支持」＝ 协议不收录 + 读取层不识别**（比此前「声明废弃＋读取容错」双轨更进一步）。

【我的推断】此前我保留插件读取容错（`LEGACY_TICKET_TYPES`），理由是「nvwa 15 张存量票会静默掉出工单视图」。**你裁定不支持的语义是「不识别」**，故读取容错一并移除——**这是该拍板的既定后果，如实记录**。

**已落地改动**：

| # | 落点 | 改动 |
|:--|:--|:--|
| 1 | `plan-protocol/SKILL.md` §三「图二型」 | 子条标题从「`impl` 历史别名（拍板废弃）」改为「**`impl` 不是票型**」；删「插件读取层保留归一容忍」句，改为「**未迁移前该票不被识别为工单**」 |
| 2 | `plan-protocol/SKILL.md` §三「`type` 取值约定」 | 删「（历史别名，见『图二型』条…）」表述，改为「`impl` **不在其中**（2026-09-27 拍板：**不支持该类型**）」 |
| 3 | `PlanView.tsx` | **删除 `LEGACY_TICKET_TYPES`**；`TICKET_TYPES` 收为 `['task','research','prototype','grilling']`；`IMPL_TYPES` 收为 `['task']`；注释改为「`impl` 不再是票型，本文件不再对它作任何识别」 |
| 4 | `plan-protocol/SKILL.md` §三「blocked_by 格式」 | 新增条款（见裁定 3-2），其中含「协议与 wayfinder 两侧曾各写一套…2026-09-27 收口」 |

**保留不动**（`impl` 的两个非票型身份）：`MapKind='impl'`（插件内部类型名）、历史目录路径 `impl/`、`impl-fe/`。

**如实声明的后果**：nvwa `.plan/dna-ab-full/` **15 张 `type: impl` 票**（其中 **3 张 `status: open`**）自本改动起**不再出现在工单视图**，直到按「形态契约变更回扫」迁移为 `type: task`。**【实测】当前未迁移。** 相关回扫工作见票 `07-nvwa存量impl票回扫.md`；**该票的收尾项（删插件容错）已由本次改动提前完成**，故票 07 范围收缩为「仅 nvwa 15 票回扫」。

### 裁定 3-2：`blocked_by` 格式两侧统一

**统一后的唯一格式（YAML 流式序列，取值裸写、不加引号）**：

| 情形 | 写法 |
|:--|:--|
| 无前置 | `blocked_by: []`（**唯一合法空值**；不得写 `[无]`、`none`、留空） |
| 单个前置 | `blocked_by: [03]` |
| 多个前置 | `blocked_by: [03, 04]`（逗号+空格） |
| **禁止** | `["03"]`、`['03']`（引号） |

**已落地改动**：

| # | 落点 | 改动 |
|:--|:--|:--|
| 1 | `plan-protocol/SKILL.md` §三 | **新增完整条款「`blocked_by` 格式（两形态共用的唯一格式，2026-09-27 拍板统一）」**——含四种写法、禁止引号及理由（`splitNums` 不容忍引号会致整图解析中止）、票 id 形态（数字用两位、带前缀直接写全称）、**明示「两形态共享同一契约、禁止另立第二种写法」** |
| 2 | `wayfinder/TRACKER-MARKDOWN.md` 模板 | `blocked_by: [NN, NN]` 注释补「**bare values, never quoted**」 |
| 3 | `to-tickets/SKILL.md` 模板 | `blocked_by: []` 注释补「bare values, never quoted（**格式正本=plan-protocol §三**）」 |

**统一方向说明**：以 **plan-protocol 为格式正本**（它是公共契约层），wayfinder 与 to-tickets 的模板**指向它**、不再各自表述——避免「两处各写一套」再次漂移。

**顺带查明的第三种偏离（未纳入本次统一，如实报备）**：【实测】存量票面另有 `blocked_by: [无]`（3 处，中文值）与带字面前缀 id（`AIT1`、`OPT3` 等）两种写法。**前者协议从未定义**，后者已在新条款中明示（「带字面前缀的票直接写前缀全称」）。**`[无]` 的存量迁移未做**，归入形态回扫待办。

### 附：本次改动的双拷贝一致性复核

【实测】`install-skills.sh` 分发后逐文件复核源仓与安装态 md5：

| 文件 | 结果 |
|:--|:--|
| `plan-protocol/SKILL.md` | ✓ 一致（`0d5c19b2…`） |
| `wayfinder/SKILL.md` | ✓ 一致（`2438eb2b…`） |
| `wayfinder/TRACKER-MARKDOWN.md` | ✓ 一致 |
| `to-tickets/SKILL.md` | ✓ 一致（`5b24a05d…`） |

插件已重建（`tsdown` 通过），`lib/client.js` 中 `LEGACY_TICKET_TYPES` 零命中、`IMPL_TYPES = new Set(["task"])`。【实测】

### 本文状态

**裁定 3 已结算落地。** 但本文**仍保持 `pending`**——因 **裁定 2（A/B/C：wayfinder 工具侧 `status`/`done` 契约）尚未裁定**（见 §十 裁定 2）。

