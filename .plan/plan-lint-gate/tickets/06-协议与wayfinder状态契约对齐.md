---
type: task
blocked_by: []
status: open
---

# 06: 协议与 wayfinder 状态契约对齐（D3 前置）

> **交接文档（2026-09-27）**：[`.plan/handoffs/2026-09-27-协议与wayfinder状态契约对齐.md`](../handoffs/2026-09-27-协议与wayfinder状态契约对齐.md)——含两处未对齐的实测证据、两类失败的量化、三选项详表、两仓改动落点（含「协议源仓有他会话在途改动」警示）与验收口径。**动手前先读该交接。**

**What to build:** 裁定并消除 `plan-protocol` 协议与 `wayfinder` 方法学在**票面状态契约**上的未对齐点，使两套契约在「同一份票面」上可共存、且工具能正确读数。

**Blocked by:** None — can start immediately

**Source spec:** novel 仓 `.plan/待拍板-合并前体检与spec-batch并入-20260927.md` 决策项 D3（用户 2026-09-27 拍板原话：「这个参考 /plan-protocol 是不是有哪里没对齐，如果是协议和 wayfinder 本身没对齐，那需要让协议对齐，然后再适配」）

## 未对齐点（三处，已实测）

### 一、`status` 字段的合法性：存 vs 不存

| 侧 | 立场 | 出处 |
|---|---|---|
| plan-protocol（协议） | **frontmatter 是权威**；实施图票终态 `done`、执行中 `claimed` | `mp-plan-protocol/SKILL.md:89,97` |
| wayfinder（方法学） | status **派生不存**；`status:` 字段被标 `deprecated`，lint 报「stored status … is not open\|claimed\|resolved\|out_of_scope」 | `wayfinder-maps/internal/wayfinder/{parse.go:10-11,57, lint.go:69-75}` |

**后果实证**：`.plan/micro-fixes` 四票 frontmatter 全 `status: done`，`wayfinder-maps status` 读出「**0 resolved · 4 open**」——工具完全不认 `done`，把已收口的图读成四票待办。

### 二、状态词表：`done` 不在 wayfinder 词表

wayfinder 的 `validStatuses` = `open|claimed|resolved|out_of_scope`（`lint.go:41`），**无 `done`**。故所有实施图票在 wayfinder 眼里：`status: done` 报错、正文无 `## Answer` 则派生为 `open`。

### 三、`blocked_by` 形态：裸数字 vs 带引号

契约正本模板为裸数字（`to-tickets/SKILL.md:67`、`TRACKER-MARKDOWN.md:37`），但 novel 9 图 23 处为带引号 `["04"]`，致 wayfinder 解析中止（`splitNums` 用 `strconv.Atoi` 直解）。详见 novel 仓 `.plan/merge-prep-adapt/tickets/01-blocked_by形态回扫.md`。

## 背景：两套契约本就分属两种图型

plan-protocol §三 已写明**图二型**：推演图（票型 `research`/`prototype`/`grilling`，wayfinder 推导形态，status 不入 frontmatter）与实施图（票型 `task`/`impl`，frontmatter 形态，status 写 frontmatter）。**协议侧已声明两形态共存**；未对齐处在于：wayfinder 工具实现只认推导形态，对实施图形态既报错又不识别。

## 待裁定（本票需先定结论，再动手）

| 选项 | 动作 | 影响 |
|---|---|---|
| **A** | 改 wayfinder 工具：识别 `task`/`impl` 型票的 frontmatter `status`（`done`/`claimed`），仅在推演图票上坚持推导形态 | 工具可读全部图；改动在 wayfinder-maps 仓 |
| **B** | 改协议：实施图也改用推导形态（正文 `## Answer` 表终态，frontmatter 不存 status） | 协议与 wayfinder 完全统一；但需回扫全仓实施图票（novel 32＋张），且与现有 to-tickets 契约、插件读取逻辑冲突 |
| **C** | 明确「两工具分治」：wayfinder-maps 只用于推演图，实施图只用 `plan-lint.sh` | 零改动；但需在协议写明工具适用范围，且 wayfinder 对混合图的报错仍需容忍 |

**〔我的推断〕**推荐 **A**——协议已声明两形态共存，未对齐的是工具实现单边只认一种；改工具比回扫全仓单据更符合「单一真相源」，且不动已验证的 to-tickets 契约。

## Acceptance

- [ ] 形态口径裁定落盘（本票 C 节或独立拍板记录）
- [ ] 按裁定改动：改工具（A）／改协议＋回扫（B）／协议写明工具边界（C）
- [ ] 若涉协议改动：改 `packages/dsh-plan-view/skills/plan-protocol/SKILL.md` 源仓，再经 `install-skills.sh` 分发安装态（两处一致）
- [ ] 终验：`wayfinder-maps status <实施图>` 能正确读出票态（选 A/C 时），或协议已明示工具边界（选 B/C 时）
