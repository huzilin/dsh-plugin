import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, isMarkerOnly, lastAssistantText, RETRY_REASON } from '../scripts/leak-retry-hook.mjs'

const FF = String.fromCharCode(0xff5c, 0xff5c)
const LEAK = '<' + FF + 'DSML' + FF + '> parameter' + FF + '>'
const LEAK_BLOCK = LEAK + '\n<' + FF + 'DSML' + FF + ' invoke>\n<' + FF + 'DSML' + FF + ' calls>'

/** 造一行会话事件。 */
function ev(type, turn, content) {
  return JSON.stringify({ type, seq: 1, time: 0, data: { turn, message: { role: 'assistant', content } } })
}

const logOf = (...lines) => lines.join('\n')

function textOf(text) {
  return [{ type: 'text', text }]
}

test('只有工具调用标记的文字判为命中', () => {
  assert.equal(isMarkerOnly(LEAK), true)
  assert.equal(isMarkerOnly(LEAK_BLOCK), true)
  assert.equal(isMarkerOnly('<|DSML|>'), true)
})

test('有正文或空串不命中', () => {
  assert.equal(isMarkerOnly(''), false)
  assert.equal(isMarkerOnly('   '), false)
  assert.equal(isMarkerOnly('今天改好了三个文件，测试通过。'), false)
  assert.equal(isMarkerOnly('The marker ' + FF + 'DSML' + FF + ' is how the model spells a tag. 正常解释。'), false)
})

test('从日志里取最后一轮的助手回合', () => {
  const raw = logOf(ev('assistant/message', 2, textOf('上一轮的正常回答')),
    ev('assistant/message', 3, textOf(LEAK)))
  assert.equal(lastAssistantText(raw), LEAK)
})

test('最后一轮有多条助手消息时取最后一条带正文的', () => {
  const raw = logOf(ev('assistant/message', 3, textOf('先说一句')),
    ev('assistant/message', 3, textOf(LEAK)))
  assert.equal(lastAssistantText(raw), LEAK)
})

test('session_id 能找到日志时，transcript_path 为空也判定得出', () => {
  const raw = [ev('assistant/message', 1, textOf(LEAK))].join('\n')
  const out = decide({ session_id: 'abc', transcript_path: '', turn: 1 }, () => '', () => raw)
  assert.equal(out.decision, 'block')
})

test('找不到日志时不拦（宁可放过也不误拦）', () => {
  const out = decide({ session_id: 'abc', transcript_path: '', turn: 1 }, () => '', () => '')
  assert.equal(out, null)
})

test('stop_hook_active 为 true 时不拦，避免死循环', () => {
  const raw = [ev('assistant/message', 1, textOf(LEAK))].join('\n')
  const out = decide({ session_id: 'abc', stop_hook_active: true, turn: 1 }, () => '', () => raw)
  assert.equal(out, null)
})

test('以日志里的最后一轮为准，忽略调用方传入的旧轮次', () => {
  const raw = logOf(ev('assistant/message', 3, textOf(LEAK)),
    ev('assistant/message', 4, textOf('后来的正常回答')))
  assert.equal(lastAssistantText(raw, 3), '后来的正常回答')
  assert.equal(lastAssistantText(raw, 4), '后来的正常回答')
})

test('乱码回合 → 判定要 agent 重说', () => {
  const raw = logOf(ev('assistant/message', 9, textOf(LEAK)))
  const out = decide({ transcript_path: '/x/session.jsonl', turn: 9, stop_hook_active: false }, () => raw)
  assert.equal(out?.decision, 'block')
  assert.equal(out?.reason, RETRY_REASON)
})

test('正常回答不拦', () => {
  const raw = logOf(ev('assistant/message', 9, textOf('这是正常回答。')))
  assert.equal(decide({ transcript_path: '/x/session.jsonl', turn: 9 }, () => raw), null)
})

test('读不到日志时不拦（钩子失败不阻塞 agent）', () => {
  assert.equal(decide({ transcript_path: '/nope', turn: 1 }, () => ''), null)
})

test('stop_hook_active 为真时不再拦，避免死循环', () => {
  const raw = logOf(ev('assistant/message', 9, textOf(LEAK)))
  assert.equal(decide({ transcript_path: '/x', turn: 9, stop_hook_active: true }, () => raw), null)
})

test('坏 payload 不拦', () => {
  assert.equal(decide(null, () => LEAK), null)
  assert.equal(decide({}, () => LEAK), null)

test('末尾的助手回合夹在大量工具调用之后，仍能定位到那条乱码', () => {
  const raw = [
    ev('assistant/message', 3, textOf('End 键能滚到底部。')),
    JSON.stringify({ type: 'assistant/message', data: { turn: 3, message: { role: 'assistant', content: [{ type: 'tool-call', name: 'x' }] } } }),
    ev('assistant/message', 3, textOf(LEAK)),
  ].join('\n')
  assert.equal(isMarkerOnly(lastAssistantText(raw)), true)
  assert.deepEqual(decide({ transcript_path: '/fake', turn: 3 }, () => raw), {
    decision: 'block',
    reason: RETRY_REASON,
  })
})

test('同一轮里乱码后面还有正常正文时不拦（只处理纯乱码收尾）', () => {
  const raw = [ev('assistant/message', 3, textOf(LEAK)), ev('assistant/message', 3, textOf('已经跑完了。'))].join('\n')
  assert.equal(decide({ transcript_path: '/fake', turn: 3 }, () => raw), null)
})

})
