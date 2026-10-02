/**
 * 「整篇 markdown 正文」各页必须同壳的回归钉（2026-10-02 用户反馈）。
 *
 * 症状史：spec / map 页曾是光板 div（无卡片框、无卡头、漏注入 MD_CSS），风格与
 * 其他页不一致；CONTEXT 页随后被报同样问题。三者场景相同——「一整篇 markdown
 * 正文」——所以必须共用同一个壳 `DocCard`，而不是各写一套。三处分别演进的结果
 * 就是风格反复漂移：修了 spec/map，CONTEXT 还是旧的。
 *
 * 本测试把「哪些页走 DocCard」钉在构建产物上：将来新增文档页时若又写光板 div，
 * 这里立刻报警。跑之前需先 `npx tsdown --config tsdown.standalone.ts`。
 * 跑 `node --test test/` 即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function loadBundle() {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(b.includes('function DocCard'), 'lib/client.js 里找不到 DocCard——客户端未重建？先跑 tsdown')
  return b
}

test('DocCard injects MD_CSS and renders a card frame with a clickable path', async () => {
  const b = await loadBundle()
  // 取 DocCard 函数体（到下一个顶层 function 为止），确保这三件事都在它内部。
  const start = b.indexOf('function DocCard')
  const rest = b.slice(start)
  const end = rest.indexOf('\n\t\tfunction ', 10)
  const body = end > 0 ? rest.slice(0, end) : rest.slice(0, 6000)

  assert.match(body, /children: MD_CSS/, 'DocCard 必须注入 MD_CSS，否则正文无排版')
  assert.match(body, /openFileInSidebar|openResource|open\(\)/, 'DocCard 卡头须可点开文件')
  assert.match(body, /overflowY: "auto"/, 'DocCard 须自管滚动（块级滚动层）')
})

test('every full-document page routes through DocCard, not a bare div', async () => {
  const b = await loadBundle()
  // 三个整篇正文页的标题：map.md / spec.md / CONTEXT.md。
  for (const title of ['map.md', 'spec.md', 'CONTEXT.md']) {
    assert.ok(b.includes(`title: "${title}"`), `找不到经由 DocCard 渲染的 ${title}（是否退回光板 div？）`)
  }
})

test('CONTEXT page passes a real file path so the header path is clickable', async () => {
  const b = await loadBundle()
  // 路径须由 cwd 拼出（缺失时退回文件名），不能是空串——空串会让点击打开静默失败。
  assert.match(b, /path: cwd === void 0 \? "CONTEXT\.md"/, 'CONTEXT 的 path 应由 cwd 拼出，缺省退回文件名')
})

test('CONTEXT keeps its loading and missing placeholders', async () => {
  const b = await loadBundle()
  assert.ok(b.includes('读取 CONTEXT.md…'), '缺「加载中」占位')
  assert.ok(b.includes('本仓仓根暂无 CONTEXT.md'), '缺「无 CONTEXT.md」占位')
})

test('regression guard: the bare-div rendering that caused the drift is gone', async () => {
  const b = await loadBundle()
  // 旧写法：CONTEXT 直接把 md() 结果塞进光板 div（无卡壳、无卡头）。
  // md(contextRaw) 现在只应作为 DocCard 的 body 出现，不再被独立 div 渲染。
  assert.ok(!/md\(contextRaw\)/.test(b), 'CONTEXT 又变回了裸 md(contextRaw) 光板 div')
})
