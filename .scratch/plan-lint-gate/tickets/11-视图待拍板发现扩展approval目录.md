---
type: task
blocked_by: []
status: open
---

# 11: 视图待拍板发现扩展 effort 的 approval/ 目录

**What to build:** 2026-09-29 拍板「grill-with-doc / wayfinder 生成的审批档放 effort 中，可独立存储 approval 目录」——协议 129 与 to-approval 步骤 7 文本已随拍板改为两级归属；**视图待拍板 tab 尚不发现 `.scratch/<effort-slug>/approval/`**（collectTicketFiles 只扫 `tickets|issues`，TICKET_DIR_NAMES），本票补上。

**Blocked by:** None — can start immediately.

**Source spec:** 拍板正本 = plan-protocol「审批文档归属（两级）」条款（本批 commit）。

## What to build

1. PlanView 待拍板发现扩展：effort 目录下 `approval/*.md` 纳入待拍板 tab（按图归组展示，根层全局档照旧走 `.plan/` 根）。
2. 回归确认：`approval/` 目录不触发 lint[2]（票缺 map）、文件带四字段头过 lint[3]。
3. 存量注记：09-29 迁移提根层的历史档**不回迁**（归用户单独推进的存量批次，协议已注记）。

## Acceptance

- [ ] 视图能列出示例 effort `approval/` 下的待拍板档（手工造一个样例档验证）
- [ ] plan-lint 双根全绿无新增误报
- [ ] GuideView 待拍板说明同步 approval/ 口径
