---
type: task
blocked_by: []
status: open
---

# 01: domain-modeling 三文件整体对齐源侧新版（拍板 A.A1）

**What to build:** `packages/dsh-plan-view/skills/domain-modeling/` 的 SKILL.md、ADR-FORMAT.md、CONTEXT-FORMAT.md 三文件整体以源侧（`/Users/huzilin/workdir/skills/skills/engineering/domain-modeling/`）覆盖，引入两步升级：08-13 的 description 触发词重写、08-19 的 em-dash 清除文风。本仓侧无本地改造，直接覆盖无损失。

**Blocked by:** None — can start immediately

**Source spec:** `.plan/待拍板-skills源同步引入-20260925.md` §待拍板 A

## Acceptance

- [ ] 三文件与源侧逐字节一致（diff -r 为空）
- [ ] 确认本仓侧覆盖前无独有内容（覆盖前 diff 复核一遍，仅剩文风/描述差异）
- [ ] commit message 注明 skill 触发面变化（description 重写）
- [ ] 跑 `scripts/install-skills.sh` 同步安装态，汇报提醒新开会话生效
