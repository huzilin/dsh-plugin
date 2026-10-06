/**
 * 视图分层可见性回归钉（2026-10-07 用户口径）。
 *
 * 背景：novel 一份**全局**待拍板档（`.plan/approval/待拍板-票11…`）在**每张图**的
 * 「⏳ 待拍板」子页里都出现——它讲的是 `character-domain-revamp` 一张图的票 11，
 * 却在另外两张图下也看得见。用户裁定：
 *
 * > 参考缺陷、测例等，全局是全局的那一层可见，地图是 effort 层可见。
 *
 * 根因：图归属判据 `inEffort` 曾对 `ROOT_GROUP`（`.plan` 侧无图归属件）恒真——那是
 * 2026-09-19 为「挂账台账住在 `.plan/` 根层」开的通行证；2026-09-25 台账/缺陷分层、
 * 2026-09-29「全局件」封闭清单落地后，该通行证只剩待拍板/测例两处，成了分层泄漏。
 *
 * 被测物是**构建产物**（`lib/client.js`）。跑之前需先
 * `npx tsdown --config tsdown.standalone.ts`。跑 `node --test test/`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** 从产物里抽取两个纯判据函数（配平花括号），连同 ROOT_GROUP 字面量一起求值。 */
async function loadPredicates() {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const grab = (n) => {
    const i = b.indexOf(`function ${n}(`)
    assert.ok(i >= 0, `产物里抽不到 ${n} —— 客户端未重建？先跑 tsdown`)
    let d = 0
    for (let k = b.indexOf('{', i); k < b.length; k++) {
      if (b[k] === '{') d++
      else if (b[k] === '}') { d--; if (d === 0) return b.slice(i, k + 1) }
    }
    throw new Error(`函数 ${n} 花括号不配平`)
  }
  const rootIdx = b.indexOf('const ROOT_GROUP =')
  assert.ok(rootIdx >= 0, '产物里找不到 ROOT_GROUP')
  const rootGroup = b.slice(rootIdx, b.indexOf(';', rootIdx) + 1)
  const code = `${rootGroup}\n${grab('inEffort')}\n${grab('inMapLayer')}\nreturn { ROOT_GROUP, inEffort, inMapLayer }`
  return { bundle: b, ...new Function(code)() }
}

const DIR_A = '/repo/.scratch/effort-a'
const DIR_B = '/repo/.scratch/effort-b'

test('inEffort：图归属只看自身目录，全局件不属于任何图', async () => {
  const { ROOT_GROUP, inEffort } = await loadPredicates()
  const own = { effort: DIR_A }
  const other = { effort: DIR_B }
  const global = { effort: ROOT_GROUP }

  assert.equal(inEffort(own, DIR_A), true, '本图件应属本图')
  assert.equal(inEffort(other, DIR_A), false, '别图件不属本图')
  assert.equal(inEffort(global, DIR_A), false,
    '全局件不属任何图 —— 旧口径 `t.effort === dir || t.effort === ROOT_GROUP` 会在这里返回 true')
})

test('inMapLayer：地图页不含全局件；「全部地图」态是各图合计', async () => {
  const { ROOT_GROUP, inMapLayer } = await loadPredicates()
  const own = { effort: DIR_A }
  const other = { effort: DIR_B }
  const global = { effort: ROOT_GROUP }

  // 选中 effort-a
  assert.equal(inMapLayer(own, 0, DIR_A), true, '选中本图 → 本图件可见')
  assert.equal(inMapLayer(other, 0, DIR_A), false, '选中本图 → 别图件不可见')
  assert.equal(inMapLayer(global, 0, DIR_A), false,
    '选中本图 → 全局件不可见（本轮缺陷：全局待拍板档在每张图下都出现）')
  // 「全部地图」（effortIdx = -1）
  assert.equal(inMapLayer(own, -1, undefined), true, '全部地图 → 各图件合计')
  assert.equal(inMapLayer(other, -1, undefined), true, '全部地图 → 各图件合计')
  assert.equal(inMapLayer(global, -1, undefined), false,
    '全部地图 → 仍不含全局件（与缺陷/台账两页既有口径一致）')
})

test('旧口径清零：产物中不得再出现「图筛选放行 ROOT_GROUP」的写法', async () => {
  const { bundle } = await loadPredicates()
  // 旧形状：`t.effort === dir || t.effort === ROOT_GROUP`（inEffort 内）、
  //         `t.effort === selectedDir || t.effort === ROOT_GROUP`（地图页内联）。
  const legacy = [
    /effort === dir \|\| [A-Za-z_$][\w$]*\.effort === ROOT_GROUP/,
    /effort === selectedDir \|\| [A-Za-z_$][\w$]*\.effort === ROOT_GROUP/,
  ]
  for (const re of legacy) {
    const hit = bundle.match(re)
    assert.equal(hit, null, `产物里仍有旧口径写法：${hit?.[0]}`)
  }
})

test('地图页五处子页数据源都走 inMapLayer（防只改判据不改调用点）', async () => {
  const { bundle } = await loadPredicates()
  const uses = bundle.match(/inMapLayer\(t, effortIdx, selectedDir\)/g) ?? []
  assert.ok(uses.length >= 5,
    `地图页子页数据源应有 ≥5 处调用 inMapLayer（工单/待拍板/台账/缺陷/测例），实际 ${uses.length} 处`)
})
