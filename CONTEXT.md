# dsh-plugin · QA 技能族词汇正本

本仓库承载 dsh-plan-view 插件与 QA 测试技能族（to-qa-testcases / run-qa-testcases）的协议文本。本文件是**词汇正本**（glossary）：只收词与一句定义，不写实现；定义细则与指针归各正本文档。新词、改名、废弃走「术语变更双域 Sweep 协议」（正本：`viking://user/default/memories/preferences/huzilin/术语变更双域Sweep协议.md`）。

## Language

### 测试通道

**协议通道**：
API/DB 黑盒驱动 + 库态对账的测试通道。
_Avoid_: 接口腿、后端通道

**呈现通道**：
浏览器真实走查（有前端必走）的测试通道；Playwright 固化走查属本通道，纯协议通道不得对 UI 出「通过」。
_Avoid_: 页面腿、前端通道、UI 走查（泛称时）

**固化回归**：
用可执行测例资产（含 Playwright spec）确定性复跑的回归腿——确定性、秒级、agent 可无人值守。
_Avoid_: 回归腿（口语）、Playwright 回归（工具名不当同义词）

**探索走查**：
agent 交互式黑盒走查腿（browser-use web-gui-tester 形态），承担首轮元素位盘点、原型 diff 与盲区发现；与固化回归并列、互不替代。
_Avoid_: 探索腿、人工走查（并非人工执行）

**DOM 探针**：
无视觉模型下以几何值、computedStyle、DOM 状态断言呈现层的手法；探针清单正本 = `packages/dsh-plan-view/skills/to-qa-testcases/references/playwright-assets.md`（票 04 落地）。
_Avoid_: 视觉断言、截图断言（截图是留证不是断言依据）

### 记录口径

**留证待审**：
非状态词。视觉维的记录形态 = 既有三态「未覆盖 + 附注（留证待审）」：截图照拍落 `qa/screenshots/` 供人审或视觉模型事后看，不得记为「通过」。
_Avoid_: 新造第四态状态词；「视觉通过」
