/**
 * markdown 表格「最小格宽 + 横向滚动」的回归钉（2026-10-02 用户反馈）。
 *
 * 症状：表格列被压到只剩表头文字宽（实测短列仅 45px），且不横向滚动——单元格
 * 内容被硬挤成多行。根因是两条 CSS：
 *   ① `width:100%` 让表恒等于容器宽，永不溢出 → `pvm-tw` 的 overflow:auto 无物可滚；
 *   ② th 有 white-space:nowrap、td 没有 → 表头不折行、正文折行，列被压到表头宽。
 *
 * 修法（两条缺一不可，故此处逐条钉住）：
 *   - `width:max-content` + `min-width:100%`：表按内容定宽（不再被压缩），短表仍铺满容器；
 *   - th/td 的 `min-width`（最小格宽本体）+ td 的 `max-width`/`word-break`
 *     （给超长单元格封顶并允许折行，避免单列无限伸长）。
 *
 * 钉在构建产物上——跑之前需先 `npx tsdown --config tsdown.standalone.ts`。
 * 跑 `node --test test/` 即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// MD_CSS 是运行时模板字符串，产物里保留 `${CONST}` 原样；这里抽出模板文本后
// 把插值替换成任意占位值——本测试只关心声明与属性，不关心具体色值。
async function loadMdCss() {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const decl = bundle.indexOf('const MD_CSS')
  assert.ok(decl >= 0, 'lib/client.js 里找不到 MD_CSS——客户端未重建？先跑 tsdown')
  const start = bundle.indexOf('`', decl)
  const end = bundle.indexOf('`', start + 1)
  assert.ok(start > 0 && end > start, 'MD_CSS 模板字面量定位失败')
  return bundle.slice(start + 1, end).replace(/\$\{[A-Z_]+\}/g, 'X')
}

// 取某条规则（选择器 → 声明块），便于逐条断言。
function rule(css, selector) {
  const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))
  return m ? m[1] : ''
}

test('table wrapper is the horizontal scroll container', async () => {
  const css = await loadMdCss()
  const tw = rule(css, '.pvm-tw')
  assert.match(tw, /overflow:auto/, '.pvm-tw 必须是横向滚动容器')
})

test('table is content-sized and still fills a wide container', async () => {
  const css = await loadMdCss()
  const t = rule(css, '.pvm-table')
  // width:100% 是旧 bug 本体：表恒等于容器宽 → 永不溢出 → 无横向滚动。
  // 注意用 (^|;) 锚定属性名，否则 `min-width:100%` 会被误伤成假阳性。
  assert.ok(!/(?:^|;)\s*width:100%/.test(t), '.pvm-table 不得再写 width:100%（会让表格永不溢出）')
  assert.match(t, /width:max-content/, '表须按内容定宽，否则列被压缩')
  assert.match(t, /min-width:100%/, '短表须仍铺满容器，否则右栏缩成一小坨')
})

test('every cell has a floor width so columns stop crushing', async () => {
  const css = await loadMdCss()
  // th 与 td 都要有下限：旧样式下短列被压到 45px（仅表头文字宽）。
  assert.match(rule(css, '.pvm-table th'), /min-width:\s*\d+px/, 'th 缺最小格宽')
  assert.match(rule(css, '.pvm-table td'), /min-width:\s*\d+px/, 'td 缺最小格宽')
})

test('long cells are capped and allowed to break instead of stretching one column', async () => {
  const css = await loadMdCss()
  const td = rule(css, '.pvm-table td')
  assert.match(td, /max-width:\s*\d+px/, 'td 缺上限：单列会被超长内容推成一条长带')
  assert.match(td, /word-break:break-word/, 'td 须允许长词折行，否则无空格长串撑爆表格')
})

test('header keeps nowrap (labels stay on one line)', async () => {
  const css = await loadMdCss()
  // th 的 nowrap 不是 bug（表头短，一行更好读）；bug 是 td 跟着一起被压。
  assert.match(rule(css, '.pvm-table th'), /white-space:nowrap/)
})
