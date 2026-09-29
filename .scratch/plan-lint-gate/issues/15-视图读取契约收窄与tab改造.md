---
type: task
blocked_by: []
status: open
---

# 15: 视图读取契约收窄与 tab 改造

**What to build:** 2026-09-30 用户定义视图读取契约（原话「展示读取逻辑……所以这几个目录也对应的」），写入矩阵正本 = [docs/research/梳理-plan目录写入矩阵-20260930.md](../../../docs/research/梳理-plan目录写入矩阵-20260930.md) §六。按契约改造 plan-view 数据面与页签。

**Source spec:** 用户会话口述 + AskUserQuestion 三拍板（推演票落点维持 issues／总览=effort 汇总+全局待拍板／测例&缺陷拆两 tab 聚合全局）。

## 改造项

1. **路线数据源收窄**：`collectTicketFiles` 从「effort 下所有子目录遍历」改为白名单枚举——`issues/`（路线/工单/推演票唯一票源）+ effort 根层 + `approval/` + `qa/` + `ledger/`；**去掉 `assets/` 与任意自建子目录收集**（assets 是资源不是票）。
2. **推演票专页数据源不变**：继续 `issues/` 按 `type ∈ research/prototype/grilling` 过滤（2026-09-30 拍板维持四型同居，已核证 wayfinder 官方版本即 issues/ 装全部票型）。
3. **新增第 2 tab【map】**（推演图专属）：含 `map.md` 的 effort，子页签栏在路线后加 map 正文渲染（复用现有 `md()` 渲染器）。
4. **新增第 2 tab【spec】**（实施图/spec-only 专属）：仅含 `spec.md` 的 effort 显示 spec 正文渲染；两类 effort 的第 2 tab 互斥（图类型由 map/spec 有无推导，既有 mapKind 逻辑）。
5. **全局【测例&缺陷】拆两 tab**：【测例】= 各 effort `qa/cases*.md` 聚合 `.plan/qa/cases-*.md`；【缺陷】= 各 effort `qa/DEF-*.md` 聚合 `.plan/qa/DEF-*.md`。
6. **总览改版**：effort 汇总卡（每 effort 票数/状态概要）+ 全局待拍板区（`.plan/` 根层审批档）——全局件在总览保留展示位。

## Acceptance

- [ ] collectTicketFiles 白名单化；`assets/` 与自建子目录文件不再出现在任何票列表（nvwa fengping 档实测消失）
- [ ] 推演票专页 research/prototype/grilling 展示不变（回归：nvwa/dsh-plugin 现有 research 票可见）
- [ ] 推演图 effort 出现【map】tab 且渲染 map.md 正文；spec-only effort 出现【spec】tab（global-items 实测）
- [ ] 全局【测例】【缺陷】两 tab 数据齐全（图内 + `.plan/qa/` 聚合，计数与文件清单对账）
- [ ] 总览含 effort 汇总卡 + 全局待拍板区
- [ ] `node --test test/` 全绿 + 隔离实例浏览器实测（test profile 纪律）
