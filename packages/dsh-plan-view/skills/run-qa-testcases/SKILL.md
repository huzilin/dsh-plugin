---
name: run-qa-testcases
description: >-
  跑测例并出缺陷报告：双通道执行（协议通道 + 呈现通道）→ 执行验收记录 → 缺陷台账 → 返工闭环 →
  更新回归基线。支持单实施图与 full 全量回归两种调用。Use whenever asked to 跑用例/跑测试/执行测例/
  测试执行/跑回归/回归测试/复测/执行验收/出验收报告/帮我测一下/只测一个接口, or to test a
  feature/API/flow/page or do QA acceptance; also 缺陷登记/记缺陷/建缺陷台账/缺陷复盘.
  造数禁令/验收五维 DoD/验收清单/真模型 E2E/sqlite 替身语义的正本全在本 skill references/。
  写用例/设计用例/用例设计/建测例资产 用 to-qa-testcases；失败根因定位用 diagnosing-bugs。
disable-model-invocation: false
---

# run-qa-testcases（跑测例 + 缺陷管理）

输入 = `to-qa-testcases` 产出的 `.plan/<effort>/qa/cases.md` 与仓库 `qa/` 可执行资产（env_up/env_down、驱动脚本、诊断最小环）。本 skill 跑测例 → 出验收记录 → 出缺陷台账 → 返工闭环 → 更新回归基线。产物落 `.plan/<effort>/qa/test.md` + 一缺陷一文件的 `.plan/<effort>/qa/DEF-NN-<slug>.md`（2026-09-21 拍板，原单文件 defect.md 形态废弃）+ `qa/screenshots/`（可执行脚本留仓库 `qa/`）。 无图归属的缺陷（SOP 回测 / 整页回测发现）落根层 `.plan/qa/DEF-*.md`，进 plan 第一层「测例&缺陷」tab。

> **分工**：写用例/设计用例/建资产归 `to-qa-testcases`（它的 cases.md 章节名是本 skill 的取料口径，不自造小标题）；失败用例根因定位归 `diagnosing-bugs`（E 节契约交接）；业务意图最终确认归用户。
> **标准权威说明**：test.md / defect.md 章节骨架、缺陷文档状态头、总览表头、条目字段的**权威版本**在 `references/qa-records-skeleton.md`。老项目若有同名模板（qa-acceptance-template 等），以本骨架为准。

## 测试场景协议层（正本在本 skill references/，按任务特征必读）

| 场景特征 | 必读 | 一句话红线 |
|---|---|---|
| 要向库/环境写入状态供人查看或验收——**无论任务自称开发/数据准备/QA/修数**（触发看动作不看自称）；建 seed / 造测试数据 | [data-construction.md](references/data-construction.md) | 真实接口链路构造，禁 SQL 直插业务表；造不到 = SKIP，宁缺毋假 |
| 交付验收 / 写人工验收清单 / 判断「验收是否完成」 | [acceptance-dod.md](references/acceptance-dod.md) + [acceptance-checklist.md](references/acceptance-checklist.md) | 五维 DoD 缺一不可（功能/视觉/交互语义/真相源一致/边界）；清单零 id 定位 + 功能视觉双断言 |
| 接入/更换 LLM 网关、真模型 E2E、上游 5xx 排查 | [real-model-e2e.md](references/real-model-e2e.md) | 替身测管道契约，真模型测格式文明+连接生命周期；随发版例行不能一次定终身 |
| sqlite 替身集成测试 / GORM 迁移 / 「替身绿真库挂」 | [sqlite-mysql-substitute.md](references/sqlite-mysql-substitute.md) | 索引名/default 吞零值/AutoMigrate≠DDL/并发语义必须真机 |

> 事故锚点：2026-09-12 SQL 直插致验收假阳性（data-construction.md 复盘）；同日「接口通路但页面崩了」致验收五维 DoD 立项（acceptance-dod.md 头注）。

## Process

1. **取测例与资产**：读该图 `cases.md` §2/§3 取本轮要跑的用例编号；`env_up` 重建 scratch 环境；确认驱动脚本可按用例编号过滤单跑。测例集缺失或不可执行 → 退回 `to-qa-testcases`，不在本 skill 现造用例。

2. **双通道执行**：
   - **协议通道**：驱动脚本跑 A/B/C/D/U 组 + 库态对账；软失败收全，一轮收齐全部失败；
   - **呈现通道**：优先跑 Playwright 固化套件（`qa/run-e2e.sh`，形态正本见 `to-qa-testcases/references/playwright-assets.md`），P 组逐元素位执行，**截图逐条落 `qa/screenshots/`**（含整页首屏，文案类截图须能看清文字）；无视觉模型时按正本降级口径——DOM 探针断言 + 视觉维记「未覆盖 + 附注（留证待审）」，有视觉则 agent 抽看关键截图补视觉判断；固化资产未覆盖或需原型 diff 时用浏览器交互走查，对照原型逐条 diff；
   - **红线：纯协议通道不得对 UI 出「通过」；Playwright 真浏览器走查属呈现通道，不得以协议通道代出通过**；
   - **用户验收环境数据巡检**（出结论前强制）：对用户实际浏览的库跑同一套期望矩阵（cases.md D-3 用例）；隔离环境全绿不替代，用户点开即坏的数据，测试全绿也没有意义；
   - 多轮执行以末轮为准；驱动侧误报修正过程写进 test.md §2「过程有效性」，与产品缺陷区分。

3. **执行验收记录（test.md）**：结论先行（通过 / 有条件通过 / 不通过 + 一句话理由 + 遗留 P0/P1 数）；§3 呈现通道记录按 P 组两表分列落三态（不与协议结论混排）；§4 AC 逐条三态（通过 / 不通过 / 未覆盖，无缺项）；§5 回归指引（3~5 步操作卡 + 基线值）。

4. **缺陷条目（一缺陷一文件，`DEF-NN-<slug>.md`）**：每条缺陷独立一个文件，按骨架补**真 frontmatter 状态头**（`type: qa-defect` + 四字段，围栏/引用块=插件读不到），正文 `# DEF-NN 标题` + 字段行（严重度/类型/Assignee/状态/关联用例/发现源/测试设计缺口），A~E 五节登记，**E 节「最小复现入口」必填**（一条命令 + 环境变量 + 预期红信号，见「交接契约」；fe 缺陷的命令 = `npx playwright test -g <用例编号>`，协议通道缺陷仍走原驱动脚本）；登记**发现源**（QA 轮 / 用户）与**测试设计缺口**——用户渠道缺陷必填缺哪个源/维度/通道，缺口**当轮**补进 cases.md 并按案例库格式追加 `to-qa-testcases/references/case-library.md`；详情文本写「票 NN」「挂账-NN」即可被串联视图挂链。

5. **返工闭环**：缺陷按**类型**（`rd` / `fe` / `arch` / `docs`，既有 role_id）派发 → 修复动作交 `diagnosing-bugs`（按 E 节契约，修复后只回写 C 节）→ **用第 1 步资产复测**（不手工重验）——复测 = 同一条命令（单缺陷 `npx playwright test -g <用例编号>`，整轮跑 `qa/run-e2e.sh`）；复测识别**不新增机制**：自然语言触发语 + 条目状态「待复测」+ 多轮以末轮为准 → 复测 PASS 登记关闭人/日期（状态附注如「已关闭（复测 PASS）」）→ 更新回归基线；wbflow 环境下对应 `wb_comment(domain)` 路由 → resolve → confirm/reopen。
6. **票面测试标记回写（2026-09-21 拍板）**：本轮测例全部执行完 → 给被测票 frontmatter 写 `qa_tested: true`；验收通过（AC 全过 + 该票无未关闭缺陷）→ 写 `qa_accepted: true`。三标记与 `qa_cases`（to-qa-testcases 写）一起在票卡/详情徽标展示。

7. **落盘 + 自检**：test.md / defect.md / screenshots/ 落 `.plan/<effort>/qa/` → 按本 skill「自检」逐条过 → 登记产物（wbflow：`wb_add_artifact`，nodeId=当前节点）→ 台账全部关闭时把 frontmatter `status` 翻 `closed`（仍有未关闭保持 `active`）→ 提评/推进。

## 两种调用（自然语言触发语，非 CLI 参数）

| 调用 | 作用域 | 行为 |
|---|---|---|
| **单图**：「跑 <effort> 的测例 / 复测 <effort>」 | 指定实施图 | 只跑该图测例，test.md / defect.md 写回该图 `qa/` |
| **full**：「跑全量回归」 | 全部实施图 | 扫 `.plan/*/map.md` 筛**实施图**（票型 `task`/`impl`；推演图 `research`/`prototype`/`grilling` 跳过）逐图按单图流程跑；出**总账** + **分账** |

- **full 总账**：跨图 PASS/FAIL/SKIP 汇总 + 回归判定（对照各图基线，FAIL>0 即回归），落 `.plan/qa/full-regression-<YYYYMMDD>.md`（plan 根层，无 `map.md` 不成 effort、不进视图）；
- **full 分账**：各图结果写回各自 `qa/test.md`，新缺陷各建 `qa/DEF-NN-<slug>.md`；
- **默认含 `status: closed` 的图**（代码仍在生产，全量回归就是查回退）；用户说「只跑 active / 只跑进行中」时跳过 closed 图（`active-only` 开关）。

## 交接契约（defect.md → diagnosing-bugs）

`diagnosing-bugs` Phase 1 的完成判据是「一条**已跑过一次**、red-capable、确定性、秒级、agent 可无人值守运行的命令」。本 skill 的缺陷条目在登记时就把它交齐，诊断方零重建：

| diagnosing-bugs 需要 | defect.md 提供（必填字段） |
|---|---|
| 用户的确切症状 | B 节「实际结果」原样报文/截图（非转述） |
| 驱动到 bug 代码路径的一条命令 | E 节「最小复现入口」：`cmd`（脚本路径 + 用例编号过滤）+ 环境变量清单 + 前置（env_up）|
| 该命令已跑过且为红 | E 节「末次运行输出」（redacted） |
| 确定性 / 复现率 | E 节「复现率」（确定性写 100%；竞速类写循环次数与命中率） |
| 环境与版本 | A 节「环境信息」：库/服务/commit |
| 修复后的回归位 | C 节「复测口径」= 同一条命令翻绿 + 回归基线数 |

约定：诊断方修复后**只回写** C 节（复测结果 / 关闭人 / 日期），不改 A/B/E；台账与回归基线的更新归本 skill 第 5 步。

## 自检（出结论前逐条过，任一 blocker 不过不许出结论）

- [ ] （blocker）执行用例全部来自 cases.md，无现场自造用例；测例集缺口已退回 to-qa-testcases 或显式降险
- [ ] （blocker）prd 全部 AC 在 test.md §4 逐条给出三态之一，无缺项；每条结论可追溯到用例编号或直接证据
- [ ] （blocker）有 UI 则 P 组 §3 截图记录齐备且原型逐条 diff 无未解释差距；无 UI 显式声明；纯协议通道未对 UI 出「通过」
- [ ] （blocker）用户验收环境的现有数据已过一次期望矩阵巡检（或验证环境即用户环境）
- [ ] （blocker）每条缺陷文件（`DEF-NN-*.md`）E 节「最小复现入口」齐备且末次运行为红
- [ ] （major）被测票 frontmatter 已回写 `qa_tested` / `qa_accepted`（验收通过时）
- [ ] （blocker）defect.md 头为真 frontmatter（`---` 包裹、`type: qa-defect`）；总览表头九列与骨架逐字一致；条目状态用六词 + 附注（首词可被插件匹配）
- [ ] （major）用户渠道缺陷均有「测试设计缺口」回写并已补进 cases.md
- [ ] （major）未通过项均在 defect.md 有条目，无悬空失败；SKIP 均附因
- [ ] （major）多轮执行的驱动侧修正已与产品缺陷区分（test.md §2 过程有效性）

## 边界 / Out of scope

- 不写用例、不改用例设计（用户渠道缺口回写补进 cases.md 是登记纪律，不是重新设计）；测例集构建归 `to-qa-testcases`。
- 不定位根因、不修 bug（`diagnosing-bugs`）；本 skill 只保证缺陷条目让诊断零重建。
- 不替代用户验收：用户验收节点保留，本 skill 目标是把「呈现/语义类」问题在用户验收前消化掉。
- `plan-lint` 暂不校验 `qa/` 目录（2026-09-20 裁定⑩）——头写错 lint 不报，靠本自检与人工复核兜。
