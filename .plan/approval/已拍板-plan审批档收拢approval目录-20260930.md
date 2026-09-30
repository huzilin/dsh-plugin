---
type: approval
date: 2026-09-30
status: closed
origin: proactive
---

# 已拍板：全局审批档收拢 `.plan/approval/`（2026-09-30）

> **状态头**：`status: closed`——本拍板为当场执行型（拍板即落地完毕），按「审批档与ADR生命周期」直接落 `已拍板-*` 形态，不经 pending 过渡。

## 一、原话（照抄）

> 收拢一下， .plan/approval 放全局的拍板

（承接同日上下文：用户问「plan-view 全局的待拍板是在哪个目录」，助手答复现行归属 = `.plan/` 根层「根层审批档」后，用户拍板收拢。）

## 二、拍板内容

全局性审批档（全局件审批成员）的正本落点由 **`.plan/` 根层散放**（`待拍板-*`/`已拍板-*` 前缀形状，2026-09-29 全局件拍板的口径）改为 **`.plan/approval/` 独立子目录**——与 effort 内 `.scratch/<effort>/approval/` 同形对称。根层前缀形状降为**存量兼容**（视图仍收、不再新写，plan-lint 检查[9] 对根层报违例驱动迁移）。全局件封闭清单仍为三件，仅审批成员目录化：

1. `.plan/approval/待拍板-*` / `已拍板-*`（本次改动）
2. `.plan/qa/`（不变）
3. `.plan/ledger/`（不变）

## 三、落地清单（全部当场完成）

| 类型 | 落点 | 内容 |
|---|---|---|
| 数据迁移 | `.plan/approval/`（31 档 `git mv`） | 根层 26×`待拍板-` + 2×`已拍板-` + `汇报规范hook插件-待拍板.md`（type: approval 实体）+ untracked `已拍板-推演产物三视图与推演票tab退役-20260930.md`（并行会话新落） |
| 代码 | `packages/dsh-plan-view/lib/server.js` | 全局子目录收集加 `approval`；`PLAN_ROOT_ALLOW` 注释改存量兼容；头注释更新 |
| 代码 | `packages/dsh-plan-view/skills/plan-approve/scripts/plan-lint.sh` | 检查[6] 白名单加 `approval`；检查[2] 豁免 `$PD/approval/`（防迁移后误报 missing-map）；检查[9] 严格化（根层 `.md` 一律报、提示落 `approval/`）；头注释四处 |
| 代码 | `packages/dsh-plan-view/src/client/PlanView.tsx` + 重建 `lib/client.js` | 头注释、mapApprovals 注释、GuideView 目录树文案 |
| 测试 | `packages/dsh-plan-view/test/snapshot.test.js` | fixture 审批档移入 `approval/`；钉住「approval/ 正本收 + 根层存量兼容收 + 复盘- 不收」三态；node --test 13 绿 |
| 协议正本 | `packages/dsh-plan-view/skills/plan-protocol/SKILL.md` | §三目录布局总则 /「全局件」条 / 判据归属 / 检查[9] /「审批文档归属」/ §四·补表格 / init 共七处 |
| 派生文档 | `docs/research/梳理-plan目录写入矩阵-20260930.md`（头部修订注记 + 六处）、`docs/requirements/global-items-全局件治理.md`、`docs/architecture.md`、`skills/README.md`、`skills/plan-loop/SKILL.md`、`skills/to-approval/SKILL.md` | 全局件口径 sweep |
| 指针修复 | 3×`superseded-by:` + 2×「真相源/完整方案见」handoff 指针 + architecture 决策来源 | 目标存在于 `.plan/approval/` 才改写（脚本断言保证；novel 仓路径引用一律不动） |

## 四、验证

- `node --test test/`：13 绿。
- standalone 重建 client（`tsdown -c tsdown.standalone.ts`）：成功。
- `plan-lint .plan`：检查[2][6] 全绿；检查[9] 8 项发现 = 全部为**本次范围外**的根层散文件（`梳理-*`/`复盘-*`/`参考-*`/需求/handoffs 蓝图/ponytail/skill-doctor，写入矩阵 §五 早已定义为违例待分流）——基线 9 项 → 8 项，零新增。
- `plan-lint .scratch`：51 markdown 零漂移。
- 全活动面近形错字终验（审批档/approval 拼写变体扫描）：无错字；残留 `.plan/待拍板-` 引用均为 novel 仓路径、通配形状描述或测试 fixture（合法保留）。

## 五、范围外遗留（如实记录）

`.plan/` 根层仍有 8 个范围外散文件（上述检查[9] 所列）——它们是写入矩阵 §五 定义的违例待分流项（`梳理-*` → `docs/research/` 等），属另一轮施工，不随本拍板顺带处置。
