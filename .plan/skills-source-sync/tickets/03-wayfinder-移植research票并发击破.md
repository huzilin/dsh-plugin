---
type: task
blocked_by: []
status: open
---

# 03: wayfinder 移植 research 票并发击破机制（拍板 C.C1）

**What to build:** 按源侧 2602257 的机制补本仓 wayfinder SKILL.md 两处：①charting 流程补「对本轮新建的每个 research 票 fire 一个 subagent 调 research skill 并发解决」步骤（置于建票之后、收尾之前，与本仓「charting 不解票」句兼容表述为 research 票例外）；②resolving 约束「never resolve more than one ticket per session」补 research 票例外。两处按本仓 adapter 语境改写：产物落点沿用本仓 research skill 的 `.plan/research/<slug>.md` 惯例（替代源侧 throwaway branch + context pointer 措辞），「close/claim」等词沿用本仓 adapter 词形。本仓既有段（Two rules、What stays prose、undermined、Fog or ticket 等）一律不动。

**Blocked by:** None — can start immediately

**Source spec:** `.plan/待拍板-skills源同步引入-20260925.md` §待拍板 C

## Acceptance

- [ ] charting 步骤含 research 票并发击破，且产物落点为 `.plan/research/` 惯例而非 issue tracker 措辞
- [ ] resolving 一票/session 约束带 research 例外
- [ ] 零外部引用自查通过（skill 自含纪律）：新增文字不引用本仓外 skill 名与 tracker 概念
- [ ] 跑 `scripts/install-skills.sh` 同步安装态
