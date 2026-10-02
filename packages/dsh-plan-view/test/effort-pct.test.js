/**
 * 图进度百分比的口径回归钉（2026-10-02 用户拍板两条变更）。
 *
 * 变更① 四类单据全计：分母从「只数工单」扩为 `ticket`/`approval`/`ledger`/
 *        `qa-defect` 全计，完成判据**各按自己坐标系**（协议明文「四套状态机互不
 *        套用」）：ticket=正文 ## Answer 带正文；approval=不再 pending；ledger=
 *        已销/已转票；qa-defect=已关闭。
 * 变更② 实施图缺 `qa/cases.md` → 完成度**封顶 80%**（用户选定「封顶」而非加权）。
 *
 * 另钉住票态推导已切到**唯一真相源**（plan-protocol §三 推导形态）：只看正文
 * 收束节，不再读 frontmatter `status` 别名词表（done/closed/complete/… 已删）。
 *
 * 被测实现从构建产物抽取（`.tsx` 无法被 node 直接 import），
 * 跑之前需先 `npx tsdown --config tsdown.standalone.ts`。跑 `node --test test/`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSnapshot } from '../lib/server.js'

// 从产物里抽取实现所需的一整套函数与常量。抽取失败要**显式报错**——静默抽空会
// 变成「测试恒过」的假保护（本次开发中真的踩过：漏抽 isPending 导致 ticketKind
// 抛错、漏抽常量导致全部判成 note，都被错误地当成「结果是 0%」）。
async function loadImpl() {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const grab = (n) => {
    const i = b.indexOf(`function ${n}(`)
    if (i >= 0) {
      let d = 0
      for (let k = b.indexOf('{', i); k < b.length; k++) {
        if (b[k] === '{') d++
        else if (b[k] === '}') { d--; if (d === 0) return b.slice(i, k + 1) }
      }
    }
    // 箭头函数：`const n = (...) => (...)`，表达式里可能含 `??`、分号等，
    // 故按「到该行末的分号」截取，不能用 `[^;]+` 草率匹配。
    const m = b.match(new RegExp(`const ${n} = \\([^)]*\\) => [^\\n]*;`))
    if (m) return m[0]
    throw new Error(`产物里抽不到 ${n} —— 客户端未重建？先跑 tsdown`)
  }
  const cut = (marker, end) => {
    const i = b.indexOf(marker)
    assert.ok(i >= 0, `产物里找不到常量 ${marker}`)
    return b.slice(i, b.indexOf(end, i) + end.length)
  }
  let code = ''
  code += cut('const LEDGER_STATES = [', ']') + ';'
  code += cut('const DEFECT_CLOSED =', ');') + ';'
  code += cut('const TICKET_TYPES =', ');') + ';'
  code += cut('const ROOT_GROUP =', ';') + ';'
  for (const n of ['stripFences', 'hasSection', 'statusWord', 'isPending', 'displayStatus',
    'parseLedgerEntries', 'parseDefectEntries', 'parseDefectFile', 'defectStateWord',
    'ticketKind', 'isSettled', 'isSpecArchived', 'effortProgress',
    // 2026-10-02 载体迁移新增：票的 status 现从正文读取，解析链需要这两个。
    'bodyField']) code += grab(n) + '\n'
  code += 'return { effortPct: (o,d,c,k,s) => effortProgress(o,d,c,k,s).pct, effortProgress, displayStatus, ticketKind, hasSection, isSpecArchived, bodyField }'
  return new Function(code)()
}

const W = async (root, rel, content) => {
  const p = join(root, rel)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, content)
}
const ANSWER = '---\ntype: task\n---\n\n# t\n\n## Answer\n\n做完了\n'
const OPEN = '---\ntype: task\n---\n\n# t\n\n正文\n'

// 建真实临时仓并跑真实收集器；再把 snapshot 复原成客户端形态的票对象。
// status 走**与生产同一套规则**（2026-10-02：正文 `**Status:**` 优先，frontmatter
// 回退）——用 extractor 里那份 bodyField，别在测试里另写一份正则（两处会漂移）。
async function fixture(files) {
  const M = await loadImpl()
  const root = await mkdtemp(join(tmpdir(), 'effort-pct-'))
  await W(root, '.scratch/alpha/map.md', '# map\n')
  for (const [rel, c] of files) await W(root, rel, c)
  const snap = await collectSnapshot(root)
  const dir = snap.efforts[0].dir // 真实 effort dir 是绝对路径
  const tickets = snap.files.filter(f => /\.md$/.test(f.name)).map(f => {
    const m = f.content.match(/^---\n([\s\S]*?)\n---/)
    const fm = m ? m[1] : ''
    const body = m ? f.content.slice(m[0].length) : f.content
    const gv = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim()
    return {
      file: f.name, id: f.name.replace(/\.md$/, ''), title: f.name,
      type: gv('type'), status: M.bodyField(body, 'Status') ?? gv('status'), body,
      claimedBy: gv('claimed_by'), outOfScope: false, blockedBy: [], assets: [],
      effort: dir,
    }
  })
  return { dir, tickets }
}

const pctOf = async (files) => {
  const M = await loadImpl()
  const { dir, tickets } = await fixture(files)
  const cases = tickets.filter(t => /cases\.md$/.test(t.file))
  return M.effortPct(tickets, dir, cases, 'impl')
}

test('all four document types count toward the denominator', async () => {
  // 每例都是「2 张 done 工单 + 1 张未结案单据」→ 2/3 = 67%。
  // 旧口径只数工单，三例都会算成 100%——正是本条要钉的差别。
  const UNSETTLED = [
    ['pending 待拍板', '.plan/approval/待拍板-x.md', '---\ntype: approval\nstatus: pending\n---\n\n# t\n'],
    ['在挂台账', '.scratch/alpha/ledger/挂账-01.md', '---\ntype: ledger\n---\n\n# 挂账-01 x\n- 状态: 在挂\n- 卡点: y\n'],
    ['待修复缺陷', '.scratch/alpha/qa/DEF-x-01.md', '---\ntype: qa-defect\n---\n\n# DEF-01 x\n- 严重度: 高\n- 状态: 待修复\n'],
  ]
  for (const [name, rel, content] of UNSETTLED) {
    const pct = await pctOf([
      ['.scratch/alpha/tickets/01-a.md', ANSWER],
      ['.scratch/alpha/tickets/02-b.md', ANSWER],
      [rel, content],
    ])
    assert.equal(pct, 67, `未结案的${name}必须计入分母（旧口径只数工单 = 100%）`)
  }
})

test('settled forms of each type count as complete', async () => {
  // 工单 done + 审批 closed + 缺陷已关闭 → 三者全结案 = 100% 票分；
  // 但该图缺 cases.md，实施图封顶 80%。
  const pct = await pctOf([
    ['.scratch/alpha/tickets/01-a.md', ANSWER],
    ['.plan/approval/已拍板-x.md', '---\ntype: approval\nstatus: closed\n---\n\n# t\n'],
    ['.scratch/alpha/qa/DEF-x-01.md', '---\ntype: qa-defect\n---\n\n# DEF-01 x\n- 状态: 已关闭\n'],
  ])
  assert.equal(pct, 80, '三者都已结案 → 票分 100%，但缺 cases.md 封顶 80')
  // 对照：把审批换成仍 pending，应掉到 67%
  const mixed = await pctOf([
    ['.scratch/alpha/tickets/01-a.md', ANSWER],
    ['.plan/approval/待拍板-x.md', '---\ntype: approval\nstatus: pending\n---\n\n# t\n'],
    ['.scratch/alpha/qa/DEF-x-01.md', '---\ntype: qa-defect\n---\n\n# DEF-01 x\n- 状态: 已关闭\n'],
  ])
  assert.equal(mixed, 67, 'pending 审批应把已结案的 3 项拉低到 2/3')
})

test('implementation map without qa/cases.md caps at 80%', async () => {
  const capped = await pctOf([
    ['.scratch/alpha/tickets/01-a.md', ANSWER],
    ['.scratch/alpha/tickets/02-b.md', ANSWER],
  ])
  assert.equal(capped, 80, '实施图缺测例：全做完也只有 80%')
  // 有 cases.md 则放开
  const full = await pctOf([
    ['.scratch/alpha/tickets/01-a.md', ANSWER],
    ['.scratch/alpha/tickets/02-b.md', ANSWER],
    ['.scratch/alpha/qa/cases.md', '# cases\n\n| A-1 | x |\n'],
  ])
  assert.equal(full, 100, '有 cases.md 时应达 100%')
})

test('closure is read first: a closing section outranks the Status line', async () => {
  const M = await loadImpl()
  // 正文 `**Status:** resolved` 但**无收束节** → 仍算完成（写手的意图明确）。
  const { dir, tickets } = await fixture([
    ['.scratch/alpha/tickets/01-a.md', '# t\n\n**Status:** resolved\n\n正文\n'],
  ])
  const t = tickets[0]
  assert.equal(M.displayStatus(t), 'done', '正文 Status: resolved 应被识别为完成')
  // 反之：有 `## Answer` 时，`Status:` 行是惰性残留，不得把它拉回 open
  const { tickets: t2 } = await fixture([
    ['.scratch/alpha/tickets/02-b.md', '# t\n\n**Status:** open\n\n## Answer\n结论\n'],
  ])
  assert.equal(M.displayStatus(t2[0]), 'done', '收束节优先于 Status 行')
})

test('legacy frontmatter status is still read (pre-migration docs must not break)', async () => {
  const M = await loadImpl()
  // 迁移前的票把状态写在 frontmatter；回扫完成前页面不能瞎。
  const { tickets } = await fixture([
    ['.scratch/alpha/tickets/01-a.md', '---\ntype: task\nstatus: open\n---\n\n# t\n\n正文\n'],
  ])
  assert.equal(M.displayStatus(tickets[0]), 'open', '存量 frontmatter status: open 仍可读')
})

test('hasSection ignores headings quoted inside fenced code blocks', async () => {
  const M = await loadImpl()
  // 协议点名的坑：讨论票格式的票会在正文里引用 `## Answer`
  const quoted = '# t\n\n## Question\n格式例如：\n\n```\n## Answer\n结论\n```\n'
  assert.equal(M.hasSection(quoted, 'Answer'), false, '围栏内引用的 ## Answer 不得让票自我收口')
  // 单向豁免：收束节整块是围栏仍算写过
  const fencedBody = '# t\n\n## Question\nq\n\n## Answer\n```\n交付要点\n```\n'
  assert.equal(M.hasSection(fencedBody, 'Answer'), true, '收束节整块为围栏仍算写过')
})

// ─── 2026-10-02 新增两条 ────────────────────────────────────────────────────

const SPEC_ARCHIVED = '---\ntype: spec\ndate: 2026-09-27\nstatus: superseded-by:docs/architecture.md\norigin: retrospective\n---\n\n# spec\n'
const SPEC_OPEN = '# spec\n\n## Problem Statement\n正文\n'

test('implementation map counts spec.md as one slot until it is archived', async () => {
  const M = await loadImpl()
  const T = (body) => ({
    file: 'x.md', id: 'x', title: 'x', type: 'task', status: undefined, body,
    claimedBy: undefined, outOfScope: false, effort: 'D', blockedBy: [], assets: [],
  })
  const ANS = T('# t\n\n## Answer\n\nx')
  const cases = [{ effort: 'D' }]
  const p = (n, spec) => M.effortProgress(Array.from({ length: n }, () => ANS), 'D', cases, 'impl', spec).pct

  // 票全做完但 spec 未归档 → 差一项，到不了 100%
  assert.equal(p(4, SPEC_OPEN), 80, '4 票全完 + spec 未归档 = 4/5')
  assert.equal(p(4, SPEC_ARCHIVED), 100, 'spec 归档后才是 5/5')
  assert.equal(p(2, SPEC_OPEN), 67, '2 票全完 + spec 未归档 = 2/3')
  // 没有 spec.md 时不占名额（spec-only 之外的图、或未写 spec 的图）
  assert.equal(p(2, undefined), 100, '无 spec 文件则不占名额')
  // 推演图不计 spec（推演图本就没有 spec.md）
  const spec = M.effortProgress([ANS, ANS], 'D', cases, 'speculation', SPEC_OPEN)
  assert.equal(spec.pct, 100, '推演图不计 spec')
  assert.equal(spec.specCounted, false, '推演图 specCounted 应为 false')
})

test('isSpecArchived only honours the two protocol-sanctioned locations', async () => {
  const M = await loadImpl()
  assert.equal(M.isSpecArchived(SPEC_ARCHIVED), true, 'frontmatter status: superseded-by 应判为已归档')
  assert.equal(M.isSpecArchived(SPEC_OPEN), false, '无标记应判为未归档')
  assert.equal(M.isSpecArchived(undefined), false, '无 spec 文件不算已归档')
  // 头部 10 行内的引用块形态（协议允许的第二处）。
  assert.equal(M.isSpecArchived('# spec\n\n> superseded-by: docs/architecture.md\n\n## P\n'), true, '头部引用块应判为已归档')
  // 协议明写「埋正文深处不算」——否则一份「提及」别人被取代的 spec 会自我误判。
  const buried = '# spec\n\n' + 'x\n'.repeat(20) + 'status: superseded-by:y\n'
  assert.equal(M.isSpecArchived(buried), false, '10 行之后的标记不算（协议明写）')
})

test('locked flag marks a structural ceiling that cannot be reached', async () => {
  const M = await loadImpl()
  const T = (body) => ({
    file: 'x.md', id: 'x', title: 'x', type: 'task', status: undefined, body,
    claimedBy: undefined, outOfScope: false, effort: 'D', blockedBy: [], assets: [],
  })
  const ANS = T('# t\n\n## Answer\n\nx')
  // 缺测例 → locked，且封顶 80%
  const noCases = M.effortProgress([ANS, ANS], 'D', [], 'impl', SPEC_ARCHIVED)
  assert.equal(noCases.locked, true, '缺测例应置 locked')
  assert.equal(noCases.pct, 80, '缺测例封顶 80')
  // 有测例 → 不 locked
  const withCases = M.effortProgress([ANS, ANS], 'D', [{ effort: 'D' }], 'impl', SPEC_ARCHIVED)
  assert.equal(withCases.locked, false, '有测例不应 locked')
  assert.equal(withCases.pct, 100)
  // 推演图不参与测例口径
  assert.equal(M.effortProgress([ANS], 'D', [], 'speculation', undefined).locked, false, '推演图不置 locked')
  // 当前进度低于上限时，locked 仍应为 true——它标的是「结构性缺口存在」，
  // 而非「此刻被截断」；后者会让标识在半途忽然消失，读作问题已解决。
  // 1 done + 1 open 且 spec 已归档 ⇒ 分子 1(done)+1(spec) / 分母 2+1 = 67%。
  const low = M.effortProgress([ANS, T('# t\n\n正文')], 'D', [], 'impl', SPEC_ARCHIVED)
  assert.equal(low.pct, 67, '已归档的 spec 也计入分子，故是 2/3 而非 1/2')
  assert.equal(low.locked, true, '进度低于上限也要标出结构性缺口')
})
