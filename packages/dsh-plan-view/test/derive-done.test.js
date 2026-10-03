/**
 * t.done/outOfScope 与 displayStatus 单一真相源的回归钉（2026-10-03 拍板）。
 *
 * 背景：done/outOfScope 与 displayStatus 的判据漂移过两次——2026-10-02
 * qa-skill-merge 首次实测（同一张票同时显示「✅ 收口」和「0%」），当日修法是
 * 「都走 hasSection」；但同日载体迁移给 displayStatus 加了第三条 done 路径
 * （正文 `**Status:** resolved` 行，plan-protocol §三 词表拍板），t.done 没跟上。
 * 2026-10-03 novel outline-prototype-consolidation 二次复发：11 张 to-tickets
 * 执行票（to-tickets 模板无 `## Answer` 节，收口=正文 Status 行）10 张 resolved，
 * Kanban 头部进度仍 0% 而 Done 列排满票。修复=deriveTicketStatus 构造完直接取
 * displayStatus 的结论，不再各写一份判据。
 *
 * 本钉断言**执行票形态**（无收口节）下 done 与 displayStatus 同步，并钉收口节
 * 优先级与 frontmatter 回退不回归。被测实现从构建产物 `lib/client.js` 提取，
 * 跑前需 `npx tsdown --config tsdown.standalone.ts`。跑 `node --test test/`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function grab(name) {
  const i = bundle.indexOf(`function ${name}(`)
  assert.ok(i >= 0, `lib/client.js 里找不到 ${name}——客户端未重建？先跑 tsdown`)
  let d = 0
  for (let k = bundle.indexOf('{', i); k < bundle.length; k++) {
    if (bundle[k] === '{') d++
    else if (bundle[k] === '}') { if (--d === 0) return bundle.slice(i, k + 1) }
  }
  throw new Error(`${name} 花括号不闭合`)
}

const src = [
  'parseFrontmatter', 'stripFences', 'hasSection', 'bodyField', 'ticketId',
  'normalizeRef', 'parseBlockedBy', 'parseAssetRefs', 'displayStatus', 'deriveTicketStatus',
].map(grab).join('\n')
const { deriveTicketStatus, displayStatus } = new Function(`${src}; return { deriveTicketStatus, displayStatus }`)()

// to-tickets 执行票模板形态：frontmatter 仅 type，无任何收口节（格式正本
// = to-tickets SKILL.md §5，收口动作 = 回写正文 Status 行）。
const EXEC = (status) => `---\ntype: task\n---\n\n# 01: 标题\n\n**What to build:** x\n\n**Blocked by:** None — can start immediately\n\n**Status:** ${status}\n\n## Acceptance\n\n- [x] 完成\n`

test('执行票正文 Status: resolved → done（无 Answer 节也不漏判，2026-10-03 复发病）', () => {
  const t = deriveTicketStatus('01-x.md', EXEC('resolved'))
  assert.equal(t.done, true)
  assert.equal(displayStatus(t), 'done')
})

test('执行票正文 Status: open → 未收口', () => {
  const t = deriveTicketStatus('01-x.md', EXEC('open'))
  assert.equal(t.done, false)
  assert.equal(displayStatus(t), 'open')
})

test('执行票正文 Status: claimed → claimed，不判 done', () => {
  const t = deriveTicketStatus('01-x.md', EXEC('claimed'))
  assert.equal(t.done, false)
  assert.equal(displayStatus(t), 'claimed')
})

test('推演票形态回归：Answer 节仍判 done（收口节优先不受影响）', () => {
  const raw = '---\ntype: research\n---\n\n# R1\n\n## Question\n\n?\n\n## Answer\n\n结论\n'
  const t = deriveTicketStatus('R1.md', raw)
  assert.equal(t.done, true)
  assert.equal(displayStatus(t), 'done')
})

test('Ruled out 节 → outOfScope（Status 行惰性，收口优先读）', () => {
  const raw = EXEC('open').replace('## Acceptance', '## Ruled out\n\n不做了\n\n## Acceptance')
  const t = deriveTicketStatus('01-x.md', raw)
  assert.equal(t.outOfScope, true)
  assert.equal(t.done, false)
  assert.equal(displayStatus(t), 'out_of_scope')
})

test('存量兼容：frontmatter status 回退仍生效（正文行缺席时）', () => {
  const raw = '---\ntype: task\nstatus: resolved\n---\n\n# 01: 标题\n\n正文\n'
  const t = deriveTicketStatus('01-x.md', raw)
  assert.equal(t.done, true)
})
