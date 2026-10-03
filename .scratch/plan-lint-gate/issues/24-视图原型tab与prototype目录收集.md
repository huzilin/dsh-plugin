---
type: task
---

# 24: plan-view effort「原型」tab 与 prototype/ 目录收集

**What to build:** 票 23 落地了契约层（`.scratch/<effort>/prototype/` 白名单＋自包含 html 形态），本票补视图侧：①服务端 snapshot 收集每个 effort 的 `prototype/` 目录文件清单（建议 `efforts[].prototypes: {name, path}[]`——只列清单与路径，html 本体不进 snapshot 内容，避免膨胀）；②html 内容读取通路（候选：专用只读端点按路径返回 html，客户端 iframe `srcdoc`/`src` 加载；或复用现有文件读取通道）；③客户端展示 UI。**展示形态两案**（影响面：主要 UI 结构变更，实施前按透明纪律过用户）：A（推荐）＝地图 tab 内第五子页「原型」（与工单/待拍板/缺陷/台账并列，iframe 预览＋文件列表侧栏）；B＝顶层独立 tab（跨 effort 聚合，需归组逻辑，原型是 per-effort 资产故归组意义弱）。无 prototype/ 的 effort 不显示该子页（或显示空态）。

**Blocked by:** 23

**Status:** open

## Acceptance

- [ ] 服务端收集：effort 含 `prototype/` 时 snapshot 带文件清单，html 零内联膨胀。
- [ ] html 渲染通路可用（iframe 预览，`#variant=` 切换在预览内工作）。
- [ ] 展示形态（A/B）经用户确认后实施；单测覆盖 snapshot 结构变化。
- [ ] 安装态分发后实测一个含 prototype/ 的 effort 展示正常。
