---
type: task
blocked_by: []
status: done
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

- [x] 手工样例验证：effort `approval/` 下的待拍板档可被发现——实况更正：`collectTicketFiles` 本就通用扫描 effort 全部子目录（PlanView.tsx:535-537），`approval/` 档凭 `type: approval` 走 :366 路由进待拍板，**零代码即工作**；transient 样例（approval/ 待拍板 + tickets/12 research 票）过 lint 69 文件全绿后已清理
- [x] research / prototype / grilling 票在卡片与详情有类型标识——新增 `SPECULATION_TICKET_META` + `ticketDisplayMeta`（PlanView.tsx:403-420），五个渲染点（DetailModal/ViewA×2/ViewC/ViewD）统一切换：🔍调研票 🧩原型票 🔥拷问票 彩色徽标，task 仍走工单默认
- [x] 推演图/实施图分组在 issues/ 布局下正确——`mapKind` 按 frontmatter type 判定、目录无关（:418-429），`issues/tickets` 双目录均被 `TICKET_DIR_NAMES` 覆盖（:515）
- [x] plan-lint 双根全绿无新增误报——带样例 69 / 清理后 67 文件零漂移
- [x] GuideView 待拍板/票型说明同步——布局图补 `approval/` 行、新增「四种票型怎么认」段（PlanView.tsx:2041-2057、2063-2071）

## 落地注

- 2026-09-29 implement-spec 降级模式（当前分支直推）完成：src/PlanView.tsx + lib 重建（npx tsdown；tsdown 不在 devDependencies 且本机未装，npm install 328 包后仍经 npx 运行；**package-lock.json 未入库已删**；lib/server.js 为旧产物未动）。commit 见本票收口批。
- 预设更正：What-to-build 第 1 项原以为「待拍板 tab 不发现 approval/」——实况通用子目录扫描已覆盖，无需新代码；本票实际新增只有票型徽标与文案。
- UI 视觉确认（徽标观感、approval/ 档入 tab）待用户开面板过目——代码路径与 lint 证据如上，如观感需调色/改字随时说。
