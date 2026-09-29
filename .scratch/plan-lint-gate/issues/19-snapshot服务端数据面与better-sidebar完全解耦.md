---
type: task
blocked_by: []
claimed_by: dsh-plugin 会话（拍板直推）
status: done 2026-09-30
---

# 19: snapshot 服务端数据面——plan-view 与 better-sidebar 完全解耦

**What to build:** 用户 2026-09-30 报 plan view 加载慢（体感 20 倍）。排查定案：慢因 = better-sidebar 0.22.x 每 fs 调用 ~100ms 且完全串行（非票15；详见 `.plan/待拍板-planview加载性能-20260930.md` 证据链）。用户拍板方案A并明确目标「plan-view 和 better-sidebar 完全解耦」。

**Source spec:** 审批档 [待拍板-planview加载性能-20260930.md](../../../.plan/待拍板-planview加载性能-20260930.md) 方案A节（含边界澄清、解耦程度口径、落地后剩余面）。

## 改造项

1. **服务端 snapshot 路由**（`lib/server.js`，空壳长出路由）：`ctx.webServer.register` 挂 `/plan-view/snapshot`（POST）——入参仅 `sessionId`（+可选 `round`），服务端经 `ctx.sessions.get` 解析 cwd（进程内即时），按现行读取契约（map/spec effort 判据、收集白名单七目录、`PLAN_ROOT_ALLOW` 根层过滤、qa whitelist 交客户端）遍历直读，**一次返回** `{ cwd, efforts(mapRaw/specRaw), files(path/name/from/group/content), rounds(ids+readmeRaw), contextRaw }`。round 模式 = 同一收集器指到 `.archive/rounds/<id>/`（id 白名单 `^\d{4}-\d{2}-\d{2}` 防穿越）。Origin/Host fence 复刻（自包含，不 import better-sidebar）。
2. **写端点**：`/plan-view/write`（POST，`sessionId`+`path`+`key`+`value`）——read-modify-write 原子 upsert frontmatter 键（客户端免读原文），path 经 realpath 校验必须落 cwd 内（围栏自实现），原子写（tmp+rename）。
3. **客户端数据源切换**：`api.ts` 改 `snapshot()`/`bindTicket()`，`loadPlanMerged/loadPlan/loadRounds/CONTEXT` 全并进一次 snapshot；`sessionCwd` 链退役（`PlanTabBody` 直挂 PlanView，cwd 由首帧响应填充）；`fsTree/fsRead/fsWrite` 及 `session.cwd` fallback 清退。
4. **解析逻辑不动**：frontmatter/状态推导/kind 分类/qa whitelist 过滤留在客户端（响应给 raw，`deriveTicketStatus` 流程复用）。

## Acceptance

- [x] 加载期对 `/sidebar/api/*` 请求数 = 0（浏览器 performance 面板实测：`/plan-view/snapshot` ×1、sidebar 数据面 ×0；仅宿主自身 `settings.get` 1 次与本插件无关）
- [x] 隔离实例（planview-test profile）实测首屏数据与读取契约一致：efforts=6、spec-only=global-items、票文/全局台账/根层审批档形状（PLAN_ROOT_ALLOW）/rounds/CONTEXT 全对上；冷会话走 persistence.list fallback（**未用 open**，避开挂死路径）
- [x] 首屏加载 ~10.9s（106 调用×100ms 串行）→ 单请求 92–133ms + 渲染，**<1s 达标**
- [x] 历史轮：round 白名单拦截穿越（负例 500）；round 模式收集器单测覆盖（本仓无归档轮，UI 无轮可点，切换逻辑由 `collectSnapshot(round)` 测试钉住）
- [x] `node --test test/` 12/12 绿（新增 snapshot.test.js 6 项：契约收集/轮模式/穿越/空仓容缺/frontmatter upsert/只读性）
- [x] 读取契约注释随迁（lib/server.js 头部：白名单七目录/PLAN_ROOT_ALLOW/map-spec 判据/`.plan` 无 effort，与 plan-lint 双源一致）

## Answer

commit `6f58adb`（feat(plan-view): snapshot 服务端数据面——与 better-sidebar 完全解耦（票19））。三句讲清：

1. **架构**：`lib/server.js` 空壳长出两条路由（snapshot/write），与 better-sidebar 挂 `/sidebar/api` 用同一 `ctx.webServer.register` 机制；客户端 106 次通用 fs 调用收敛为 1 次快照。cwd 服务端解析（header 命中即时，冷会话走 `sessionPersistence.list()` **轻量快照**——绝不 open，open 会挂死是 8ecb415 的实证），响应自带 cwd 回填，`sessionCwd` 10s 超时帽整条退役。
2. **踩坑记录（对后来者最值钱的一条）**：`PlanView` 签名从 `{ctx, scope}` 改 `{ctx, sessionId}` 时漏了 `ctx` 解构——**首帧渲染成功（loading 行不引 ctx）、snapshot 回来重渲染才在 `ctx={ctx}` 处 ReferenceError**，被官方 slot 错误边界吞成空白 pane（`data-slot-error`，零 console 输出）。esbuild 不查类型，tsc 才抓得到。已修（`ctx` 解构+注释钉死）并把「签名改造必过 tsc + node renderToString 复现法」沉淀进本文。
3. **生效路径**：客户端变更须冷启动 DSH web。**未动 :3080 主实例**（GUI 本身，会话中途不能停）——本会话内实测全部在 planview-test 隔离实例（:3499，测完已停）。主实例生效：`dsh-services stop dsh && dsh-services start dsh`（按纪律，勿 kill），浏览器强刷。

**边界（未做）**：上游 better-sidebar 0.22.x 的每调用 ~100ms（影响文件树/编辑器等所有走 `/sidebar/api` 的界面）是独立问题，属审批档方案B范畴，本票不含；`settings.get` 那 1 次宿主请求与 plan view 无关。
