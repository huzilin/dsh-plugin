---
type: task
blocked_by: []
status: open
---

# 17: 工单票号 effort 前缀化（跨 effort 全局唯一）

**真相源**：2026-09-29 对账拍板（用户原话「5 转工单」，指对账单⑤悬置项立项）。背景＝nvwa jiaomai-gongyue 会话质询「ticket 号唯一漏实现」：查证协议正本无工单号全局唯一条款（唯一带 effort 名的编号条款是缺陷 `DEF-<effort-slug>-NN`，2026-09-28 拍板）、「双 07 撞号接受现状」反向拍板在案（本图 `tickets/` 即有活的 `07-nvwa存量impl票回扫` × `07-取代登记完备性校验` 双 07）；用户拍板立新规＝工单票号带 effort 名保跨 effort 唯一。

## What to build

1. **plan-protocol §三补票号条款**：工单票编号从 `<NN>-<slug>` 扩为带 effort 名的全局唯一形态；与缺陷编号条款（`DEF-<effort-slug>-NN`）措辞对齐；旧形态标注为存量兼容。
2. **to-tickets SKILL.md 同步**：立票编号形态改前缀化；「一票一文件」示例与 `<NN>-<slug>` 表述全部随改。
3. **plan-lint 新检查**：跨 effort 工单票号唯一性断言——新形态票跨 effort 重号即报；裸 `NN` 票按 D3 生效判据处置（与票 16 的 lint 新检查同批实现可并轨）。
4. **wayfinder 一致性联动**（2026-09-27 拍板「blocked_by 格式须 plan-protocol 与 wayfinder 保持一致」）：`packages/dsh-plan-view/skills/wayfinder/` 本仓自有部分随号形同步。
5. **视图核对（预期零改动，写进落地注即闭环）**：ticketId=文件名天然唯一；shortId 徽标对 `slug-NN` 形态仍显示 NN（`shortId` 正则 `[A-Za-z]*\d+` 对含 `-` 的前缀回溯实测）；`resolveRef` 对全号引用（`id === ref`）已支持。

## 决策点（实施前须用户拍板）

- **D1 引用形态与 2026-09-27 blocked_by 拍板的冲突裁决**：既有拍板明文「`blocked_by: [NN, NN]` 禁止非数字 id」——票号带 effort 名后引用必变非数字。选项：①图内引用维持裸 NN、仅跨 effort 引用写全号（双轨，`resolveRef` 前缀匹配兜底）；②修订该拍板，全号统一。②须连「票面类型与 blocked_by 格式口径」偏好正本一起改。
- **D2 分隔形态**：`<effort-slug>-NN`（与 DEF 同构，推荐）vs `<effort-slug>-<NN>-<slug>`（文件名三段）。
- **D3 存量处置**：只约束新票（旧票不改号，lint 豁免裸 NN）vs 全量回扫（novel 数百票，成本高；本仓 77 md 内先行试点）。

## Acceptance

- [ ] 协议/to-tickets/lint 三件文本落地且互一致（同一号形、同一豁免口径）
- [ ] wayfinder 本仓自有部分同步（逐字 diff 留痕）
- [ ] lint 新检查对本仓双根跑绿（D3 豁免口径下）
- [ ] 试点：nvwa jiaomai-gongyue 一张票改新号，视图识别、徽标、blocked_by 解析三验
