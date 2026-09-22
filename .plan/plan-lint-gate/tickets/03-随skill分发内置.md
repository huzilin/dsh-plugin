---
type: task
blocked_by: [02]
status: open
---

# 03: plan-lint 随 skill 分发内置（1A：skill 自包含）

**What to build:** 口径收口后的 sh 成为唯一实现并随 skill 走：①脚本正本落 `skills/plan-approve/scripts/plan-lint.sh`，`skills/plan-sync/` 侧由安装机制注入同一文件（安装态目录内副本与 SKILL.md 同地位——都是源仓产物，真相在源仓）；②`plan-approve` 与 `plan-sync` 两个 SKILL.md 第 1 步调用文本改为「跑本 skill 目录下的 `scripts/plan-lint.sh`」，不再写 "(in this plugin's package)"；③GuideView 说明页文案改指 skill 内脚本；④`scripts/plan-lint.mjs` 退役，活引用 sweep 清零（历史票/文档按引用与过时管理规则标注留存价值，不删）。

**Blocked by:** 02（先收口径，再分发——不能把假阳性 lint 装进 novel）

**Source spec:** `.plan/plan-lint-gate/待拍板-plan-lint随skill内置分发-20260923.md`（项 1A + 2A，原话「1A 2A」）

## Acceptance

- [ ] `skills/plan-approve/scripts/plan-lint.sh` 存在且与收口后实现逐字节一致；plan-sync 侧注入机制就位
- [ ] 两个 SKILL.md 第 1 步文本改为相对本 skill 目录调用
- [ ] GuideView 文案不再引用 `plan-lint.mjs`；`src/client/PlanView.tsx` 改后 tsdown 构建通过、lib 部署副本一致
- [ ] `scripts/plan-lint.mjs` 删除，代码域活引用 grep 清零
- [ ] 在 dsh-plugin 仓内按「skill 目录路径」实跑 lint 成功（模拟 skill 侧真实调用形态）
