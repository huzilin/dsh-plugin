---
type: task
blocked_by: []
status: done
---

# 01: to-qa-testcases 收窄为「构建测例」

**What to build:** 把 `to-qa-testcases` 从「设计+资产+执行+缺陷」四件事收窄为**只做构建测例**：设计依据盘点 → 用例设计（A/B/P/C/D/U 六组）→ 可执行资产三原则。执行验收、缺陷台账、返工闭环整段迁出（去票 02）。

**Blocked by:** None — can start immediately

**Source spec:** `.plan/待拍板-测试技能族合并为两skill-20260920.md`（closed）第五节 5.1、6A、7.5。

## Acceptance

- [x] **吸收 `test-design-gate` 的设计侧内容**：七源盘点 + 断言三维 + 双通道**定义**（该 skill 注销前先搬运）；其 3 条执行侧准出（呈现通道截图记录、用户验收环境数据巡检、用户渠道缺陷回写）**迁去票 02**，不在本 skill 保留
- [x] **案例库整体搬入**：`test-design-gate/references/case-library.md`（55 行，5 类盲区 B1~B5 + 2 个真实案例）移到本 skill 的 `references/`，保留「新教训只往案例库追加」的维护纪律；全文引用路径同步改
- [x] **Process 收窄**：删除第 4~7 步（双通道执行 / 执行验收记录 / 缺陷台账 / 返工闭环）与「交接契约（defect.md → diagnosing-bugs）」整节 → 迁去票 02；保留第 1~3 步（过门禁 / 用例设计 / 测试资产）+ 第 8 步改为「落盘 + 自检」
- [x] **产物落点改为 `.plan/<effort>/qa/cases.md`**（原为 `docs/{{req-version}}/{{req-name}}/qa/`），并注明「无 effort 的项目按其 docs 惯例」保留弹性
- [x] **骨架 `references/testsuite-skeleton.md` 收窄**：只保留《用例设计》cases.md 骨架与可执行资产三原则；《执行验收记录》test.md 与《缺陷台账》defect.md 两份骨架 → 迁去票 02
- [x] **骨架给缺陷台账补状态头规定**（本轮裁定⑧：**只有缺陷加头**）：四字段 `type`/`date`/`status`/`origin`，`type: qa-defect`；`status` 用 `plan-protocol` 既有五态（不新造词表）；**cases.md 与 test.md 不加头**
- [x] **缺陷条目级「类型」字段**：值域 `rd`/`fe`/`arch`/`docs`（**用既有 role_id，不用 backend/frontend**），取代原 `domain` 列（避免双真相源）
- [x] **缺陷条目级「状态」**：骨架既有六词（新建/已确认/修复中/待复测/已关闭/挂起）**照用但允许附注**（如「已修复（复测 PASS）」），插件取首词匹配
- [x] **自检节同步收窄**：删除已迁出的 blocker（如「defect.md 每条缺陷 E 节最小复现入口齐备」）→ 去票 02
- [x] **表头统一**：清单总览表头定为 `缺陷号 | 标题 | 严重度 | 类型 | assignee | 状态 | 关联用例 | 发现源 | 测试设计缺口`（实测三份老台账表头不一致，需在骨架里定死）
- [x] 全文无残留「四组结构」类旧口径（六组 A/B/P/C/D/U）；术语双域 sweep 完成

## 落地记录

- **源仓落点（2026-09-21 补）**：按用户指令，skill 实装进 `packages/dsh-plan-view/skills/to-qa-testcases/`（cp 自安装态真身，`diff -r` 逐字一致），纳入 git 管理；`skills/README.md` 索引补条目。安装态仍为 ZCode/DSH 两端扫描生效的运行副本，二者内容一致、后续改动须双侧同步。
- **改动文件**（均在安装态真身 `~/.dsh/.agent-presets/full/skills/to-qa-testcases/`，无 git 仓库、不 commit）：
  - `SKILL.md` 全文重写（120 行 → 收窄版）：description 收窄为「写用例/设计用例/建测例资产」触发语；正文只留「设计依据盘点（原 gate 七源盘点全文搬入）→ 断言三维（gate 全文搬入）→ 双通道定义（红线保留，执行归 run-qa）→ 用例设计六组 → 资产三原则 → 落盘+自检」；删除原 Process 4~7 步、「交接契约」整节、依赖表「上一轮 defect.md/回归基线」行、自检 3 条已迁出项（defect E 节 blocker、用户渠道回写 major、未通过项入账 major）；新增边界条款「不执行测例、不出验收结论、不登缺陷（run-qa-testcases 的活）」；造数纪律以指针指向 `run-qa-testcases/references/data-construction.md`（修原断链，正文不复述）。
  - `references/case-library.md` 由 `test-design-gate/references/` 整体迁入（cp 后改头部归属注记 + B1/B2/B5「对应防线」列指向本 skill 新节名，B5 防线注明执行侧归 run-qa-testcases；CASE-001/002 事件正文一字未动，仅「衍生」行加前身口径注）。
  - `references/demo-wbflow.md`：case-library 引用路径改本 skill 相对路径；头部加范围注记（test/defect 骨架归 run-qa-testcases）。
  - `references/testsuite-skeleton.md` 收窄重写：权威范围 = cases.md 骨架（§0 落点改 `.plan/<effort>/qa/cases.md` + 弹性注 + 「本文件不加头」规定；§1~§5 保留；§2 D 组注明 D-3/D-4 用例在此设计、执行侧巡检归 run-qa-testcases）+ 可执行资产三原则（造数纪律指针 + E 节载体指针改指 run-qa-testcases）。**《执行验收记录》《缺陷台账》两份骨架以「迁出缓冲 · 票 02 搬走」标记节暂存于本文件末尾**（口径已按裁定⑧/⑨修毕：真 frontmatter 四字段 + `type: qa-defect` + plan-protocol 五态 + 表头九列定死 + 类型 rd/fe/arch/docs 取代 domain + 状态六词允许附注取首词），保证内容始终在盘，票 02 物理搬入 run-qa-testcases 后删除该节——终态即「只保留 cases + 资产」。
- **验证证据**：frontmatter 经 python+yaml 解析通过（name/description 齐全，description 329 字符）；`rg "test-design-gate|test-protocol|四组|四件事|docs/{{req-version}}|backend|frontend"` 对本 skill 目录仅剩 3 处合法命中（2 处历史引文口径注 + 1 处「不用 backend/frontend」否定句）；dsh-plugin 仓库 sweep（--hidden，排除 .archive/node_modules/.git）命中 9 文件全部属 .plan 本轮工自成记录与历史报告（handoff / 已 closed 方案 / 三张票 / skill-doctor 时点快照 / ponytail 笔记），无活文档需改；`~/.dsh/.agent-presets/full/` 全域 sweep 仅三个涉事 skill 自身命中，配置域（preset 配置）0 处——与方案 8.1 预告一致。
- **仍开口**：①迁出缓冲节待票 02 搬迁后删除（串行下一票即做）；②skill 触发效果需新开会话实测（留给用户）。
