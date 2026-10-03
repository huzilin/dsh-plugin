/**
 * 工单数字序号排序的回归钉（2026-10-03 用户需求：工单展示按前面数字序号）。
 *
 * 背景：票序曾 = 服务端 fs 枚举序——APFS/Ext4 的目录序都不是字母序，Kanban
 * 列内卡片实为随机序（`10-…` 可能排在 `02-…` 前）。修法 = assemblePlanData
 * 装配时单处排序，Kanban/关系图/表格默认序全部继承：
 *   - 键 = (字母前缀, 数字值, 文件名)，数字按值比（`2` < `10`，非字符串序）；
 *   - 纯数字票（前缀空）在字母前缀票（`R12`/`W3`）之前；
 *   - 无数字票（`notes`/`cases`）垫底按文件名兜底；
 *   - effort 首键：聚合态各图编号各自从 01 起，保持按图分组、组内升序。
 *
 * 被测实现从构建产物 `lib/client.js` 提取，跑前需
 * `npx tsdown --config tsdown.standalone.ts`。跑 `node --test test/`。
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
const cut = (marker, end) => {
  const i = bundle.indexOf(marker)
  assert.ok(i >= 0, `产物里找不到常量 ${marker}`)
  return bundle.slice(i, bundle.indexOf(end, i) + end.length)
}

const id = (s) => ({ id: s })
const idsOf = (arr) => arr.map(t => t.id)

// ─── 比较器单测 ────────────────────────────────────────────────────────────────

const { compareTicketSeq, assemblePlanData } = new Function(`
${cut('const ROOT_GROUP =', ';')};
${cut('const TICKET_TYPES =', ');')};
${['stripFences', 'hasSection', 'bodyField', 'parseFrontmatter', 'ticketId', 'normalizeRef',
   'parseBlockedBy', 'parseAssetRefs', 'displayStatus', 'deriveTicketStatus', 'statusWord',
   'ticketKind', 'ticketSeqKey', 'compareTicketSeq', 'assemblePlanData'].map(grab).join('\n')}
return { compareTicketSeq, assemblePlanData }
`)()

test('数字按值比：2 < 10（字符串序会把 10 排在 2 前）', () => {
  const sorted = ['10-单号校验', '2-响应协议', '01-需求分析'].map(id).sort(compareTicketSeq)
  assert.deepEqual(idsOf(sorted), ['01-需求分析', '2-响应协议', '10-单号校验'])
})

test('两位以上补零位不乱：99 < 100', () => {
  const sorted = ['100-大', '99-近'].map(id).sort(compareTicketSeq)
  assert.deepEqual(idsOf(sorted), ['99-近', '100-大'])
})

test('纯数字票在字母前缀票之前，同前缀组内按数字', () => {
  const sorted = ['W3-写作台', 'R12-定稿管线', '02-甲', 'R2-路线', '01-乙'].map(id).sort(compareTicketSeq)
  assert.deepEqual(idsOf(sorted), ['01-乙', '02-甲', 'R2-路线', 'R12-定稿管线', 'W3-写作台'])
})

test('无数字票垫底，按文件名兜底', () => {
  const sorted = ['notes', '01-工单', 'readme'].map(id).sort(compareTicketSeq)
  assert.deepEqual(idsOf(sorted), ['01-工单', 'notes', 'readme'])
})

// ─── assemblePlanData 集成：乱序输入 → 出口有序 ───────────────────────────────

const md = (body = '正文') => `---\ntype: task\n---\n\n# t\n\n${body}\n`

test('装配出口全序：effort 分组 + 组内序号升序（fs 乱序输入）', () => {
  // 模拟 APFS 枚举序：跨 effort 交错 + 组内乱序。
  const snap = {
    cwd: '/x',
    efforts: [],
    files: [
      { path: '/x/.scratch/b-map/10-d.md', name: '10-d.md', from: '/x/.scratch/b-map', group: 'issues', content: md() },
      { path: '/x/.scratch/a-map/2-c.md', name: '2-c.md', from: '/x/.scratch/a-map', group: 'issues', content: md() },
      { path: '/x/.scratch/b-map/2-b.md', name: '2-b.md', from: '/x/.scratch/b-map', group: 'issues', content: md() },
      { path: '/x/.scratch/a-map/10-a.md', name: '10-a.md', from: '/x/.scratch/a-map', group: 'issues', content: md() },
      { path: '/x/.scratch/a-map/1-e.md', name: '1-e.md', from: '/x/.scratch/a-map', group: 'issues', content: md() },
    ],
    rounds: { ids: [], readmeRaw: null },
    contextRaw: '',
  }
  const got = idsOf(assemblePlanData(snap).tickets)
  assert.deepEqual(got, ['1-e', '2-c', '10-a', '2-b', '10-d'])
})

test('排序不改变票据分类：approval/defect 照常识别', () => {
  const snap = {
    cwd: '/x',
    efforts: [],
    files: [
      { path: '/x/.scratch/m/03-拍板.md', name: '03-拍板.md', from: '/x/.scratch/m', group: 'issues',
        content: '---\ntype: approval\nstatus: pending\n---\n\n# 拍板\n\n待拍\n' },
      { path: '/x/.scratch/m/01-工单.md', name: '01-工单.md', from: '/x/.scratch/m', group: 'issues', content: md() },
      { path: '/x/.scratch/m/qa/DEF-2-缺陷.md', name: 'DEF-2-缺陷.md', from: '/x/.scratch/m', group: 'qa',
        content: '---\ntype: qa-defect\nstatus: open\n---\n\n# 缺陷\n\n描述\n' },
    ],
    rounds: { ids: [], readmeRaw: null },
    contextRaw: '',
  }
  const d = assemblePlanData(snap)
  assert.deepEqual(idsOf(d.tickets), ['01-工单', '03-拍板', 'DEF-2-缺陷'])
  assert.equal(d.tickets[1].status, 'pending')
})
