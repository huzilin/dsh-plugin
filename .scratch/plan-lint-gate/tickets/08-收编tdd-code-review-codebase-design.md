---
type: task
---

# 08: 收编 tdd / code-review / codebase-design 进源仓

**Status:** resolved
**Blocked by:** None — can start immediately

## Question

implement（调 `/tdd`、收尾 `/code-review`）与 improve-codebase-architecture（依赖 codebase-design 词汇）所依赖的三个 mp 原版 skills **未收编进源仓**——新环境经 install-skills.sh 装插件即缺件（断链 L5，2026-09-28 triage）。

**收编动作**：①从原版（mattpocock/skills：engineering/tdd、engineering/code-review、engineering/codebase-design）拷入源仓 `skills/` 目录；②install-skills.sh 纳入分发；③与安装态现有副本（mp-tdd / mp-code-review / codebasedesign）diff 核差异，保留既有定制；④判定与上游升级的同步策略（按「skills 源同步与引入判定」偏好）。

来源：《梳理-skills全量对照盘点-20260928.md》§解法分析（L5，断链检查首次 2026-09-28）。

## Acceptance

- [x] 三 skill 源仓正本落位：`skills/tdd/`（上游全套：SKILL.md＋agents/＋mocking.md＋tests.md）、`skills/code-review/`（SKILL.md＋agents/）、`skills/codebase-design/`（改造版三文件＋上游 agents/）
- [x] diff 核差异完成：tdd / code-review 的 SKILL.md 与上游**逐字节一致**（安装态仅缺 agents/mocking/tests 参考件）；codebase-design 安装态为**改造版**（语言中立化＋环境适配＋去品牌），上游为旧底本——按「本仓改造必须保留」偏好保留改造版、只补上游新 agents/
- [x] install-skills.sh 主循环 case 加三条 id 映射（tdd→mp-tdd、code-review→mp-code-review、codebase-design→mp-codebase-design），覆盖旧副本、软链与用户视图 id 不变
- [x] 顺带修复 validate_skill 误报：带引号 description 中的「: 」不再判违规（引号包裹是合法 YAML，此前校验器剥冒号不识别引号，实测拦下上游 code-review 正本）
- [x] install-skills.sh 实跑通过；三 skill 源仓↔安装态 `diff -r` 全等；plan-lint.sh 注入版与正本 `cmp` 一致（票 07 的 [5] 校验随之进安装态）

## 落地注

- 2026-09-29 实施。上游基准 = mattpocock/skills 浅克隆（2026-09-29 HEAD，/tmp/mp-skills-upstream）。
- **同步策略判定**（第④项）：tdd / code-review 无本地改造——上游升级直接整目录重拷；**codebase-design 有改造**（em-dash→标点收敛、Stripe/Twilio/PGLite→通用描述、硬性子代理→「支持则并行否则本会话串行」、TypeScript 示例→语言无关伪代码、methods→entry points）——后续升级须 diff merge，方向题按偏好交用户确认改造意图。
- 安装态 mp-tdd 此前缺 mocking.md/tests.md/agents（当期上游尚无或拷贝不全），本次随收编补全。
