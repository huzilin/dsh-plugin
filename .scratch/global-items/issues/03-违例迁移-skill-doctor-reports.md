---
type: task
blocked_by: [02]
status: done 2026-09-29
---

# 03: 首单违例处置——skill-doctor-reports 迁 `.archive/`

**What to build:** 检查 [6] 首跑报出 `.plan/skill-doctor-reports/`（清单外）；按协议「有留存价值转 `.archive/`」`git mv` 迁入（报告被 `.plan/ponytail-触发诊断与最佳实践.md` 引用为证据源、不删文件），建 `.archive/README.md` 登记非轮归档条目。

**Blocked by:** 02（违例由检查 [6] 发现）

**Source spec:** `.scratch/global-items/spec.md`

## Acceptance

- [x] 两份报告文件在 `.archive/skill-doctor-reports/`（git mv 保历史，rename 100%）
- [x] `.archive/README.md` 存在且登记成因/日期/路径；`.zcodeignore` 已排 `.archive/`（检索面收窄）
- [x] 迁后本仓 lint 全绿
