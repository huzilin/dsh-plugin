---
type: task
blocked_by: []
status: open
---

# 02: improve-codebase-architecture 移植 YAGNI 扫描定向段（拍板 B.B1）

**What to build:** 把源侧 SKILL.md 的「Scope before you scan: YAGNI」段（原文照抄见审批文档 §待拍板 B）插入本仓版 SKILL.md 的「读 glossary/ADR 之后、subagent 走查之前」位置。本仓自含化改造（proceed silently 两处、subagent 环境兼容措辞）原样保留；引入文字随带源侧文风（无 em-dash）。HTML-REPORT.md 无实质差异，不动。

**Blocked by:** None — can start immediately

**Source spec:** `.plan/待拍板-skills源同步引入-20260925.md` §待拍板 B

## Acceptance

- [ ] YAGNI 段四行在位，位置正确（glossary 读取与 walk the codebase 之间），过渡语句连贯
- [ ] 本仓既有改造句全部保留（diff 自查：proceed silently ×2、subagent 兼容措辞仍在）
- [ ] 跑 `scripts/install-skills.sh` 同步安装态
