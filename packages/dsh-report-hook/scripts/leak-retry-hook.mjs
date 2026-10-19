#!/usr/bin/env node
/**
 * leak-retry-hook — 「模型吐了工具调用标记乱码 ⇒ 让它重说一遍」的 Stop 钩子判断脚本。
 *
 * 由 DSH 的 hooks-claude-code 桥接在 agent/turn-stopping（Stop 事件：agent 认为
 * 这一轮说完了）时触发。读 stdin 的 JSON payload，找出本会话的日志，切出「本轮
 * 最后一个助手回合」，判断它是否只有工具调用标记、没有正文；命中就输出
 * decision=block + 原因，桥接会 agent.steer() 这句原因，agent 于是再跑一轮正常
 * 回答。
 *
 * 日志定位：桥接传的 transcript_path 恒为空串（dsh-hooks-claude-code 的
 * base() 写死 transcript_path: ""），所以本脚本自己按 session_id 到
 * ~/.dsh/sessions/ 下找 session.v4.jsonl.zstd（zstd 解压后读）。
 *
 * 输出协议（桥接约定，勿改）：
 *   命中：{"decision":"block","reason":"…"}
 *   未命中：空 stdout + exit 0
 *
 * 边界：这一步拦的是「回合结束」，这时乱码那条已经作为正式答复落库了，不在
 * 本脚本能力范围内（删它要改 DSH 安装包）。本脚本负责的是「不停在这里」。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

/** 全角竖线对 U+FF5C U+FF5C。源码里不写字面量，避免被写入通道改坏。 */
const FF = String.fromCharCode(0xff5c, 0xff5c)

/** 闭合态标签，如 <FFDSMLFF invoke>、<FFDSMLFF calls>。 */
const CLOSE_TAG = new RegExp('<' + FF + '[A-Za-z0-9_]{1,24}' + FF + '\\s*[A-Za-z0-9_]*>', 'g')
/** 开放态标签，如 <FFDSMLFF> parameter。 */
const OPEN_TAG = new RegExp('<' + FF + '[A-Za-z0-9_]{1,24}' + FF + '>[A-Za-z0-9_]{0,24}', 'g')
/** 裸的残尾：xxxFF> 或 FFNAMEF>。 */
const DANGLING = new RegExp('[A-Za-z0-9_]*' + FF + '>', 'g')
/** 半角特殊 token：<|DSML|>、<|tool_calls|> 之类。 */
const SPECIAL = /<\|[A-Za-z0-9_\u2581]{1,24}\|>/g
/** 剥完之后只允许剩空白与标点。 */
const ONLY_PUNCT = new RegExp('^[\\s<>=/,.;:()"|\\-' + FF + ']*$')

const STRIPPERS = [SPECIAL, CLOSE_TAG, OPEN_TAG, DANGLING]

/**
 * 判断一段可见文字是不是「只有工具调用标记、没有正文」。
 * @param {string} text 模型这次说出来的可见文字。
 * @returns {boolean}
 */
export function isMarkerOnly(text) {
  if (typeof text !== 'string') return false
  if (!/\S/.test(text)) return false
  let rest = text
  for (const re of STRIPPERS) rest = rest.replace(re, '')
  return ONLY_PUNCT.test(rest)
}

/**
 * 从会话日志里取「本轮最后一个助手回合的可见文字」。
 * @param {string} raw 会话日志全文（JSONL）。
 * @param {number} [turn] 当前轮次；缺省取日志里最后一轮。
 * @returns {string}
 */
export function lastAssistantText(raw, turn) {
  if (typeof raw !== 'string' || raw === '') return ''
  let currentTurn = turn
  const events = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (s === '') continue
    let e
    try {
      e = JSON.parse(s)
    } catch {
      continue
    }
    if (e === null || typeof e !== 'object') continue
    events.push(e)
    const t = e.data?.turn
    if (typeof t === 'number') currentTurn = t
  }
  let text = ''
  // 只看最后一轮：调用方给的 turn 可能已经过期，以日志里的最大轮次为准。
  for (const e of events) {
    if (e.type !== 'assistant/message') continue
    if (e.data?.turn !== currentTurn) continue
    const blocks = e.data?.message?.content
    if (!Array.isArray(blocks)) continue
    const own = blocks
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    if (own === '') continue
    text = own
  }
  return text
}

/**
 * 按会话号在 ~/.dsh/sessions 下找日志并读出全文。
 * 文件可能是 zstd 压缩的 session.v4.jsonl.zstd，也可能是裸 JSONL。
 * @param {string} sessionId
 * @param {string} [root] 会话根目录（测试可注入）。
 * @returns {string} 读不到返回空串。
 */
export function readSessionLog(sessionId, root = join(homedir(), '.dsh', 'sessions')) {
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  let dirs = []
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name))
  } catch {
    return ''
  }
  for (const dir of dirs) {
    const plain = join(dir, sessionId, 'session.v4.jsonl')
    if (existsSync(plain)) {
      try {
        return readFileSync(plain, 'utf8')
      } catch {
        continue
      }
    }
    const packed = join(dir, sessionId, 'session.v4.jsonl.zstd')
    if (!existsSync(packed)) continue
    try {
      return execFileSync('zstd', ['-dc', packed], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    } catch {
      continue
    }
  }
  return ''
}

/** 让 agent 重说的原因；不解释根因，只给可执行动作。 */
export const RETRY_REASON = [
  '你这一轮只输出了工具调用标记（<' + FF + 'DSML' + FF + '> 这类协议保留字符），没有正文。',
  '请重新组织这一轮：说清楚你要做什么，或用简短结论收尾；不要输出任何含 ' + FF + ' 或 <|…|> 的标记。',
].join('')

/** 读 stdin 全部内容。 */
async function readStdin() {
  return await new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      data += c
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

/**
 * 从一次 Stop payload 得出该不该拦。
 * @param {unknown} payload 桥接传入的 JSON。
 * @param {(p: string) => string} readRaw 读日志全文（测试可注入）。
 * @param {(id: string) => string} readLog 按会话号找日志（测试可注入）。
 * @returns {{decision: 'block', reason: string} | null}
 */
export function decide(payload, readRaw = readPlainLog, readLog = readSessionLog) {
  if (payload === null || typeof payload !== 'object') return null
  if (payload.stop_hook_active === true) return null
  const raw =
    typeof payload.transcript_path === 'string' && payload.transcript_path !== ''
      ? readRaw(payload.transcript_path)
      : readLog(payload.session_id)
  const text = lastAssistantText(raw, payload.turn)
  if (!isMarkerOnly(text)) return null
  return { decision: 'block', reason: RETRY_REASON }
}

/** 读裸日志文件；读不到返回空串（钩子失败不阻塞 agent）。 */
function readPlainLog(logPath) {
  if (typeof logPath !== 'string' || logPath === '') return ''
  try {
    return readFileSync(logPath, 'utf8')
  } catch {
    return ''
  }
}

async function main() {
  let payload = null
  try {
    payload = JSON.parse((await readStdin()).trim() || 'null')
  } catch {
    payload = null
  }
  const out = decide(payload)
  if (out === null) return
  process.stdout.write(JSON.stringify(out) + '\n')
}

const { fileURLToPath } = await import('node:url')
const { resolve } = await import('node:path')
const isEntry =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isEntry) {
  main().catch(() => {
    process.exit(0)
  })
}
