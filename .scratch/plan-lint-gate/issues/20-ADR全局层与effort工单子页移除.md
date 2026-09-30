---
type: task
blocked_by: []
claimed_by: dsh-plugin 会话（拍板直推）
status: done 2026-09-30
---

# 20: ADR 全局层 ＋ effort 层移除「工单」子页

**What to build:** 用户 2026-09-30 两条视图拍板（原文与配套方案见 [已拍板-视图ADR全局层与effort工单子页移除-20260930.md](../../../.plan/approval/已拍板-视图ADR全局层与effort工单子页移除-20260930.md)）：

1. `docs/adr` 纳入 plan-view 展示，第一层新增「🏛️ ADR」页（台账与 CONTEXT 之间）。
2. 地图页第二层移除「🎫 工单」子页，票列表归宿 = 路线子页三变体（数据零丢失）。

**Source spec:** 审批档 §三配套裁决（实施形状五点全在档内）。

## Acceptance

- [x] 服务端 `lib/server.js` collectSnapshot 增收 `docs/adr/NNNN-*.md`（形状外不展示），`group: 'adr'`；读取契约注释同步
- [x] 客户端 `assemblePlanData` 分流 `adrs`（不进票面/图面，`ticketKind` 不计成工单）；`TopView` 增 `adr`；新 `AdrView`（卡片-内联模式同测例页；Status 词表 proposed/accepted/deprecated/superseded，缺省「未标」；计数 = 总数）
- [x] `MapSub` 去 `tickets`、tab 条与渲染行移除；空态判据补 adrs 面
- [x] 头注释 tab 面与 GuideView 联动改（页签枚举加 ADR；「🗺️ 地图 → 🎫 工单」文案改指路线子页；「工单表」表述改「路线页 Table 变体」）；`docs/单据状态机.md` 计数口径行 + 横向纪律 ADR 行联动
- [x] `tsdown -c tsdown.standalone.ts` 构建过 + `node --test test/` 12 测全绿 + plan-lint 双面 0 新发现（.plan 根层 9 项 = 票 18 挂账存量，基线不变）

## 落地注

- 2026-09-30 当日施工（拍板直推，同批三 commit：docs 立票 → feat ADR 层 → feat 工单子页移除）。设计要点：①ADR 只在**现行面**（round=null）收集——历史轮是 `.scratch` 快照，ADR 属知识层非轮成员，混入轮视图会把「当时」与「现在」搅在一起（测试钉住）；②ADR 分流先于 `ticketKind`——无 type 有 status 的 ADR 否则会被兜底计成工单，四处计数虚高；③形状外（非 `NNNN-` 前缀）不收，契约外不可见孤岛口径与 effort 白名单一致。
- 保留观察：`docs/单据状态机.md` 第 5 节「图与 spec」之外的 49 行仍有预存漂移（「🧪 测例&缺陷」合并 tab 旧称，票 15 拆分后未联动）——非本票范围，已向用户披露。
- 本仓无 `docs/adr/` 实档，ADR 页冒烟为空态路径；带档视觉验收待 dsh 真机（用户过面板）。
