---
type: approval
date: 2026-09-21
status: closed
origin: readability-rescue
---

# 待拍板：to-qa-testcases 接入 Playwright 的引入方案

## 背景与原话

用户原话（本轮触发）：「to-qa-testcases，考虑引入playwright， 怎么引入帮我梳理」。

来路（本会话三轮前置讨论，结论均为**助手推断、尚未拍板**）：

1. 「playwright 适合接入我 qa 相关的 skills 么」——助手评估：适合，但只接「固化后的回归腿」，不接探索走查、不替代视觉审美判断。
2. 「如果我使用的 model，不支持图像，可以支持对前端呈现进行测试么」——助手评估：可以，Playwright 断言走 DOM/几何/样式值全程文本；真正需要眼睛的（纯审美、预期外渲染实况）用「截图留证待审」接住，视觉维不出「通过」。
3. 「如果使用回归腿，是不是必须先预先使用探索走查」——助手评估：不是必须，页面结构知识可来自源码（`to-qa-testcases` 依赖表已把页面源码列为 P 组 oracle）或文字探查脚本。

以上三条在**任何拍板文档中均无记载**，属文档空白 + 推断。本轮把「怎么引入」拆成设计树，逐轮拍板；本文档承载第一轮。

## 既有契约（文档已写明，引入不得违背）

以下引自 `packages/dsh-plan-view/skills/to-qa-testcases/`（SKILL.md + references/testsuite-skeleton.md）与 `run-qa-testcases/SKILL.md`，2026-09-20/21 已定稿：

- **资产三原则**：env_up/env_down 一键重建、驱动脚本一键复跑（软失败收全 / 用例编号可过滤单跑 / 结果落 json / 退出码 FAIL>0 非 0）、基线 PASS/FAIL/SKIP 可对比。**可执行脚本资产不进 `.plan/`，留仓库 `qa/`（要进 CI、跟代码走）**。
- **双通道定义与红线**：协议通道（API/DB 黑盒）+ 呈现通道（浏览器真实走查，有 FE 必走）；「纯协议通道不得对 UI 出『通过』」。Playwright 开真浏览器走真用户旅程，**属呈现通道的执行器**，不是协议通道。
- **P 组两表**：P-1 UI 呈现（位置/文案逐字/形态/空态/不撑破布局）、P-2 使用交互（可达/反馈/持久化/失败回滚/降级/起点正确/文案正交）；每元素位 ≥1 条 P-1 + 1 条 P-2，每条设计时即预留截图位，截图落 `qa/screenshots/`。
- **单一真相源纪律**：骨架正本在 testsuite-skeleton.md，SKILL.md 按节引用；用户拍板过「反对同一知识多处复述，一处定义、其余指针」。
- **条目状态词表拍板（2026-09-21）**：现行六词（待修复/已确认/修复中/待复测/已关闭/挂起），不为缺陷另造词表；test.md §3 P 组记录三态 = 通过/不通过/未覆盖。
- **术语 SOP**：新术语/改名词产生那一刻须走双域 sweep；无词汇正本的仓库先建正本再改名（本仓库 dsh-plugin 目前**无 CONTEXT.md / 词汇表**）。

## 设计树总览

```
R. Playwright 在技能族中的定位（根决策）
├─ D1 形态细节的单一真相源落点（等 R）
├─ D2 run-qa-testcases 侧同步改动范围（等 R）
├─ D3 无视觉模型降级口径是否本轮一并定（等 R）
└─ D4 拍板后的票务拆分（等 R + D1~D3）
独立支线（不依赖 R）：
├─ D5 资产形态细节包（spec 位置/编号绑定/驱动入口/截图/登录与环境/语言）
└─ D6 术语定名与词汇正本落点
```

本轮问：R、D5、D6（三者互不依赖）。D1~D4 等 R 落定后第二轮问。

---

## R. Playwright 的定位与分工边界（根决策）

**是什么**：把 Playwright 定为什么、边界划在哪。这决定后面所有改动的范围。

**从哪来**：三轮前置讨论的结论需要固化为正式拍板；你反感触发面重叠（「一句话唤起多个 skill」），已装 browser-use 插件（web-gui-tester = agent 看截图交互式走查）。

**影响什么**：拍 A 则解锁 D1~D4；拍 B 则 D1/D2 内容变化（协议只作弱约束）；拍 C 则本轮全部关闭。

**选项与取舍**：

- **A（推荐）：定位 = 呈现通道可执行资产的标准形态（to-qa-testcases 产出）+ 固化回归执行器（run-qa-testcases 使用）**；探索走查、元素位首轮盘点、原型视觉 diff、审美判断留在 browser-use web-gui-tester 与用户验收节点。Playwright 不新增 skill、不新增触发词，只是测例流程内的执行资产。理由：资产三原则（软失败/json/退出码/grep 单跑）Playwright 原生满足；复测契约（确定性、秒级、无人值守、red-capable 一条命令）正是它的形状；P-1 文案逐字断言 `toHaveText` 精确匹配。代价：spec 随页面改版维护（但「下一轮不重写脚本」纪律本就要求增量维护）。
- **B：只作「可选资产形态」**，各项目自选 Playwright 或手写浏览器驱动。代价：形态漂移，`--grep` 按编号过滤、json reporter 这些契约无法统一假设，run 侧执行协议写不死。
- **C：不引入**。关闭全部后续。

➡️ **推荐 A**。理由汇总在前置三轮讨论中，此处不再重复；唯一新增论据：你当前主力模型（GLM-5.3-Flash）图像能力不确定，Playwright 回归腿恰好是全流程中**唯一不依赖视觉**的呈现测试路径，先接它风险最小。

> **裁决（2026-09-22，plan-approve）**：用户回「A」——按选项 A 拍板。Playwright 定位 = 呈现通道可执行资产的标准形态（to-qa-testcases 产出）+ 固化回归执行器（run-qa-testcases 使用）；探索走查、元素位首轮盘点、原型视觉 diff、审美判断留在 browser-use web-gui-tester 与用户验收节点；不新增 skill、不新增触发词。**D1~D4 解锁，进第二轮。**

---

## D5. 资产形态细节包（前提：R 拍 A 或 B）

**是什么**：Playwright 资产在项目 `qa/` 里长什么样。六个子项可整体拍，也可逐项改。

**从哪来**：既有资产三原则（文档已写明）+ Playwright 惯例（推断）。

**影响什么**：写入 D1 选定的形态正本文档；决定 novel 等项目脚手架票的内容。

**子项与推荐**：

| # | 子项 | 推荐 | 依据 |
|---|---|---|---|
| 5a | spec 文件位置 | 仓库 `qa/e2e/`（如 `qa/e2e/plan-view.spec.ts`） | 「可执行脚本资产不进 `.plan/`，留仓库 qa/」——文档已写明 |
| 5b | 用例编号绑定 | test 标题以编号开头（`test('P-12 提交按钮占位文案', …)`），`npx playwright test --grep P-12` 过滤单跑；不引入 testTag 新机制 | 对齐三原则「用例编号可过滤单跑」；标题 grep 最通用，无学习成本 |
| 5c | 驱动入口 | 薄壳脚本 `qa/run-e2e.sh`：内部调 playwright（json reporter 输出 `qa/results/`）+ 汇总 PASS/FAIL/SKIP；软失败与退出码由 playwright 原生提供 | 保住「驱动脚本一键复跑」语义不变，run 侧协议不用为 playwright 单开口径 |
| 5d | 截图落点 | `qa/screenshots/<用例编号>-<步骤>.png`，test 内代码显式落盘（不依赖 playwright trace viewer） | 对齐 run 侧既有「截图逐条落 qa/screenshots/」拍板 |
| 5e | 登录与环境 | storageState 复用登录态；登录本身走真实接口链路（造数纪律：真实链路构造，禁绕过）；环境由既有 `env_up` 负责，playwright 只连不启（baseURL 指向 env_up 起的服务），不双起服务 | 造数禁令——文档已写明；避免环境双真相源 |
| 5f | spec 语言 | 与项目栈一致（novel = TS）；协议不锁语言 | skill 是跨项目协议，不该假设栈 |

➡️ **推荐：六项全按上表**。若对某项有异议，回复编号即可，如「5c 不要薄壳」。

> **裁决（2026-09-22，plan-approve）**：用户选「六项全按推荐」——5a~5f 全部按推荐表拍定。

---

## D6. 术语定名与词汇正本落点

**是什么**：本轮讨论产生了候选新词；按你的术语 SOP，拍板产生新词那一刻须有词汇正本可挂。本仓库（dsh-plugin）目前无 CONTEXT.md、无词汇表。

**从哪来**：术语 SOP（正本 `viking://user/default/memories/preferences/huzilin/术语变更双域Sweep协议.md`，全局 AGENTS.md 摘录：无正本的仓库先建正本再改名）。

**影响什么**：D1~D3 改协议文本时用词必须与正本一致；后续 sweep 有处可查。

**选项与取舍**：

- **6a 词汇正本落点**：
  - **A（推荐）：建 `dsh-plugin/CONTEXT.md`（glossary 体例，只收词不写实现）**，首批收：协议通道/呈现通道（定义指针指向 to-qa-testcases，不复制正文——单一真相源）、固化回归（=Playwright 执行的回归腿，待 R 拍板后定稿）、探索走查（=browser-use 交互式黑盒走查腿）、DOM 探针（无视觉下用几何值/computedStyle/DOM 状态断言呈现的手法）。理由：grill-with-docs 惯例即 CONTEXT.md；词挂仓库，随 skill 源仓同 commit。
  - B：收进 OpenViking preferences「测试技能族结构与分工」。代价：词表离仓库，代码域 sweep 时不易互验。
  - C：不建正本，协议文本就地定义。代价：违反你「先建正本再改名」的 SOP，下一个新词继续漂。
- **6b 新词最小集**：
  - **推荐只收上列 4 个词**。「留证待审」**不新造状态词**——用既有三态「未覆盖 + 附注（视觉维留证待审）」表达，符合你「不为缺陷另造词表、附注取首词匹配」的既有拍板。
  - 「回归腿/呈现腿」这类口语简称不进正本，正式文本用「固化回归/探索走查/呈现通道」。

➡️ **推荐 6a-A + 6b 最小四词**。

> **裁决（2026-09-22，plan-approve）**：用户拍「A：建 CONTEXT.md + 最小五词」。词汇正本已建 `CONTEXT.md`（仓库根），收五词：协议通道 / 呈现通道 / 固化回归 / 探索走查 / DOM 探针；「留证待审」以「记录口径」词条明示**不新造状态词**（= 既有三态「未覆盖 + 附注」）。D6 关闭。用户追问过「CONTEXT.md 对其他地方用 skills 有无影响」，已答：零运行时影响，词表只作用于本仓库维护现场。

---

## 第二轮（2026-09-22 解锁：R 已拍 A；本轮问 D1/D2/D3，D4 为拍后自动执行）

### D1. 形态细节的单一真相源落点

- **是什么**：D5 已拍定的六项形态细节（spec 位置/编号绑定/驱动入口/截图/登录/语言）写进哪个文件，成为唯一权威版本；其他文件只放指针。
- **从哪来**：你 2026-09-20 拍板「反对同一知识多处复述，一处定义、其余指针」；`testsuite-skeleton.md` 头部自声明「唯一权威」，但那是**骨架**正本，不是工具形态正本——工具细节塞进去会让骨架文件开始漂。
- **影响什么**：to-qa-testcases 的文件清单；run-qa-testcases 与未来项目脚手架引用哪份文档；改形态时 sweep 哪里。
- **选项与取舍**：
  - **A（推荐）**：新 reference `to-qa-testcases/references/playwright-assets.md` 承载形态正本；SKILL.md 资产三原则节与 skeleton 资产表各加一句指针。代价：多一个文件；收益：骨架保持瘦，形态演进不污染骨架。
  - B：内嵌 `testsuite-skeleton.md` §二资产表。收益：不加文件；代价：骨架正本开始承载具体工具细节，下次换工具（如换 Cypress）要再动权威骨架。
  - C：写 SKILL.md 正文展开。代价：违反既有分工「正文引用骨架、细节在 references」，且触发面文本膨胀。
- ➡️ **推荐 A**。

> **裁决（2026-09-22，plan-approve）**：用户回「D1: A」——形态正本 = 新 reference `to-qa-testcases/references/playwright-assets.md`，SKILL.md 与 skeleton 各加指针句。

### D2. run-qa-testcases 侧同步改动范围

- **是什么**：run 侧作为 Playwright 资产的使用方，需要同步改四处文本：①Process 2 呈现通道执行 = Playwright 套件（软失败/json/退出码为原生能力，薄壳脚本统一入口）+ 截图留证 + 有视觉时 agent 抽查看图；②交接契约 E 节：fe 缺陷最小复现入口 = `npx playwright test -g <编号>`（协议通道缺陷仍走原驱动命令）；③复测识别**不新增机制**（自然语言触发语 + 条目状态「待复测」+ 多轮以末轮为准，复测 = 同一条命令）；④红线句补明「Playwright 真浏览器走查属呈现通道，不是协议通道代出」。
- **从哪来**：R 拍板（run 侧是固化回归执行器的使用方）；本会话「复测依赖什么产物 / 怎么识别是复测 / 复测可不可以用 VLM」三问的结论（复测零 VLM，E 节契约已保证）。
- **影响什么**：run-qa-testcases SKILL.md 的 Process 2、交接契约表、自检清单三处；不改动缺陷六词状态词表、不改三态。
- **选项与取舍**：
  - **A（推荐）**：与 D1 同票同改——两侧契约互指（to 产形态、run 用形态），分两批改必然漂移。
  - B：另票跟进，to 侧先落。代价：中间态窗口里 run 侧协议与资产形态不一致。
- ➡️ **推荐 A**。

> **裁决（2026-09-22，plan-approve）**：用户回「D2: A」——run 侧四处改动与 to 侧同票同改（呈现通道执行改写 / E 节 fe 缺陷 grep 命令 / 复测识别不新增机制 / 红线句补「Playwright 属呈现通道」），另含 qa-records-skeleton.md §3 视觉维附注口径。

### D3. 无视觉模型的呈现通道降级口径

- **是什么**：把本会话讨论的降级口径写进协议：①DOM 探针清单（boundingBox 几何判重叠/换行/撑破、getComputedStyle 读样式值对照设计 token、`document.fonts.check` 查字体、`naturalWidth===0` 查裂图、axe-core 扫对比度）；②视觉维记录用**既有三态**「未覆盖 + 附注（视觉维留证待审）」，不新造状态词；③VLM 位置表（断言设计时：要；复测执行：不要；复测后抽审：可选），截图纪律不变、照拍照落 `qa/screenshots/`。
- **从哪来**：你「model 不支持图像可以测呈现么」「复测可以不使用 VLM 么」两问；事故锚点「接口通路但页面崩了」——视觉维不出「通过」是防假阳性的硬要求（文档已写明的 DoD 精神）。
- **影响什么**：D1 选定正本文件的内容构成；run 侧 test.md §3 的记录口径说明；你用纯文字模型跑 QA 时的操作规程。
- **选项与取舍**：
  - **A（推荐）**：本轮一并定，随 D1/D2 同票落文——协议一次成形，避免先落最小版再返工。
  - B：另票后补，协议先落 Playwright 最小版。代价：文字模型在此期间跑 QA 无规程可依，临场自由发挥。
- ➡️ **推荐 A**。

> **裁决（2026-09-22，plan-approve）**：用户回「D3:A」——无视觉降级口径（DOM 探针清单 + 视觉维「未覆盖+附注（留证待审）」三态用法 + VLM 位置表）本轮一并定，随 D1/D2 同票落文。

### D4. 票务（拍后自动执行，非问题）

D1~D3 拍定后，按拍板落地协议（加法型拍板当场立票）立即执行：①**协议改票**（本仓 `to-tickets` 立票：改 to-qa-testcases / run-qa-testcases skill 文本 + 按既有纪律同步装态 `~/.zcode/skills/` 与 `~/.dsh/.agent-presets/full/skills/`）；②**novel 脚手架**记**待立项**（跨仓：playwright.config + qa/e2e/ 脚手架 + storageState，拟下次 novel 工单会话立票）。拆分有异议现在说，否则按此执行。

> **执行记录（2026-09-22）**：D1=A、D2=A、D3=A 已裁（用户原话「D1: A / D2: A / D3:A」）。①协议改票已立：`.plan/qa-skill-merge/tickets/04-playwright-protocol-assets.md`（type: task，status: open，to-tickets 出票，本仓 qa-skill-merge effort）。②novel 脚手架记**待立项**（跨仓；拟立内容 = playwright.config + `qa/e2e/` 脚手架 + storageState 真实链路登录 + 薄壳驱动入口，按 D5 六项形态；待下次 novel 工单会话立票，未转「代码」前不闭环）。本档全部条目（R/D5/D6/D1/D2/D3）销号，status 翻 closed；整轮归档待 plan-archive。落地类型：文档（裁决记录 + CONTEXT.md）= 本档与 CONTEXT.md 本体；代码/协议文本 = 票 04；待立项 = novel 脚手架。
