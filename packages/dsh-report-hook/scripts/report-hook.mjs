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
 * 注入文案的条款①~④见下方 REMINDER_TEXT。原⑤（文档一律用 sidebar_open 在
 * 侧边栏打开）与⑥（已打开文档的刷新语义）已于 2026-09-27 按用户要求整条删除，
 * 不再注入——条文案相关说明一并移除，避免留死指针。
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
// 【已退役·2026-09-27】原⑤（文档一律用 sidebar_open 在侧边栏打开）与⑥（已打开
// 文档的刷新语义）两条条款已按用户要求整条删除，不再注入；本处原有的设计说明
// 一并移除。留存要点备查（将来若要恢复，先看这段，勿凭想象重写）：
//   - ⑤ 曾要求「文档类产出不只给路径，主动用 sidebar_open 打开」，依赖
//     dsh-better-sidebar 插件与 ~/.dsh/settings.yaml 的 agentOpenTools: true。
//   - ⑥ 的硬约束（实测结论，非推断）：模型侧**没有**关闭文档页签的工具、也
//     **无法查询**哪些页签开着（全包只有 sidebar_open + terminal_*，closeTab 仅在
//     浏览器侧 service、调用方全是 UI 点击）；且**重复 open 同一路径不能刷新**——
//     页签 id 为 `editor:<绝对路径>`，重复 open 命中 id safety net 只做聚焦并返回
//     同一 tab 对象，tab 单元格 memo 比较引用 ⇒ 不重渲染、不重读盘。故「关掉再
//     打开以获得最新内容」这一诉求在模型侧做不到，恢复条款前须先解决该能力缺口。
const REMINDER_TEXT = [
  '【汇报规范提醒·命中】用户这句话疑似在请你就某事项做决策 / 审批 / 拍板。',
  '若确实需要用户拍板，请按「汇报语言与审批材料规范」执行（正本：viking://user/memories/preferences/huzilin/汇报语言与审批材料规范.md；摘要见 ~/.dsh/AGENTS.md「汇报与审批材料规范」段）。',
  '务必做到：',
  '① 说听得懂的话——少用英文与非技术专业词；必须用时首次给中文解释。',
  '② 展开说，不许甩词条——每个待拍板项给全上下文：这是什么、从哪来、影响什么、为何要用户决定。禁止只抛「一个词/一个编号」就问怎么处理。',
  '③ 要审批必须交文档——把待拍板项落盘成一份审批文档，且文档里必须含该事项的原文照抄 + 原文的语境（这段在讨论什么）+ 相关条款关系 + 选项与影响。汇报里给的是文件路径，不是文件:行号（行号只用于你自回查，不得作为给用户的决策材料）。',
  '④ 性质必须分类标注——区分「文档已写明 / 文档有空白 / 你的推断」三类，不得混在一张表里呈现。',
  '若这句话只是普通技术追问、并不真正需要用户拍板，则忽略本提醒继续正常回答即可。',
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