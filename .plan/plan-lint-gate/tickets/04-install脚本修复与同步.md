---
type: task
blocked_by: [03]
status: done
---

# 04: install-skills.sh 修复与安装态同步（项 3 修复）

**What to build:** 修同步机制本身，再把改好的 skill 真正同步进活安装态：①目的地从过时的 `~/.dsh/skills`（现为空目录）改为 `~/.dsh/.agent-presets/full/skills`——落票实施时先核实 `.agent-presets` 是否有 DSH 自身回填机制，避免双写打架；②具名清单补 `plan-sync`（今日不在清单内），并核 `to-qa-testcases`/`run-qa-testcases` 是否入列（对应「其余暂靠手动同步」既记缺口）；③同步后加在位自检（`scripts/plan-lint.sh` 在位断言）；④实际执行同步并验收。

**Blocked by:** 03（同步的是含 `scripts/` 的完整 skill 目录，先让脚本进源目录）

**Source spec:** `.plan/plan-lint-gate/待拍板-plan-lint随skill内置分发-20260923.md`（项 3，原话「3 修复」）

## Acceptance

- [x] `.agent-presets` 回填机制核实结论写入本票落地注（结论：无 DSH 自身回填，本脚本/手动拷贝是唯一同步路径，写入即终态）
- [x] 清单补 plan-sync；qa 两 skill（to-qa-testcases / run-qa-testcases）已入列（identity id，与既有安装名一致）
- [x] 同步后安装态 `mp-plan-approve/` 与 `mp-plan-sync/` 各含 `scripts/plan-lint.sh`，脚本尾部自检通过
- [x] novel 侧按 skill 文本实跑安装态脚本成功：`bash ~/.zcode/skills/mp-plan-approve/scripts/plan-lint.sh .plan` → 11 项发现，与对拍基准一致；plan-sync 侧同验 11 条——**当初 novel 会话报「脚本不存在」的同一条链路已通**
- [x] `~/.dsh/skills` 旧目的地（空目录）已 `rmdir` 删除

## 落地注

- 2026-09-23 实施并安装。覆盖前预检：安装态两份 SKILL.md 与源仓 diff 仅有本票链新增的第 1 步改写，无安装态独有内容被覆盖。
- **回填机制核实**：`.agent-presets/full/` 内 mtime（09-17~09-20）与 2026-09-20「手动拷贝」事件记忆互证——DSH 不回填 agent-presets，本脚本是唯一机制化同步路径。另有 `coding-lite` / `team` 两个 preset 未同步（软链只建在 full 上，维持既有范围）。
- **副作用披露**：optional 分支首次对活目的地执行，按其「缺则装」设计补入了 8 个此前不在安装态的 optional skill（codebasedesign / grillwithdocs / handoff / improvecodebasearchitecture / reviewcode / tospec / totickets / writinggreatskills）。属脚本既有设计行为；未软链者不影响 ZCode 目录，已软链者与现存 ~/.zcode/skills 条目共存。如需精简可后续拍板。
- 新开会话生效提醒：skill 文本改动在会话启动时扫描，novel 侧需新开会话才会看到 plan-approve/plan-sync 新第 1 步文本（脚本本身即时可用）。
