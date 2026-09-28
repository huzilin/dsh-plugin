---
type: task
blocked_by: [01]
status: done
---

# 02: 新建 run-qa-testcases（执行 + 缺陷管理）

**What to build:** 新建 `run-qa-testcases` skill：跑测例 → 出验收记录 → 出缺陷台账 → 返工闭环 → 更新回归基线。支持**指定单个实施图**与 **full 全量回归**两种调用。产物落 `.plan/<effort>/qa/`。

**Blocked by:** 票 01（骨架拆分需先完成，本票接收迁出的两份骨架与执行侧准出）

**Source spec:** `.plan/待拍板-测试技能族合并为两skill-20260920.md`（closed）第五节 5.2/5.3/5.4、6A、6B。

## Acceptance

- [x] **建 skill 目录** `~/.dsh/.agent-presets/full/skills/run-qa-testcases/`（SKILL.md + references/），并在 `~/.zcode/skills/` 建同名软链（沿用既有双端共用惯例）
- [x] **吸收 `to-qa-testcases` 迁出段**：Process 第 4~7 步（双通道执行 / 执行验收记录 / 缺陷台账 / 返工闭环）+「交接契约（defect.md → diagnosing-bugs）」整节 + 《执行验收记录》《缺陷台账》两份骨架
- [x] **吸收 `test-design-gate` 迁出的 3 条执行侧准出**：呈现通道截图记录、用户验收环境数据巡检、用户渠道缺陷回写
- [x] **吸收 `test-protocol` 全部 5 个参考文件**（造数禁令 / 验收五维 DoD / 验收清单 / 真模型 E2E / sqlite 替身语义），并**补上原断链**：本 skill 必须显式引用它们（原 `to-qa-testcases` 全文 0 处提到 test-protocol，而它第 3 步就要造数——这是本次合并要修的真断链）
- [x] **产物落点**：`.plan/<effort>/qa/test.md` + `.plan/<effort>/qa/defect.md` + `screenshots/`
- [x] **缺陷台账头部**（本轮裁定⑧）：`type: qa-defect` + 四字段 `type`/`date`/`status`/`origin`（**必须是真 frontmatter，`---` 包裹**；实测现有产物写成 ```yaml 围栏或引用块，插件读不到）
- [x] **两种调用**（自然语言触发语，非真 CLI 参数）：
  - 单图：只跑指定实施图的测例，产出写回该图 `qa/`
  - `full`：扫 `.plan/*/map.md` 筛实施图（推演图跳过）逐个跑，出**总账**（跨图 PASS/FAIL/SKIP + 回归判定）+ **分账**（写回各图 `test.md`）；默认**含 closed 图**（代码仍在生产，全量回归就是查回退），给 `active-only` 开关
- [x] **缺陷条目「类型」字段**：值域 `rd`/`fe`/`arch`/`docs`（既有 role_id）
- [x] **缺陷条目「状态」**：骨架六词 + 允许附注，插件取首词匹配
- [x] **清单总览表头**与票 01 定死的一致（`缺陷号 | 标题 | 严重度 | 类型 | assignee | 状态 | 关联用例 | 发现源 | 测试设计缺口`）
- [x] **skill 描述词不与票 01 抢触发**：本 skill 管「跑/执行/验收/回归/复测/缺陷登记」，票 01 管「写用例/设计用例/建资产」——两 description 的触发词需逐词对照无重叠
- [x] **注销两个旧 skill**：`test-design-gate`、`test-protocol`（含 `~/.zcode/skills/` 侧软链）；**改前先按既有惯例备份**到 `skills-removed-<日期>/`（实测这三个 skill 不在任何 git 仓库，无版本管理兜底）
- [x] **sweep 引用**：`dsh-flow/qa/qa_doc_audit.py:3`、`qa_live_audit.py:3`（注释）；`dsh-flow/docs/v1.0/qa/qa-defects.md`(3 处)、`qa-execution-report.md`(1 处)
- [x] **`plan-protocol` 第三节 `type` 取值约定补 `qa-defect`**（术语登记纪律：新术语随拍板当场登记）
- [ ] **新开会话验证**：skill 在会话启动时扫描，改完需新开会话才在技能列表生效

## 落地记录

- **源仓落点（2026-09-21 补）**：按用户指令，skill 实装进 `packages/dsh-plan-view/skills/run-qa-testcases/`（cp 自安装态真身，`diff -r` 逐字一致），纳入 git 管理；`skills/README.md` 索引补两 skill 条目（与票 01 一并）。安装态仍为两端扫描生效的运行副本，内容一致、后续改动须双侧同步。
- **改动文件**：
  - 新建 `~/.dsh/.agent-presets/full/skills/run-qa-testcases/SKILL.md`：定位（消费 to-qa 的 cases.md + 资产）→ 协议层场景路由表（4 行，显式引用本 skill references/ 5 正本——**断链在此修掉**）→ Process 6 步（取测例与资产 / 双通道执行含呈现通道截图与用户验收环境巡检 / 验收记录 / 缺陷台账 / 返工闭环 / 落盘+自检）→ 两种调用表（单图 / full：扫 `.plan/*/map.md` 筛实施图、默认含 closed、`active-only` 开关、总账+分账）→ 交接契约表（diagnosing-bugs Phase 1，E 节六字段，修复只回写 C 节）→ 自检 9 条（blocker 含「defect.md 头为真 frontmatter + 表头九列逐字一致」）→ 边界。吸收 gate 3 条执行侧准出于 Process 2/4 与自检 blocker。
  - 新建 `references/qa-records-skeleton.md`：test.md §0~§7 + defect.md 骨架正本（真 frontmatter 四字段头 + `type: qa-defect` + plan-protocol 五态 + 「cases/test 不加头」+ 表头九列定死 + 类型 rd/fe/arch/docs 取代 domain + 状态六词允许附注取首词 + A~E 五节 + 发现源统计）。与票 01 骨架逐字同口径（同一正文两处落，01 侧已删迁出缓冲节，本文件为唯一正本）。
  - `references/{data-construction,acceptance-dod,acceptance-checklist,real-model-e2e,sqlite-mysql-substitute}.md`：自 test-protocol 整体 cp（5 文件 6.4KB，正文零改动——文件内无跨 skill 引用需改）。
  - `~/.zcode/skills/run-qa-testcases` 软链新建（指向安装态真身）。
  - `to-qa-testcases/references/testsuite-skeleton.md`：删除「迁出缓冲」节（票 01 预留），终态 = cases.md 骨架 + 资产三原则；SKILL.md 造数指针指向本 skill `references/data-construction.md`（断链另一端闭合）。
  - `packages/dsh-plan-view/skills/plan-protocol/SKILL.md`（源仓，未 commit）与 `~/.dsh/.agent-presets/full/skills/mp-plan-protocol/SKILL.md`（安装态）`type` 取值约定**两处同步**补 `qa-defect`（QA 缺陷台账，`.plan/<effort>/qa/defect.md`，qa 目录内其余文件不加 type、不被视图识别）。
  - dsh-flow（只改不 commit）：`docs/v1.0/qa/qa-defects.md` 3 处、`qa-execution-report.md` 1 处加「口径注（2026-09-20）」引用块（原文未动）。
- **触发词对照结论**：专有触发词逐词零重叠——to-qa 管「写测试用例/写用例/设计用例/用例设计/补用例/建测例资产/build test cases/test-suite assets」（全「写/设计/建」系）；run-qa 管「跑用例/跑测试/执行测例/测试执行/跑回归/回归测试/复测/执行验收/出验收报告/帮我测一下/只测一个接口/test a feature or do QA acceptance/缺陷登记/记缺陷/建缺陷台账/缺陷复盘」（全「跑/执行/验收/缺陷」系）。两侧 description 各含对方词汇**仅出现于显式让渡短语**（「跑用例/执行/验收/回归/复测/缺陷登记 用 run-qa-testcases」/「写用例/设计用例/用例设计/建测例资产 用 to-qa-testcases」），属路由不属认领——这是防误触机制本身。特殊裁定：to-qa 原 description 的「验收用例」触发词已删（「验收」整体让给 run-qa，「写验收用例」场景由「写用例」覆盖）。
- **备份证据**：`/Users/huzilin/.dsh/.agent-presets/full/skills-removed-20260920-234005/`（含 test-design-gate/ 与 test-protocol/ 完整目录，注销前 cp -R 并 `diff -r` 校验与原件逐字节一致后才删除；两真身目录 rm -rf，ZCode 侧两软链 `rm` 链接文件本身删除，未触及软链目标）。
- **sweep 结果清单**（前→后）：
  - `qa/qa_doc_audit.py:3`「…to-qa-testcases 骨架 D-4 固化」→ **核对后不改**：D-4 文档-实现一致性仍属用例设计（to-qa 骨架 §2 D 组），注释指向仍准确；
  - `qa/qa_live_audit.py:3`「…to-qa-testcases 骨架 D-3 固化」→ **核对后不改**：D-3 用例设计同上仍在 to-qa（其骨架 L43 实证），执行侧出结论归 run-qa 已在骨架注明；
  - `qa-defects.md:435` 原「已追加 `test-design-gate/references/case-library.md` B5 类型与 CASE-002。」→ 原文不动，下行加口径注（案例库现位于 `to-qa-testcases/references/case-library.md`）；
  - `qa-defects.md:492` 原「…test-design-gate 增防线…to-qa-testcases 骨架 D 组增 D-3…」→ 原文不动，下行加口径注（巡检执行侧现归 run-qa-testcases）；
  - `qa-defects.md:555` 原「…test-design-gate B5 类盲区实证…」→ 原文不动，下行加口径注（B5 类型现居 to-qa-testcases 案例库）；
  - `qa-execution-report.md:71` 原标题「…test-design-gate 双通道红线落地」→ 标题不动，标题下加口径注行（红线现由 to-qa 定义 + run-qa 执行承载）；
  - 范围外命中（不改，属历史时点文档）：`.plan/proposals/`（2 文件）、`.plan/research/agent-flow-test-coverage.md`、`.plan/timeline/zcode-sessions-decisions.md`——推演/调研/时间线记录，非活协议。
- **构建/脚本执行证据**：两份新 SKILL.md frontmatter 经 python+yaml 解析通过（run-qa description 368 字符 / to-qa 329 字符）；备份 diff 校验通过；`install-skills.sh` **未跑**——读后确认它只装 7 个具名 skill 到 `~/.dsh/skills/`（该目录为空、非活动 preset 路径）且**不覆盖 plan-protocol**，跑它既同步不了 plan-protocol 还会往 `~/.dsh/skills/` 侧效复制 7 个 skill；plan-protocol 安装态改用对 `mp-plan-protocol/SKILL.md` 的同款精准编辑完成同步（保留其本地独有的「图二型」行）。**既有偏差备案**：源仓与安装态 plan-protocol 在 L76 存在本票之前已分叉的一行（源仓「非治理目录」vs 安装态「图二型」，均未 commit，疑为并行会话产物）——本票只动 L77 type 行，不裁决该分叉，留用户处理。
- **遗留开口**：①**新开会话验证**（上方未勾项）——skill 列表扫描在会话启动时进行，需用户新开会话确认 run-qa-testcases 出现、test-design-gate/test-protocol 消失；②`--map`/`--full` 为自然语言触发语，非真 CLI 参数（方案已声明，如需进 CI 另立脚本）；③plan-protocol L76 两端分叉待用户裁决；④dsh-flow 改动未 commit（按指令只改不提交）；⑤票 03（插件侧缺陷 tab）未在本票范围。
