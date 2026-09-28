---
type: task
blocked_by: []
status: open
---

# 11: 视图适配——approval 目录发现 + research/prototype 票型展示

**What to build:** 2026-09-29 两项拍板的视图适配批：①审批档两级归属（grill-with-doc / wayfinder 生成入 effort 的 `approval/` 目录）；②「按照新的目录结构，并支持新的 type 的展示，包括 research、prototype」。协议 129 与 to-approval 步骤 7 文本已随拍板改写；本票落视图侧。

**Blocked by:** None — can start immediately.

**Source spec:** plan-protocol「审批文档归属（两级）」条款 + 本批 map 决策行。

## What to build

1. **approval/ 发现**：effort 目录下 `approval/*.md` 纳入待拍板 tab（按图归组展示；根层全局档照旧走 `.plan/` 根）。
2. **票型展示**：`type: research / prototype / grilling` 的推演票当前全部渲染为普通「工单」（TicketKind 六类无类型身份）——补票型标识（卡片/详情的类型徽标，区分推演票与执行票）；`mapKind` 的推演图/实施图分组在 `issues/` 新目录下回归验证。
3. **lint 回归**：`approval/` 目录不触发 lint[2]（票缺 map）、四字段头过 lint[3]；issues/ 双根全绿。
4. **存量注记**：09-29 迁移提根层的历史审批档**不回迁**（归用户单独推进的存量批次，协议已注记）。

## Acceptance

- [ ] 手工样例验证：effort `approval/` 下的待拍板档出现在对应图待拍板 tab
- [ ] research / prototype / grilling 票在卡片与详情有类型标识，与 task 视觉可区分
- [ ] 推演图/实施图分组在 issues/ 布局下正确（含 legacy tickets/ 存量图回归）
- [ ] plan-lint 双根全绿无新增误报
- [ ] GuideView 待拍板/票型说明同步 approval/ 与票型口径
