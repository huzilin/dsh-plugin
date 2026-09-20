---
type: map
date: 2026-09-20
status: active
origin: proactive
---

# QA 技能族合并与缺陷台账接入 plan · 路线图

## Destination

测试技能族由四个收成两个（`to-qa-testcases` 管构建测例、`run-qa-testcases` 管执行与缺陷），产物按实施图（impl map）组织到 `.plan/<effort>/qa/`；缺陷台账以 `type: qa-defect` 被 plan 识别，plan 视图新增「🐞 缺陷」tab（按图过滤）。两个 skill 各司其职、无内容重叠，缺陷从登记到关闭在 plan 里可见可追。

**Source spec**：`.plan/待拍板-测试技能族合并为两skill-20260920.md`（status: closed，十一项裁定全定）。

## Notes

- 工单形态：实施工单（`type: task`，frontmatter 存 `status`），非 wayfinder 推演地图。
- 本 effort 两路可并行：**skill 侧**（票 01/02）与**插件侧**（票 03）互不阻塞。
- 关键裁定（详见源 spec 第七节）：
  - 命名：`to-qa-testcases`（保留）+ `run-qa-testcases`（新建）；`test-design-gate`/`test-protocol` 注销。
  - 缺陷分类：条目级「类型」字段，值域 `rd`/`fe`/`arch`/`docs`（用既有 role_id，**不用** backend/frontend）。
  - 只有 `qa/defect.md` 加状态头；cases/test 不加头且不被 plan 识别（qa 目录白名单）。
  - `plan-lint` 不管 qa 目录（保持跳过）。

## Decisions so far

<!-- 每个 resolved 工单一行：一括要义 + 链接 -->

- **票 01 done（2026-09-20）**：`to-qa-testcases` 收窄为「构建测例」——gate 设计侧全文吸收、案例库迁入、执行段+交接契约+两份执行骨架迁出、落点改 `.plan/<effort>/qa/cases.md`、cases/test 明确不加头。见 [tickets/01](tickets/01-to-qa-testcases-narrow.md)。
- **票 02 done（2026-09-20）**：新建 `run-qa-testcases`（执行+缺陷管理，单图/full 两调用）——吸收三方迁出内容、修 test-protocol 断链（协议路由表显式引用 5 正本）、test-design-gate/test-protocol 备份至 `skills-removed-20260920-234005/` 后注销、plan-protocol 两处登记 `qa-defect`、dsh-flow 4 处引用加口径注。留用户开口：新开会话验证 skill 列表。见 [tickets/02](tickets/02-run-qa-testcases-new.md)。
- **票 03 done（2026-09-20）**：plan 视图新增「🐞 缺陷」tab——`TicketKind` 加 defect、qa 组白名单落 `loadPlan` 数据组装层（collectTicketFiles 不读内容，落点偏差已在票面备案）、DefectView 照 LedgerView、tab 细到 map（复用 effortIdx/selectedDir）、构建部署 md5 双侧一致、页面预期验收通过（P-1/P-2/反向断言，临时验收数据已删）。见 [tickets/03](tickets/03-plan-view-defect-tab.md)。
- **源仓实装（2026-09-21，用户指令）**：`to-qa-testcases` 与 `run-qa-testcases` 拷入 `packages/dsh-plan-view/skills/`（与安装态 `diff -r` 逐字一致），`skills/README.md` 索引补条目——两个 skill 自此有 git 版本兜底；安装态为运行副本，后续改动双侧同步。
