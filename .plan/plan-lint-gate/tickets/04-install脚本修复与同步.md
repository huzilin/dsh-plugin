---
type: task
blocked_by: [03]
status: open
---

# 04: install-skills.sh 修复与安装态同步（项 3 修复）

**What to build:** 修同步机制本身，再把改好的 skill 真正同步进活安装态：①目的地从过时的 `~/.dsh/skills`（现为空目录）改为 `~/.dsh/.agent-presets/full/skills`——落票实施时先核实 `.agent-presets` 是否有 DSH 自身回填机制，避免双写打架；②具名清单补 `plan-sync`（今日不在清单内），并核 `to-qa-testcases`/`run-qa-testcases` 是否入列（对应「其余暂靠手动同步」既记缺口）；③同步后加在位自检（`scripts/plan-lint.sh` 在位断言）；④实际执行同步并验收。

**Blocked by:** 03（同步的是含 `scripts/` 的完整 skill 目录，先让脚本进源目录）

**Source spec:** `.plan/plan-lint-gate/待拍板-plan-lint随skill内置分发-20260923.md`（项 3，原话「3 修复」）

## Acceptance

- [ ] `.agent-presets` 回填机制核实结论写入本票落地注（有/无 DSH 自身同步，目的地据此定稿）
- [ ] 清单补 plan-sync；qa 两 skill 入列问题有书面结论
- [ ] 同步后安装态 `mp-plan-approve/` 与 `mp-plan-sync/` 各含 `scripts/plan-lint.sh`，自检通过
- [ ] novel 侧（任意非本仓工作区）按 skill 文本实跑 lint 成功——plan-approve 第 1 步不再降级为手工等价检查
- [ ] `~/.dsh/skills` 旧目的地残留处置有结论（清空或标注废弃）
