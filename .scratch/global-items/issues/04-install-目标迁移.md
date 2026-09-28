---
type: task
blocked_by: []
status: done 2026-09-29
---

# 04: install-skills 安装目标迁 `~/.dsh/skills`

**What to build:** DSH 已把 skills 安装态迁 `~/.dsh/skills`（软链重指、agent-presets/full/skills 清空），install-skills.sh 的 SKILLS_DST 默认值随迁；头注释重写保留 ticket 04 历史；架构正本与 skills README 的路径同步；拍板档旧路径加过时标注。

**Blocked by:** None — can start immediately（独立于 01-03 的环境侧变更）

**Source spec:** `.scratch/global-items/spec.md`

## Acceptance

- [x] SKILLS_DST 默认 `~/.dsh/skills`；头注释含 History 段（ticket 04 选择旧目标的因 + 2026-09-29 DSH 迁回的事实）
- [x] 重装到新目标：自检两道全过；24 个 vendored skill `diff -r` 全树零 gap（to-spec→mp-to-spec 映射核对含在内）
- [x] docs/architecture.md、skills/README.md 无旧路径活引用（sweep 仅剩历史留痕）
