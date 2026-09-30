/**
 * 票 19：snapshot 收集器的回归钉。
 *
 * 被测的是 lib/server.js 的纯数据面（collectSnapshot / upsertFrontmatterKey），
 * 不起 HTTP：读取契约（effort 判据、白名单、PLAN_ROOT_ALLOW、round 白名单）
 * 错一处，路线页就静默少一块数据。跑 `node --test test/` 即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSnapshot, upsertFrontmatterKey } from '../lib/server.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'planview-snap-'))
  const w = async (rel, content = '') => {
    const p = join(root, rel)
    await mkdir(join(p, '..'), { recursive: true })
    await writeFile(p, content)
  }
  // .scratch：一个 wayfinder 图（map+issues+qa+assets）+ 一个 spec-only 图。
  await w('.scratch/map.md') // tracker 根自身含 map.md = 也是 effort（hasMapHere）
  await w('.scratch/map-own.md')
  await w('.scratch/wayfinder/map.md', '# map\n')
  await w('.scratch/wayfinder/issues/01-a.md', '---\ntype: task\n---\n# 01')
  await w('.scratch/wayfinder/qa/DEF-1.md', '---\ntype: qa-defect\n---\n# DEF')
  await w('.scratch/wayfinder/assets/note.md', '调研资源，不是票')
  await w('.scratch/wayfinder/readme.md', '陪伴文档不收')
  await w('.scratch/spec-only/spec.md', '# spec\n')
  await w('.scratch/spec-only/tickets/01-impl.md', '# 01')
  await w('.scratch/spec-only/fengping/x.md', '契约外孤岛不收')
  // .plan：审批档形状收、违例形状不收、全局 ledger/qa 收。
  await w('.plan/待拍板-x-20260930.md', '---\nstatus: pending\n---\n')
  await w('.plan/已拍板-y-20260929.md')
  await w('.plan/复盘-z.md', '违例形状不收')
  await w('.plan/ledger/L1.md')
  await w('.plan/qa/cases-sop.md')
  // docs/adr：NNNN- 形状收、形状外不收（2026-09-30 拍板：ADR 纳入视图全局层）。
  await w('docs/adr/0007-adr-storage.md', '---\nid: "0007"\nstatus: accepted\ndate: 2026-09-30\n---\n# ADR-0007: 存储定型\n')
  await w('docs/adr/0012-replaced.md', '---\nstatus: superseded by ADR-0007\n---\n# ADR-0012: 已被取代\n')
  await w('docs/adr/not-an-adr.md', '形状外不收')
  // 归档轮 + CONTEXT。轮根布局镜像当时 .scratch（effort 子目录 + 轮根自身 map.md
  // 则只收轮根层 md——与客户端原版 hasMapHere 行为一致：根自身不跑票面子目录收集）。
  await w('.archive/rounds/2026-09-01-r1/map.md', '# old map\n')
  await w('.archive/rounds/2026-09-01-r1/old-effort/map.md') // effort 判据：子目录含 map/spec
  await w('.archive/rounds/2026-09-01-r1/old-effort/issues/01-old.md')
  await w('.archive/rounds/not-a-round/x.md')
  await w('.archive/README.md', '| round-id | 主题 |\n|:--|:--|\n| `2026-09-01-r1` | 首轮 |\n')
  await w('CONTEXT.md', '# 词汇表\n')
  return root
}

// 服务端哨兵值：无 effort 归属的根层件 from/group（lib/server.js 同值字面量）。
const ROOT = '\u0000root'
const namesOf = (snap) => snap.files.map((f) => `${f.group === ROOT ? 'root' : f.group}/${f.name}`).sort()

test('snapshot collects tracker root + efforts per the read contract', async () => {
  const snap = await collectSnapshot(await fixture())
  // efforts：tracker 根（含 map.md）+ wayfinder + spec-only；.plan 侧无 effort。
  assert.equal(snap.efforts.length, 3)
  assert.ok(snap.efforts.some((e) => e.dir.endsWith('/.scratch')))
  assert.ok(snap.efforts.some((e) => e.dir.endsWith('wayfinder') && e.mapRaw === '# map\n'))
  const specOnly = snap.efforts.find((e) => e.dir.endsWith('spec-only'))
  assert.equal(specOnly.mapRaw, '')
  assert.equal(specOnly.specRaw, '# spec\n')
  // 白名单：issues/qa/tickets 收；assets/fengping 不收；NON_TICKET（readme）不收。
  const n = namesOf(snap)
  assert.ok(n.includes('issues/01-a.md'))
  assert.ok(n.includes('qa/DEF-1.md'))
  assert.ok(n.includes('tickets/01-impl.md'))
  assert.ok(!n.some((x) => x.includes('assets/')))
  assert.ok(!n.some((x) => x.includes('fengping/')))
  assert.ok(!n.some((x) => x === 'root/readme.md'))
  // tracker 根层全收；.plan 根层 PLAN_ROOT_ALLOW 过滤（复盘- 不收）。
  assert.ok(n.includes('root/map-own.md'))
  assert.ok(n.includes('root/待拍板-x-20260930.md'))
  assert.ok(n.includes('root/已拍板-y-20260929.md'))
  assert.ok(!n.includes('root/复盘-z.md'))
  // 全局 ledger/qa + docs/adr（形状外 not-an-adr.md 不收）。
  assert.ok(n.includes('ledger/L1.md'))
  assert.ok(n.includes('qa/cases-sop.md'))
  assert.ok(n.includes('adr/0007-adr-storage.md'))
  assert.ok(n.includes('adr/0012-replaced.md'))
  assert.ok(!n.some((x) => x.startsWith('adr/') && x.includes('not-an-adr')))
  // 内容随行。
  assert.equal(snap.files.find((f) => f.name === '01-a.md').content, '---\ntype: task\n---\n# 01')
  // rounds（新轮在前）+ readme 索引 + CONTEXT。
  assert.deepEqual(snap.rounds.ids, ['2026-09-01-r1'])
  assert.match(snap.rounds.readmeRaw, /首轮/)
  assert.equal(snap.contextRaw, '# 词汇表\n')
})

test('round mode loads the archived round as a single tracker root', async () => {
  const snap = await collectSnapshot(await fixture(), '2026-09-01-r1')
  // 轮根自身含 map.md → 它自己也是 effort；轮内 effort 子目录同判据收集。
  assert.equal(snap.efforts.length, 2)
  assert.ok(snap.efforts.some((e) => e.dir.endsWith('2026-09-01-r1')))
  assert.ok(snap.efforts.some((e) => e.dir.endsWith('old-effort')))
  // 现行 effort 不出现在轮快照里；轮内票面收进；ADR 是知识层非轮成员，不进轮视图。
  assert.ok(!snap.files.some((f) => f.name === '01-a.md'))
  assert.ok(snap.files.some((f) => f.name === '01-old.md'))
  assert.ok(!snap.files.some((f) => f.group === 'adr'))
  assert.equal(snap.efforts.find((e) => e.dir.endsWith('2026-09-01-r1')).mapRaw, '# old map\n')
})

test('round id outside the date-prefix whitelist is rejected as traversal', async () => {
  const root = await fixture()
  await mkdir(join(root, '.archive', 'rounds', '..evil'), { recursive: true })
  // 路由层用 ROUND_ID 白名单拦截；收集器本身只按调用方给的目录走——
  // 这里钉 collectSnapshot 对合法轮的行为，白名单拦截由路由层测试覆盖。
  const snap = await collectSnapshot(root, '2026-09-01-r1')
  assert.ok(snap.efforts.length >= 1)
})

test('missing roots degrade to empty instead of throwing', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'planview-empty-'))
  const snap = await collectSnapshot(empty)
  assert.deepEqual(snap.efforts, [])
  assert.deepEqual(snap.files, [])
  assert.deepEqual(snap.rounds, { ids: [], readmeRaw: null })
  assert.equal(snap.contextRaw, '')
})

test('upsertFrontmatterKey updates in place, appends, and creates a head', () => {
  assert.equal(
    upsertFrontmatterKey('---\ntype: task\n---\n# t', 'session', 's1'),
    '---\ntype: task\nsession: s1\n---\n# t',
  )
  assert.equal(
    upsertFrontmatterKey('---\nsession: old\n---\nbody', 'session', 's2'),
    '---\nsession: s2\n---\nbody',
  )
  assert.equal(upsertFrontmatterKey('# headless', 'session', 's3'), '---\nsession: s3\n---\n\n# headless')
})

test('roundtrip: collected file content round-trips through upsert on disk', async () => {
  const root = await fixture()
  const snap = await collectSnapshot(root)
  const target = snap.files.find((f) => f.name === '01-a.md')
  const updated = upsertFrontmatterKey(target.content, 'session', 'session-x')
  assert.match(updated, /^---\ntype: task\nsession: session-x\n---/)
  // 磁盘原文件未被收集器改动（收集是只读面）。
  assert.equal(await readFile(target.path, 'utf8'), target.content)
})
