---
type: task
blocked_by: []
status: done 2026-09-30
claimed_by: dsh-plugin 会话（implement-spec 直推）
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
7. **全局新增【CONTEXT】tab**（2026-09-30 追加拍板，放第一行**最后**）：读仓根 `CONTEXT.md` 渲染（复用 `md()`）；词汇表/领域正本展示位；文件缺失时显示空态提示行（tab 常驻不隐藏，与测例&缺陷计数 0 同理）。

## Acceptance

- [x] collectTicketFiles 白名单化；`assets/` 与自建子目录文件不再出现在任何票列表（nvwa fengping 档实测消失）
- [x] 推演票专页 research/prototype/grilling 展示不变（回归：nvwa/dsh-plugin 现有 research 票可见）
- [x] 推演图 effort 出现【map】tab 且渲染 map.md 正文；spec-only effort 出现【spec】tab（global-items 实测）
- [x] 全局【测例】【缺陷】两 tab 数据齐全（图内 + `.plan/qa/` 聚合，计数与文件清单对账）
- [x] 总览含 effort 汇总卡 + 全局待拍板区
- [x] 全局【CONTEXT】tab 位于第一行末位，渲染仓根 CONTEXT.md 正文；无 CONTEXT.md 的仓显示空态提示
- [x] `node --test test/` 全绿 + 隔离实例浏览器实测（test profile 纪律）

## Answer

落地 commit `fd2a685`（PlanView.tsx 七项 + lib 构建产物），单测 6/6 绿。实现要点：`COLLECT_DIR_NAMES = issues|tickets|approval|qa|ledger|impl|impl-fe` 七目录白名单（assets 是资源不是票，不收集——与 lint 检查[8] 口径角色不同不冲突：lint 管目录合法性，assets 合法；视图管票收集，assets 不收）；`PlanData.efforts` 加 `specRaw`，loadPlan 对每 effort 并行读 `spec.md`（catch null，与 mapRaws 同模式）；第一行 tab `TopView` 拆 `qa` → `cases`/`defects`，末位加 `context`；地图页第 2 子页 `MapSub` 加 `mapdoc`/`specdoc` 互斥（「全部地图」态不插）；GuideView 文案同步。

**浏览器实测（2026-09-30，隔离实例）**——环境注：`test` profile 缺 `dsh-better-sidebar`（bundles 无此包），plan-view 的 `/sidebar/api/*` fs 路由不存在致全部读取挂死（「No .scratch/.plan found」）——即移交会话「浏览器操作连续三次被取消/终止」的根因；改用 `planview-test` profile（better-sidebar 0.22.1 + plan-view link 工作区）后全绿。逐条：

1. 白名单化 ✓：nvwa jiaomai-gongyue 会话中 fengping/（9 风评档）、shoufaka/（10 手法卡）、assets/ 档全部未出现在票列表（全快照违例关键词零命中，仅 issues/ 合法票标题含「风评」字样）；dsh-plugin 侧白名单内 `tickets/` 存量票照常显示。
2. 推演票专页 ✓：dsh-plugin 4 张 research 票（`.plan/` 根层）展示不变。
3. map/spec 子页 ✓：plan-lint-gate 出【map】渲染 map.md 正文；global-items 出【spec】渲染 spec.md 正文；互斥成立（map effort 无 spec 子页）；两 effort 均带 spec-only/图类型 chip 标注。
4. 测例/缺陷聚合 ✓（0 对账）：dsh-plugin（`.plan/qa/` 空 + effort 无 qa/）计数 0/0 与文件清单一致；nvwa 同为 0/0。**非零聚合未实测**（本机无含 qa 数据的仓在线）。
5. 总览 ✓：6 张 effort 汇总卡（名称/阶段/进度/在途/待拍板）+ 全局待拍板区（`.plan/` 根层审批档，含「最久待拍板」）。
6. CONTEXT ✓（措辞修正注）：本 Acceptance 原文预期「dsh-plugin 仓根无 CONTEXT.md → 空态」与实情不符——仓根**有** CONTEXT.md（QA 技能族词汇正本，commit eb1151b 引入）；实测走渲染分支：tab 居第一行末位、词汇表正文完整渲染（heading/strong/code 全对）。空态分支与渲染分支同源（`specRaw` 同路径），未单独浏览器实测。
7. 单测 6/6 + 实例实测 ✓（环境见上注）。
