---
type: task
blocked_by: [02]
status: done
---

# 03: plan-lint 随 skill 分发内置（1A：skill 自包含）

**What to build:** 口径收口后的 sh 成为唯一实现并随 skill 走：①脚本正本落 `skills/plan-approve/scripts/plan-lint.sh`，`skills/plan-sync/` 侧由安装机制注入同一文件（安装态目录内副本与 SKILL.md 同地位——都是源仓产物，真相在源仓）；②`plan-approve` 与 `plan-sync` 两个 SKILL.md 第 1 步调用文本改为「跑本 skill 目录下的 `scripts/plan-lint.sh`」，不再写 "(in this plugin's package)"；③GuideView 说明页文案改指 skill 内脚本；④`scripts/plan-lint.mjs` 退役，活引用 sweep 清零（历史票/文档按引用与过时管理规则标注留存价值，不删）。

**Blocked by:** 02（先收口径，再分发——不能把假阳性 lint 装进 novel）

**Source spec:** `.plan/plan-lint-gate/待拍板-plan-lint随skill内置分发-20260923.md`（项 1A + 2A，原话「1A 2A」）

## Acceptance

- [x] `skills/plan-approve/scripts/plan-lint.sh` 存在且与收口后实现逐字节一致（git 识别为 rename，历史可溯）；plan-sync 侧注入机制就位（install-skills.sh 注入块，随票 04 目的地修正后生效）
- [x] 两个 SKILL.md 第 1 步文本改为相对本 skill 目录调用，并写明「脚本缺失 = 安装态损坏，报漂移、不得静默降级手工检查」
- [x] GuideView 文案不再引用 `plan-lint.mjs`；src 改后 tsdown 构建通过、lib 三产物同步（新文案 grep 命中、mjs 引用 0）
- [x] `scripts/plan-lint.mjs` 与插件级 `scripts/plan-lint.sh` 双双退役，代码域活引用 sweep 清零（sh 头部保留「口径与 mjs 对拍一致」历史注记）
- [x] 在 dsh-plugin 仓内按「skill 目录路径」实跑 lint 成功（29 个 markdown，绿）

## 落地注

- 2026-09-23 实施。构建工具链备注：包内 node_modules 只有运行时依赖，tsdown 用 harness 仓二进制（`/Users/huzilin/workdir/deepseek-harness/node_modules/.bin/tsdown`，cwd 在本包）跑通；`pnpm run build:client` 会被 workspace 里 deepseek-harness 既有断链的依赖预检卡住（环境旧账，与本票无关）。
- 在途收账：src/lib 的「effort 徽章全部验收变绿」改动（09-22 前会话遗留）已在本票开工前单独提交（54628d8），未混入本票。
