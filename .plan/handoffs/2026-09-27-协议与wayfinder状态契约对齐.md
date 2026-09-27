---
type: handoff
date: 2026-09-27
status: open
origin: review
---

# Handoff：协议与 wayfinder 状态契约对齐（D3）——移交 dsh-plugin 侧修复

> **来源**：本交接由 novel 仓会话（2026-09-27 合并前体检）发出，承载用户 `/plan-approve` 决策 **D3**。用户原话：「这个参考 /plan-protocol 是不是有哪里没对齐，如果是协议和 wayfinder 本身没对齐，那需要让协议对齐，然后再适配」。
> **本交接做什么**：把「协议 ↔ wayfinder 工具」的状态契约未对齐点、实测证据、候选方案与验收口径交代清楚，**交由 dsh-plugin 侧会话修复**。
> **对应票**：[`.plan/plan-lint-gate/tickets/06-协议与wayfinder状态契约对齐.md`](../plan-lint-gate/tickets/06-协议与wayfinder状态契约对齐.md)（status: open）——**方案与裁定落在那张票，本文只交代上下文与证据，不重复**。

## 一、一句话

`plan-protocol` 协议允许「实施图票把 `status` 写在 frontmatter（终态 `done`）」，但 `wayfinder-maps` 工具**只认推演图形态**（status 派生不存、词表无 `done`）——结果该工具对 **novel 仓全部实施图不可用**（16 个 effort 无一可读），且把已收口的票读成待办。

## 二、两处未对齐（实测，非推断）

### 未对齐点 ①：`status` 字段——存 vs 不存

| 侧 | 立场 | 出处 |
|---|---|---|
| plan-protocol（协议） | **frontmatter 是权威**；票里 `status` 以 frontmatter 为准 | `mp-plan-protocol/SKILL.md:89` |
| plan-protocol（协议） | 实施图票 `task`/`impl` 终态 = `done`；执行中 = `claimed` | `mp-plan-protocol/SKILL.md:97,165` |
| wayfinder（工具实现） | status **从正文派生、永不读 `status:` 字段**——「a second copy free to go stale」 | `wayfinder-maps/internal/wayfinder/parse.go:10-11` |
| wayfinder（工具实现） | `StoredStatus` 注释直称该字段为 **deprecated** | 同文件 `:57` |

即：协议说「该字段是权威」，工具说「该字段已废弃」。**同一份票面，两套契约给出相反指令。**

### 未对齐点 ②：状态词表——`done` 不在工具词表

- 工具合法集（`internal/wayfinder/lint.go:41`）：`open | claimed | resolved | out_of_scope`——**无 `done`**；
- `lint.go:71-72`：见到 `status: done` 直接报 error「stored status %q is not open|claimed|resolved|out_of_scope」；
- `parse.go:68-79` `Derive()`：状态只按 `## Answer`（→resolved）／`## Ruled out`（→out_of_scope）／`claimed_by`（→claimed）／其余（→open）派生——**完全不看 frontmatter**。

### 未对齐点 ③：`blocked_by` 引号（表现面）

- 契约正本模板**均为裸数字**：`mp-to-tickets/SKILL.md:67`（`blocked_by: []`）＋ `wayfinder/TRACKER-MARKDOWN.md:37`（`blocked_by: [NN, NN]`）；
- 工具实现 `splitNums`（`parse.go:306-315`）直接 `strconv.Atoi`，`splitList`（`:289-304`）只剥 `[`/`]` **不剥引号**；
- 实测（复刻 `splitNums` 逻辑独立跑）：

  | 输入 | 结果 |
  |---|---|
  | `[04]` | OK → `[4]` |
  | `["04"]` | **FAIL** `"\"04\"" is not a ticket number` |
  | `[04, 05]` | OK → `[4 5]` |
  | `["04", "05"]` | **FAIL** `"\"04\"" is not a ticket number` |
  | `[]` | OK → `[]` |

  该串与实跑 `wayfinder-maps lint` 的报错逐字一致（可复现）。
- 存量分布（全 workdir 扫描）：**novel 23 处／nvwa 2 处／stock_dashboard 2 处**。

## 三、后果（实测，量化）

`wayfinder-maps lint <effort>` 对 novel **16 个 effort 无一通过**，且**分两类失败**：

| 失败类 | 触发条件 | 实例 | 表现 |
|---|---|---|---|
| **A 类**＝引号 | 有带引号 `blocked_by` | outline-generation-chain 等 9 图 | **解析中止**（exit=2），连 map 都读不出 |
| **B 类**＝status | 无引号但票面有 `status: done` | micro-fixes / retry-ia / telemetry-viz / outline-industry-review / merge-prep-adapt | 逐票报 error（exit=1），**仍中止** |

**B 类的实害（最要紧）**——不是「多报几条 lint」，是**状态读数错误**：

```
$ wayfinder-maps status .plan/micro-fixes
评审批遗留小修 · 路线图
0 resolved · 0 claimed · 4 open · 0 out of scope      ← 四票 frontmatter 全是 status: done

Frontier — ready to claim, first by number wins:      ← 已完结的票被列为「待认领前沿」
  01  01: arc 级收口 nextArcLocator 吞错修复…   task
  02  02: locator 章序公式三拷贝收编为共…       task
  03  03: BE acp 错误日志透出上游 details…      task
  04  04: 章纲评分「要求片段」拆解滤残段…        task
```

即：**已收口的图被读成「四票待办」**。凡按该读数派活/排期的会话都会被误导。

**另一条对照（说明不是工具坏了，是两套契约不同）**：旧 `plan-lint.sh`（协议系 skill 自带、novel 收口实际在用）对同一批文档 **exit=0、340 个 markdown 零发现**——因它只做「字段非空」判、不解析数值、不校验 status 词表。**两工具判据不同，故历轮「plan-lint 零发现」与 wayfinder 报错并存，两个说法并不矛盾**（这点是此前多个会话的困惑源，特此写明）。

## 四、待裁定（三选一，票 06 内有详表）

| 选项 | 做什么 | 影响 |
|---|---|---|
| **A（novel 侧推荐）** | **改工具**：识别 `task`/`impl` 型票的 frontmatter `status`（认 `done`/`claimed`），仅在推演图票上坚持派生形态 | 工具可读全部图；改动在 wayfinder-maps 仓；不动已验证的 to-tickets 契约 |
| B | 改协议：实施图也改用派生形态（正文 `## Answer` 表终态，frontmatter 不存 status） | 协议与 wayfinder 完全统一；但要回扫全仓实施图票（仅 novel 就 34 张＋），且与现有 to-tickets 契约、插件 frontmatter 读取逻辑冲突 |
| C | 明确「两工具分治」：wayfinder-maps 只用于推演图，实施图只用 `plan-lint.sh` | 零改动；但需在协议写明工具边界，且引号致解析中止的问题仍要单独处置 |

**推荐 A 的理由**：协议 §三**已声明**两形态共存（推演图＝推导形态／实施图＝frontmatter 形态），未对齐的是**工具实现单边只认一种**；改工具比回扫全仓单据更符合单一真相源原则。**此项待你拍板**（票 06 未定案，勿径自实施）。

## 五、改动落点（两仓，注意顺序）

1. **协议侧（若选 B/C）**：`packages/dsh-plan-view/skills/plan-protocol/SKILL.md` 是**源仓**，改完经 `packages/dsh-plan-view/scripts/install-skills.sh` 分发到安装态（`~/.dsh/.agent-presets/full/skills/mp-plan-protocol/`，`install-skills.sh:66` 有映射行）。
   - **当前两处 md5 一致**（`4e8a30fc8af65f211a3ff5668e12249c`），即安装态＝源仓；
   - ⚠️ **该文件有他会话在途未提交改动**（`git diff --stat` 显示 +2 行）——动手前先核 `git status`，勿覆盖。
2. **工具侧（若选 A）**：`~/workdir/wayfinder-maps`（独立仓，当前 HEAD `94a3be9`）。关键改动面：
   - `internal/wayfinder/parse.go`：`Type` 枚举（`:27-32`，已含 `TypeTask`）可作为形态判据；`Derive()`（`:68-79`）需按 type 分支；`StoredStatus` 解析在 `:352-354`；
   - `internal/wayfinder/lint.go`：`validStatuses`（`:41`）与 `:69-75` 的 status 校验分支；
   - `internal/wayfinder/parse.go`：`splitList`（`:289-304`）／`splitNums`（`:306-315`）加去引号容忍（无论选哪项都建议做——正本已定裸数字，工具宽容不冲突）。
3. **下游适配（novel 侧，已立票待触发）**：novel `.plan/merge-prep-adapt/tickets/01-blocked_by形态回扫.md`（open）。**该票的形态口径以后置本仓结论为准**：选 A/C（工具容忍）→ 该票转「不动文档」并关闭；选 B（回扫）→ 按该票执行 23 处去引号。

## 六、验收口径

- [ ] 形态口径裁定落盘（票 06 或独立拍板记录），**含用户原话**
- [ ] `wayfinder-maps status <实施图>` 能正确读出票态（选 A 时）——以 `.plan/micro-fixes` 四票应读成 **4 resolved**（非 4 open）为准
- [ ] 或（选 B/C）协议已明示工具边界与形态适用范围
- [ ] 带引号 `blocked_by` 不再致解析中止（任一选项都建议覆盖）
- [ ] 若改协议：源仓 → `install-skills.sh` 分发 → **两处 md5 一致**复核
- [ ] 若改工具：`go build`＋`go test ./internal/wayfinder/` 过
- [ ] 两侧 plan-lint 收尾零漂移（dsh-plugin 现为 38 md 绿）

## 七、建议加载的 skills（**仅当该 agent 环境存在**）

- **`plan-protocol`**（必需）——本次裁定的规则正本（§三 文档形态约定）；改协议前必读。
- **`to-tickets`**——若裁定产生新工单，票格式正本，勿手搓格式。
- **`to-approval`**——若形态口径属需求级分歧、需先拍板再动手，用它落审批文档（**本项属此类，建议优先**）。
- **`plan-approve`**——裁定后结算与推进文档状态。

## 八、边界与已知坑

- **勿据 A 类/B 类报错数当缺陷数**——它们是同一根因（工具单边契约）的两个表现面，不是 42 个独立缺陷。
- **勿用 wayfinder-maps 的报错反推「计划文档坏了」**——同一批文档被 `plan-lint.sh` 判零发现；先分清是哪把尺子。
- **`wayfinder-maps` 传参是 effort 目录**（含 `map.md` 者），不是 `.plan` 根——传根目录会报「no map.md in .plan」，那是用法错、不是图坏。
- **本交接不含原会话转录**；证据均可按上表命令复现（`lint`/`status` 命令 + `splitNums` 复刻）。
- **novel 侧已完成的适配**（约 40 处文档漂移）已提交 `a29292d`／`ce158f8`，`impl/spec-batch` 已快进并入 `main`（未推送远端）；与本交接无关的部分不必重做。
