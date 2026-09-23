# to-qa-testcases · Playwright 呈现通道资产形态正本

> 本文件是**有 UI 项目呈现通道可执行资产**形态的唯一权威（2026-09-22 拍板，裁决源 `.plan/待拍板-to-qa-testcases接入playwright-20260921.md`，status: closed）。SKILL.md 与 testsuite-skeleton.md 只放指针，不复述本文。
> 分工边界：本文件管**资产形态与降级口径**；执行动作归 `run-qa-testcases`（双通道执行 / 缺陷 / 复测）；用例设计仍按 `testsuite-skeleton.md`（P 组两表不因工具改变）；造数纪律仍按 `run-qa-testcases/references/data-construction.md`。术语口径见仓库根 `CONTEXT.md`。

## 一、定位与边界（2026-09-22 裁决 R）

- **Playwright = 呈现通道可执行资产的标准形态（本 skill 产出）+ 固化回归执行器（run-qa-testcases 使用）**。它开真浏览器走真用户旅程，**属呈现通道**——纯协议通道不得对 UI 出「通过」的红线不变，Playwright 不是协议通道的替代品。
- **不接探索走查**：新页面首轮元素位盘点、原型视觉 diff、审美判断归浏览器交互式走查（browser-use web-gui-tester 形态）与用户验收节点。固化回归与探索走查并列、互不替代。
- 无 UI 项目不受影响（显式声明，既有规则）；协议通道资产（驱动脚本 + 库态对账）不因此改变。

## 二、资产形态六项（D5 裁决）

| # | 项 | 要求 |
|---|---|---|
| 5a | spec 位置 | 仓库 `qa/e2e/`（可执行资产不进 `.plan/`，跟代码走、可进 CI） |
| 5b | 用例编号绑定 | test 标题以用例编号开头（`test('P-12 提交按钮占位文案', …)`）；单跑 `npx playwright test --grep P-12`；**不引入 testTag 机制** |
| 5c | 驱动入口 | 薄壳 `qa/run-e2e.sh` 统一「一键复跑」：内部调 playwright（json reporter 输出 `qa/results/`）+ 汇总 PASS/FAIL/SKIP。软失败收全与退出码 FAIL>0 非 0 由 playwright 原生提供 |
| 5d | 截图落点 | `qa/screenshots/<用例编号>-<步骤>.png`，test 内代码显式落盘（不依赖 trace viewer）；文案类截图须能看清文字 |
| 5e | 登录与环境 | storageState 复用登录态；登录本身走真实接口链路（造数禁令适用，禁绕过直塞）；环境由既有 `env_up` 负责，playwright 只连不启（baseURL 指向 env_up 起的服务），**不双起服务** |
| 5f | spec 语言 | 与项目栈一致（协议不锁语言） |

> **等待口径**：spec 内「等某事完成」一律条件探测——自动重试断言或 `expect.poll`（探测间隔+超时上限），裸 `waitForTimeout` 作就绪判定 = 违例；红线正本 `testsuite-skeleton.md` §二「等待与确定性红线」（2026-09-23 拍板）。
> **并发与环境口径**：端口/工作目录/结果落点一律带测例集标识、零共享可并发；`qa/results/`、`qa/screenshots/` 本落仓库内，临时物禁 `/tmp`；红线正本 `testsuite-skeleton.md` §二「并发与环境红线」（2026-09-23 拍板）。

## 三、DOM 探针清单（无视觉模型断言呈现层）

判据在**断言设计时**序列化成文本，执行全程零图像依赖。P 组维度 ↔ 探针对照：

| P 维度 | 探针 | 判定方式（全文本输出） |
|---|---|---|
| P-1 文案逐字 | `toHaveText` / `toContainText` | 精确匹配，错一字即红 |
| P-1 在位 / 可见 / 可操作 | locator + `toBeVisible` + enabled | DOM 状态断言 |
| P-1 位置（重叠 / 换行 / 同排） | `boundingBox()` 取几何值 | 相邻元素矩形不相交；同行元素高度 ≈ 一行行高 |
| P-1 长列表不撑破布局 | `scrollWidth` vs `clientWidth` | 容器不被撑破的数值断言 |
| P-1 形态（字号层级 / 色彩系 / 视觉编码） | `getComputedStyle` | `font-size` / `font-weight` / `color` 等文本值对照设计 token 断言 |
| P-1 对比度 | `@axe-core/playwright` 扫描 | 对比度不足、标签未关联等以文本报告输出 |
| P-1 字体生效 | `document.fonts.check()` | 布尔值断言 |
| P-1 裂图 | `img.naturalWidth === 0` / `complete` | 布尔值断言 |
| P-1 空态 / 默认态 / 选中态 | DOM 文本 + class/aria 属性 | 文本与属性断言 |
| P-2 全维度 | 反馈提示条文本、刷新后持久化、失败回滚 | DOM/状态断言；持久化与回滚按 D 组对账库真值 |

> 探针只覆盖「想到的」；探针外的渲染实况归第四节降级口径，不冒充已覆盖。

## 四、无视觉模型降级口径（D3 裁决）

- **视觉维记录 = 既有三态「未覆盖 + 附注（视觉维留证待审）」，不出「通过」**。这是防「接口通路但页面崩了」类假阳性的硬要求（事故锚点 2026-09-12，acceptance-dod.md）。不新造第四态状态词。
- **截图纪律不变**：照拍、逐条落 `qa/screenshots/`、按用例编号命名；角色从「判定依据」变为「留证」。
- **留证三去处**（任选其一或组合，test.md 注明）：事后人审 / 派有视觉的子模型抽审（可选，非必需）/ 用户验收节点集中看。
- **VLM 位置表**：

| 环节 | 要不要视觉 |
|---|---|
| 断言设计（首测探索、元素位盘点、原型 diff） | 要（或人替代） |
| 复测执行 | **不要**（E 节契约保证：确定性、无人值守） |
| 复测后视觉抽审 | 可选 |

- **纯审美缺陷**（间距、配色和谐度等写不出确定性红命令的）不进命令复测通道，归视觉通道（探索走查 / 用户验收）登记处置。

## 五、复测与基线

- 复测 = **同一条命令翻绿**：单缺陷 `npx playwright test -g <用例编号>`，整轮跑 `qa/run-e2e.sh`；复测识别**不新增机制**（自然语言触发语 + 条目状态「待复测」+ 多轮以末轮为准，正本在 run-qa-testcases）。
- 结果 json 落 `qa/results/`，对照 `qa/README` 基线口径判回归；`qa/README.md` 资产清单须登记本套资产（复跑三步 + 扩展约定）。
- fe 缺陷登记时 E 节「最小复现入口」cmd 即 `--grep` 命令（骨架见 `run-qa-testcases/references/qa-records-skeleton.md`）。
