---
type: task
---

# 24: plan-view effort「原型」tab 与 prototype/ 目录收集

**What to build:** 票 23 落地了契约层（`.scratch/<effort>/prototype/` 白名单＋自包含 html 形态），本票补视图侧：①服务端 snapshot 收集每个 effort 的 `prototype/` 目录文件清单（建议 `efforts[].prototypes: {name, path}[]`——只列清单与路径，html 本体不进 snapshot 内容，避免膨胀）；②html 内容读取通路（候选：专用只读端点按路径返回 html，客户端 iframe `srcdoc`/`src` 加载；或复用现有文件读取通道）；③客户端展示 UI。**展示形态两案**（影响面：主要 UI 结构变更，实施前按透明纪律过用户）：A（推荐）＝地图 tab 内第五子页「原型」（与工单/待拍板/缺陷/台账并列，iframe 预览＋文件列表侧栏）；B＝顶层独立 tab（跨 effort 聚合，需归组逻辑，原型是 per-effort 资产故归组意义弱）。无 prototype/ 的 effort 不显示该子页（或显示空态）。

**Blocked by:** 23

**Status:** resolved 2026-10-04

## Acceptance

- [x] 服务端收集：effort 含 `prototype/` 时 snapshot 带文件清单（`efforts[].prototypes`，单层 `.html`；md/子目录不收），html 零内联膨胀。
- [x] html 渲染通路可用（新只读 GET 端点 `/plan-view/prototype?sessionId=&path=`，iframe src 直指；`#variant=` 切换为文档内 hash 行为不受预览面干预；路径围栏 `prototypePathError`＝cwd 内＋`/prototype/` 单层 `.html`，历史轮放行）。
- [x] 展示形态＝A 案（用户原话「effort 单独的一个 tab」即地图内子页，地图 tab 第五子页「🖥️ 原型」，与工单/待拍板/缺陷/台账并列；仅选中 effort 且有原型时插入，同 mapdoc/specdoc 模式；多文件 pill 切换）。
- [x] 单测覆盖：snapshot 收集断言（单层 html 收/md/子目录/空数组）＋prototypePathError 七例；65 测全绿；bundle 重建（standalone 配置）。

## 执行记录（2026-10-04）

改动五文件：`lib/server.js`（PROTO_FILE 常量＋COLLECT_DIR_NAMES 加 prototype＋listPrototypes＋collectRoot efforts 扩字段＋GET 端点＋prototypePathError 导出）；`src/client/api.ts`（Snapshot 类型＋prototypeUrl）；`src/client/PlanView.tsx`（import＋PlanData/assemble 透传＋MapSub 加 `protodoc`——避开既有推演票型子页 id `prototype` 撞名＋子页签插入＋ProtoView/subBtnLike 组件）；`test/snapshot.test.js`（收集断言＋围栏用例）。形态选择说明：票面原列 A/B 两案待用户确认，用户问「是否按预期增加」——原话「plan-view effort 单独 的一个 tab」即 A 案语义，按 A 实施不再等确认。
