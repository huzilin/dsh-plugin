/**
 * 缺陷页面「长字段撑爆整页」的回归钉（2026-10-06 用户反馈）。
 *
 * 症状（真机截图）：master-outline-realign 的缺陷页里，卡片同行的标题被压成
 * 两三个字宽、竖排成一条，右侧一列长文字把页面撑出屏幕外。
 *
 * 根因：缺陷文件的字段行其实是**整句**而非短值——实测 DEF-28 的
 * `- 状态: 已关闭（2026-10-04 票 09 ... 断口 a〔人工通路断链〕/断口 b〔改字漂移〕
 * 实现面双闭环 ...）` 长达 200+ 字，`- 严重度:` / `- 类型:` / `- 发现源:` 同样带
 * 大段括注。`parseDefectFile` 的 `(.+)` 如实取整行，渲染侧把它们塞进不换行的
 * pill chip —— 一个 chip 即宽几百像素，`flexWrap` 只能整块换行，同行的标题被挤到
 * 只剩几像素。
 *
 * 修法（本钉的两条）：
 *   ① 字段 chip 必须带截断三件套（`overflow:hidden` + `textOverflow:ellipsis`
 *     + `whiteSpace:nowrap`）并有 `maxWidth` 上限——否则长值重新撑爆；
 *   ② 所在 flex 行/滚动列必须有 `minWidth: 0`——flex 项默认下限是内容宽，缺它
 *     时截断根本不生效（这是「加了 maxWidth 却没变化」的经典坑）。
 *
 * 钉在构建产物上——跑之前需先 `npx tsdown --config tsdown.standalone.ts`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

test('the defect field chip truncates instead of stretching the page', () => {
  // FieldChip 是长字段的唯一出口（严重度/类型/发现源三处共用，两套渲染路径都走它）。
  const m = bundle.match(/function FieldChip\([\s\S]*?\n\t*\}/)
  assert.ok(m, 'lib/client.js 里找不到 FieldChip——客户端未重建？先跑 tsdown')
  const src = m[0]
  for (const decl of ['overflow: "hidden"', 'textOverflow: "ellipsis"', 'whiteSpace: "nowrap"']) {
    assert.ok(src.includes(decl), `FieldChip 缺 ${decl}：长字段会重新撑爆整行`)
  }
  assert.match(src, /maxWidth/, 'FieldChip 缺 maxWidth 上限：截断需要一个基准宽度')
  // 完整原文必须留在 title 上，否则截断 = 信息丢失。
  assert.match(src, /title:/, 'FieldChip 须把完整原文挂 title，悬停可读')
})

test('the defect state chip truncates too (state is the longest field)', () => {
  // 状态字段是实测最长的一处（200+ 字），它是独立 span 不经 FieldChip。
  // 按产物的属性逐行格式匹配（`title: single.state,` + `maxWidth: 220,` + ellipsis）。
  const stateChip = (titlePattern) => new RegExp(
    `${titlePattern},[\\s\\S]{0,400}?maxWidth: 220,[\\s\\S]{0,120}?textOverflow: "ellipsis"`)
  assert.ok(stateChip('title: single\\.state').test(bundle),
    '单文件形态的状态 chip 须截断（maxWidth 220 + ellipsis）')
  assert.ok(stateChip('title: e\\.state \\|\\| "待修复"').test(bundle),
    '清单总览形态的状态 chip 须同样截断')
})

test('the defect scroll column and title rows can actually shrink (minWidth: 0)', () => {
  // flex 项默认 min-width:auto（下限=内容宽）——不显式写 0，子项的 ellipsis 不会触发。
  // 产物里每个 CSS 属性独占一行（`\n\t…minWidth: 0`），故按行匹配而非单行拼接。
  const chipRows = bundle.match(/flexWrap: "wrap",\n\s*marginTop: 6,\n\s*minWidth: 0/g)
  assert.ok(chipRows !== null && chipRows.length === 1, 'chip 行须带 minWidth: 0')
  // 标题行：flex:1 的标题必须 minWidth:0，否则标题把整行顶开而不是被省略。
  const titles = bundle.match(/flex: 1,\n\s*minWidth: 0,\n\s*fontSize: 13,\n\s*fontWeight: 700/g)
  assert.ok(titles !== null && titles.length === 2, '两套渲染路径的标题都要 minWidth: 0')
})
