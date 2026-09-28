---
type: task
blocked_by: []
---

# 09: 目录迁移——tracker 类对象从 .plan/ 迁回原版 .scratch/ 布局

## Question

用户裁定（2026-09-28）：「本仓实际用 `.plan/` 这个忽略，我们使用原版的目录，所以对应的目录都要调整。比如 plan-protocol。」

**迁移内容**（原版 local 布局，`issue-tracker-local.md`）：

- tracker 类对象（spec / map / issues 票）→ `.scratch/<feature-slug>/`（spec.md、map.md、issues/NN-<slug>.md）
- 审批文档 → 留 `.plan/`（原版 grilling 本就落 `.plan/`）
- 受影响 skills：plan-protocol（路径条款）、to-spec、to-tickets、wayfinder（TRACKER-MARKDOWN）、plan-approve/plan-lint（校验对象）、plan-archive（搬移源）、plan-loop/plan-sync（盘点对象）、plan view（PlanView.tsx 加载与 effort 识别）

**先 grill 三项 ☐ 议题再动手**：①to-tickets「自动建 map」补丁去留；②wayfinder assets/ 目录与强化条款（串行/72h/派生）保留范围；③存量数据物理迁移 or 双读过渡。

来源：《梳理-skills全量对照盘点-20260928.md》§二·补3（影响面清单）；原版参照 §11.9 合并目录树。
- 2026-09-28 补充细化裁定六条（调研复盘目录/词汇表状态标记/ADR 必填与原地标废/测例编号+按例重跑/test 多轮同文件/DEF-<effort>-NN 全局唯一 + .tmp 收纳 + 目录对齐总则）——见《梳理-文件类型与获取总表》§三·补，迁移方案 grill 以此为基准。
- 2026-09-28 triage 补充：plan-archive 机制明确化 + 新裁定下冲突 G1（审批档归档处置）/G2（全局 qa/ledger 归档时机）并入本票 grill 清单（现三议题 → 五议题）；G3 归档源路径随施工改写；G4 归档前置四判据 / G5 检索面条款入协议草案。详见《梳理-文件类型与获取总表》§归档机制明确化。
- 2026-09-28 晚改判批注：审批档生命周期口径已改判（Q1/Q2 拍板：closed →（影响域清单登记 → 各域依次处理回填 → 全部落地）→ 翻 `archived: <归宿>`；知识层 ADR/CONTEXT.md 免标、domain 内部自理与 plan-archive 无关）——**G1 议题按新机制复核**；G4 前置判据增「审批档清单全勾或已标」。裁定正本 = [`../../待拍板-审批档吸纳归档统一标记-20260928.md`](../../待拍板-审批档吸纳归档统一标记-20260928.md)。
