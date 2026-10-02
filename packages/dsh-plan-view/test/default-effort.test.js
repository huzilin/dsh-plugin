/**
 * 单图仓「自动进入唯一的图」的回归钉（2026-10-02 用户反馈）。
 *
 * 症状：全仓只有一张图时，地图 tab 默认停在「全部地图」（effortIdx = -1），而
 * mapdoc/specdoc 两个子页只在选中态才插入（PlanView 里 `selEffort` 判空）——
 * 于是单图用户永远看不到「🗺️ map / 📄 spec」，必须手动点一次芯片才出现。
 *
 * 这里钉两层：
 *   ① 选中规则 `defaultEffortIdx(n)`：只有恰好 1 张图才自动选中第 0 张；
 *      多图仓必须保持 -1（聚合视角有信息量，「优先选第一张」会静默藏起其余图的票）。
 *   ② 子页签插入判据：选中态下 map-only 图出 `mapdoc`、spec-only 图出 `specdoc`，
 *      未选中态（修复前的行为）两者都不出。①正确但②不成立，症状依旧。
 *
 * 函数从构建产物 `lib/client.js` 中提取（客户端是 lazy-CJS bundle，`.tsx` 源码
 * 无法被 node 直接 import），所以本测试跑之前需先 `npx tsdown --config tsdown.standalone.ts`。
 * 跑 `node --test test/` 即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSnapshot } from '../lib/server.js'

// 从 bundle 里抽出 defaultEffortIdx 的函数体求值——钉的是实际出货的那份实现，
// 不是源码里同名的另一份。
async function loadDefaultEffortIdx() {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const m = bundle.match(/function defaultEffortIdx\(effortCount\) \{\s*return ([^;]+);/)
  assert.ok(m, 'lib/client.js 里找不到 defaultEffortIdx——客户端未重建？先跑 tsdown')
  return new Function('effortCount', `return ${m[1]}`)
}

// 与 PlanView 子页签插入判据同构（源码 `selEffort === undefined ? [] : …`）。
const docSubTabs = (selEffort) => {
  if (selEffort === undefined) return []
  if (selEffort.mapRaw !== '') return ['mapdoc']
  return selEffort.specRaw ? ['specdoc'] : []
}

async function repoWith(rel, content = '') {
  const root = await mkdtemp(join(tmpdir(), 'planview-auto-'))
  const p = join(root, rel)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, content)
  return root
}

test('defaultEffortIdx auto-selects only when exactly one effort exists', async () => {
  const defaultEffortIdx = await loadDefaultEffortIdx()
  assert.equal(defaultEffortIdx(1), 0, '单图仓应自动选中第 0 张')
  assert.equal(defaultEffortIdx(0), -1, '零图仓无图可选，停在全部地图')
  assert.equal(defaultEffortIdx(2), -1, '多图仓保持全部地图聚合视角')
  assert.equal(defaultEffortIdx(7), -1, '多图仓保持全部地图聚合视角')
})

test('single map-effort repo shows the map sub-tab without a manual chip click', async () => {
  const defaultEffortIdx = await loadDefaultEffortIdx()
  // tracker 根自身含 map.md → 它自己就是唯一 effort（真实单图仓形态）。
  const snap = await collectSnapshot(await repoWith('.scratch/map.md', '# map\n## Destination\n做完\n'))
  assert.equal(snap.efforts.length, 1, '夹具应是恰好一张图的仓')

  // 修复前：恒 -1 → 子页签为空，用户必须点一次芯片。
  assert.deepEqual(docSubTabs(undefined), [], '未选中态不该有 map/spec 子页（这就是症状）')

  const idx = defaultEffortIdx(snap.efforts.length)
  assert.equal(idx, 0)
  assert.deepEqual(docSubTabs(snap.efforts[idx]), ['mapdoc'], '单图仓应直接出现 🗺️ map 子页')
})

test('single spec-only repo shows the spec sub-tab without a manual chip click', async () => {
  const defaultEffortIdx = await loadDefaultEffortIdx()
  // spec-only 实施图：有 spec.md、无 map.md（用户原话「里面有 spec 或 map」的另一支）。
  const root = await repoWith('.scratch/impl/spec.md', '# spec\n')
  await mkdir(join(root, '.scratch', 'impl', 'tickets'), { recursive: true })
  await writeFile(join(root, '.scratch', 'impl', 'tickets', '01-a.md'), '---\ntype: task\n---\n')
  const snap = await collectSnapshot(root)
  const sel = snap.efforts.find((e) => e.dir.endsWith('impl'))
  assert.ok(sel, 'spec-only 图应被收集为 effort')
  assert.equal(sel.mapRaw, '')
  assert.equal(sel.specRaw, '# spec\n')
  // 接线核对：spec-only 图在选中态出 specdoc（而非 mapdoc）。
  assert.deepEqual(docSubTabs(sel), ['specdoc'], 'spec-only 单图仓应直接出现 📄 spec 子页')
})

test('multi-effort repo keeps the aggregate view (no silent hiding of other maps)', async () => {
  const defaultEffortIdx = await loadDefaultEffortIdx()
  const root = await repoWith('.scratch/map.md', '# map\n')
  await mkdir(join(root, '.scratch', 'second'), { recursive: true })
  await writeFile(join(root, '.scratch', 'second', 'map.md'), '# map2\n')
  const snap = await collectSnapshot(root)
  assert.ok(snap.efforts.length >= 2, '夹具应是多图仓')
  assert.equal(defaultEffortIdx(snap.efforts.length), -1, '多图仓不得自动选中，否则其余图的票被藏起')
})
