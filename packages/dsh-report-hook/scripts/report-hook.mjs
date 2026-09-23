#!/usr/bin/env node
/**
 * dsh-report-hook — 汇报规范自动提醒 判断脚本。
 *
 * 由 DSH 的 hooks-claude-code 桥接在 `agent/pre-step`（用户发言时）触发执行。
 * 读取 stdin 里的 JSON payload（含用户这一轮的 `prompt` 纯文本），判断用户
 * 是否疑似在要「决策 / 审批 / 拍板」。若命中，往 stdout 输出一段 `additionalContext`
 * 提醒；未命中则输出空（隐式 exit 0），桥接不做任何注入——这就是「不误伤」。
 *
 * 输出协议（桥接约定，勿改）：
 *   命中：{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}
 *   未命中：空 stdout + exit 0
 * 绝不写 `decision` 字段（那是 Claude Code 方言，DSH 严格 schema 会拒绝）。
 *
 * 分类策略（用户已确认：先正则粗筛，模型通道恢复后再升级为正则+模型精判）：
 *   - 强决策词命中 ⇒ 判为「要决策/审批」；
 *   - 无强决策词时，弱决策词 + 决策语境词同时命中才判为命中；
 *   - 触发词清单放在文件底部 DECISION_TRIGGERS，方便增补同义说法。
 *
 *   > 注：命中判定偏保守偏「宁可多提醒」。因为注入内容自带「若无需拍板可忽略」
 *   > 的自谦降级说明——越界提醒无实质危害，漏提醒才违背本插件存在的意义。
 *
 * 注入文案的条款①~⑤见下方 REMINDER_TEXT。其中⑤（文档一律用 sidebar_open 在
 * 侧边栏打开）是 2026-09-11 新增，且**不依赖是否要拍板**：只要本轮产出了文档
 * 就适用。它依赖 dsh-better-sidebar 的 `sidebar_open` 工具，需用户在
 * ~/.dsh/settings.yaml 的 `dsh-better-sidebar.agentOpenTools: true` 开启。
 *
 * 地址定位：脚本用 import.meta.url 定位自身及各静态资源，不依赖进程工作目录，
 * 因为桥接在会话工作区（session.header.cwd）执行钩子。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK_EVENT_NAME = 'UserPromptSubmit'

/** session 工作区不在包内——提醒内容固定内联，不引用 cwd 下的文件。 */
// 自身目录（用于将来从包内读资源；当前提醒文本内联于 OUTPUT_TEMPLATE）。
const SELF_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 纯分类函数：判断一句用户输入是否为「要决策 / 要审批」。
 * 导出以便单元测试。
 * @param {string} prompt 用户这句话的纯文本。
 * @returns {boolean} 是否命中「需建议按汇报规范」。
 */
export function isDecisionRequest(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') return false
  const text = prompt
  const hasStrong = DECISION_TRIGGERS.strong.some((re) => re.test(text))
  if (hasStrong) return true
  const hasWeak = DECISION_TRIGGERS.weak.some((re) => re.test(text))
  if (!hasWeak) return false
  // 弱决策词需决策语境词佐证，避免把技术追问（如「这个函数怎么调用」）当决策。
  return DECISION_TRIGGERS.context.some((re) => re.test(text))
}

/**
 * 端到端分类：给出一句用户输入，返回要注入的提醒文本；无需注入返回 null。
 * @param {string} prompt 用户输入。
 * @returns {string | null}
 */
export function classifyPrompt(prompt) {
  if (!isDecisionRequest(prompt)) return null
  return loadReminder()
}

/** 组装注入的提醒文本（内联文案；引用规范正本指针但不复制正文）。 */
export function loadReminder() {
  return REMINDER_TEXT
}

// ---- 注入的提醒文本 ----
// 用户已确认：注入内容「直接给如何处理」，而不是只甩指针。故此段内嵌可执行
// 动作 + 正本指针。单一真相源原则的取舍：不在常态注入里复制全文，但在命中时
// 给出可操作的「如何处理」，避免 agent 还要再跳转读文档才知道怎么办。
//
// ⑤ 是 2026-09-11 用户拍板新增的「交付形态」条款：文档类产出不再只给路径，
// 而是主动用 sidebar_open 工具在侧边栏打开（用户原话：「将要拍板并落的文档，
// 最后直接调 sidebar_open 打开」「一般的文档输出格式，要求都是 sidebar 打开的」）。
// 该工具由 dsh-better-sidebar 提供，需 ~/.dsh/settings.yaml 里 agentOpenTools: true。
//
// ⑥ 是同日用户追加要求（原话：「增加要求，让 agent 判断，当前文档是否已经打开，
// 如果处于打开转给他，帮我关闭，并重新打开」+ 澄清「不要弹提示」）的落地。
// 查证 dsh-better-sidebar 源码后的**硬约束**（勿凭想象改，这是实测出来的）：
//   - 用户的核心诉求是**刷新**：关闭再打开 = 强制重新读盘。
//   - **模型侧没有关闭文档 Tab 的工具**：全包只有 sidebar_open + terminal_*；
//     closeTab 只存在于浏览器侧 service，调用方全是 UI 点击。模型也**无法查询**
//     哪些 Tab 开着（无 list/tabs 工具）。→ 「判断是否已打开→关闭」这步**做不到**，
//     条款不能假装能做到，否则 agent 会空转找不存在的工具。
//   - 而且**重开同一路径并不能刷新**：编辑器 Tab 的 id 是 `editor:<绝对路径>`
//     （service.ts openFile），重复 open 命中 state.ts openTabInActivePane 的
//     「id safety net」→ 直接 return activateTab(...) 只做聚焦，返回的**同一个
//     tab 对象**；而 tab 单元格的 memo 比较 tab 引用（tab-content-memo.ts），
//     引用不变 ⇒ 不重渲染、不重新读盘。所以「再 open 一次」是**无副作用的聚焦**，
//     既不会刷新、也**绝不会弹确认框**（这点反而是好事，符合用户「不要弹提示」）。
//   - 真正能刷新的只有「Tab 被卸载后重建」，即 closeTab 之后再 openFile——
//     但 closeTab 模型不可达。
//   - **「不要弹提示」**：人工刷新按钮在草稿 dirty 时 window.confirm（EditorHost
//     refreshFile）；而打开路径不经过 confirm（已 grep 确认）。所以条款要求 agent
//     只走 sidebar_open、**不要**引导用户点刷新按钮（那才会弹框）。
// 结论：条款如实写成——「重开是聚焦、不是刷新；模型无法关闭/无法得知已开状态；
// 若确实需要刷新内容，如实告知用户当前能力限制，不要假装刷新成功、不要诱导点刷新按钮」。
const REMINDER_TEXT = [
  '【汇报规范提醒·命中】用户这句话疑似在请你就某事项做决策 / 审批 / 拍板。',
  '若确实需要用户拍板，请按「汇报语言与审批材料规范」执行（正本：viking://user/memories/preferences/huzilin/汇报语言与审批材料规范.md；摘要见 ~/.dsh/AGENTS.md「汇报与审批材料规范」段）。',
  '务必做到：',
  '① 说听得懂的话——少用英文与非技术专业词；必须用时首次给中文解释。',
  '② 展开说，不许甩词条——每个待拍板项给全上下文：这是什么、从哪来、影响什么、为何要用户决定。禁止只抛「一个词/一个编号」就问怎么处理。',
  '③ 要审批必须交文档——把待拍板项落盘成一份审批文档，且文档里必须含该事项的原文照抄 + 原文的语境（这段在讨论什么）+ 相关条款关系 + 选项与影响。汇报里给的是文件路径，不是文件:行号（行号只用于你自回查，不得作为给用户的决策材料）。',
  '④ 性质必须分类标注——区分「文档已写明 / 文档有空白 / 你的推断」三类，不得混在一张表里呈现。',
  '⑤ 文档必须在侧边栏打开——凡产出文档（尤其是③落盘的审批文档），写盘之后立刻调用 sidebar_open 工具把它在侧边栏打开（传绝对路径），让用户当场就能读到全文，而不是自己去文件系统里翻。不止审批文档：一般性的文档输出（报告、设计稿、分析、总结、方案对比等凡是落盘成文件的产出）同样一律用 sidebar_open 打开。同一轮有多份文档时，逐一打开（或至少打开用户当前最需要拍板的那一份）。仅当 sidebar_open 不可用（工具未开启 / 调用失败）时才退化为「给路径」，并说明原因。',
  '⑥ 已打开的文档：重复打开只聚焦，不是刷新（别谎报刷新成功）——用户希望「文档若已开着就先关掉再重开以获得最新内容」。**当前工具做不到**：模型侧只有 sidebar_open 这一个文档工具，既没有任何「关闭文档页签」的命令，也无法查询哪些页签正开着（关闭能力只存在于浏览器界面里，由用户点页签上的叉号触发）。而且重复调用 sidebar_open 传同一路径**不会**重新读盘：页签按「绝对路径」认身份，命中已有页签时只是把它切到前台（聚焦），内容仍是旧的那份。所以：**不要**去找关闭命令（不存在，会白费轮次），**不要**谎称自己刷新了内容，也**不要**叫用户去点编辑器右上角的刷新按钮（那个按钮在草稿未保存时会弹确认框，用户明确要求不要弹提示）。正确做法是——照常调用 sidebar_open 打开（它保证文档在前台可见），若你能判断内容可能陈旧（本轮改过该文件、或用户说看到的不是最新版），就**如实说明**：「该文档已在侧边栏打开，重复打开只会聚焦到它；我这边没有关闭/刷新侧边栏页签的权限，需要看到最新内容请手动关闭该页签后我再打开一次，或直接告诉我你在看的是旧版」。全程不弹任何提示、不诱导用户点会弹框的按钮。',
  '若这句话只是普通技术追问、并不真正需要用户拍板，则忽略本提醒继续正常回答即可；但⑤⑥的文档打开与刷新要求与是否要拍板无关，只要产出了文档就适用。',
].join('\n')

// ---- 触发词清单（可增补同义说法） ----
// 强：单个命中即判为要决策。弱：需再命中一个 context 语境词才判为要决策。
// 用正则，多行匹配。`context` 不含裸「处理/调用/支持」等中性技术词，避免把
// 技术 how-to（「node 里如何处理异步」「这个库支持不支持断点续传」）误判为决策。
const DECISION_TRIGGERS = {
  strong: [
    /方案|方案对比|哪.?个方案|方案选/i,
    /拍板|审批|定夺|决策|决定|拿主意|你定|你拍|你定夺|你拍板/i,
    /选哪个|选一?个|选一条|选谁|哪条路|倾向|选哪/i,
    /要不要|需不需要|可不可以|行不行|行得通|能不能|能否|是否可行|成不成立|认可吗|同意吗|该不该|应不应该/i,
    /怎么办|怎么弄|怎么处理|怎么选|怎么取舍|怎么解决|该怎么做|该如何做|咋办|拿不定|拿不准|犹豫/i,,
    /给个方案|请给方案|给两?个方案|几个方案|给点建议|提供方案|给意见|给建议|推荐哪|推荐一?种|哪种更好/i,
    /要审批|需审批|要确认|需确认|需要签|批不批/i,
    /你判断|你定夺|你拍板|我该.?决定|帮我决定/i,
  ],
  weak: [
    /怎么|如何|怎样|哪一|哪种|哪个|是否|可不可以|好不好|适合不适合|妥不妥|支持不支持|支不支持/i,
  ],
  context: [
    /方案|选|取舍|决定|决策|更好|更合适|推荐|倾向|权衡|思路|策略|方向|利弊|底线|取舍/i,
  ],
}

// ---- 入口：读 stdin JSON，命中则输出 additionalContext ----
async function readStdin() {
  return await new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

async function main() {
  let payload
  try {
    payload = JSON.parse((await readStdin()).trim() || '')
  } catch {
    payload = null
  }
  // 兼容多种 payload 形态：bridges 用 `prompt`，冗余兼容其它别名。
  const prompt = payload?.prompt
    ?? payload?.user_prompt
    ?? payload?.prompt_text
    ?? ''
  const context = classifyPrompt(prompt)
  if (!context) return // 不注入：空输出 + 隐式 exit 0
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: HOOK_EVENT_NAME, additionalContext: context } }) + '\n',
  )
}

// 仅在作为主模块被 node 直接执行时运行 main()；被 import（单元测试）时不挂起 stdin。
const isEntry = process.argv[1] !== undefined
  && (await import('node:url')).fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])
if (isEntry) {
  main().catch(() => {
    // 失败不阻塞：空输出 + 非 2 退出码（DSH 对非 2 退出码容错，仅记日志）。
    process.exit(0)
  })
}