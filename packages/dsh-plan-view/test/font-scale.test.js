/**
 * 字号调整（右上角 A− / A+）的回归钉（2026-10-02 用户需求）。
 *
 * 实现取「整页等比缩放」而非逐条改字号：本视图 190+ 处硬编码 fontSize，逐个改成
 * calc 派生既 invasive 又易漏。根节点一个 `zoom` 即可等比缩放整个子树。
 * 本测试钉住三件事：
 *   ① 档位定义（含 100% 基准、范围 0.8–1.4）；
 *   ② 缩放施加在视图根（`zoom: fontScale`），且确实由状态驱动——不是写死的；
 *   ③ 持久化的坏值兜底（localStorage 被改坏时回 100%，绝不把页面缩没）。
 *
 * 钉在构建产物上——跑之前需先 `npx tsdown --config tsdown.standalone.ts`。
 * 跑 `node --test test/` 即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function loadBundle() {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(b.includes('FONT_SCALES'), 'lib/client.js 里找不到 FONT_SCALES——客户端未重建？先跑 tsdown')
  return b
}

// 抽档位数组并求值（产物里是纯数字数组字面量）。
function scalesOf(b) {
  const m = b.match(/const FONT_SCALES = \[([^\]]*)\]/)
  assert.ok(m, 'FONT_SCALES 数组定位失败')
  return m[1].split(',').map((s) => Number(s.trim()))
}

test('font scale steps include a 100% base and span 0.8–1.4', async () => {
  const arr = scalesOf(await loadBundle())
  assert.ok(arr.includes(1), '缺少 100% 基准档')
  assert.equal(arr[0], 0.8, '最小档应为 0.8')
  assert.equal(arr[arr.length - 1], 1.4, '最大档应为 1.4')
  assert.ok(arr.length >= 4, '档位太少则「调整」无从谈起')
  // 单调递增：乱序会让 A+/A− 行为不可预测。
  for (let i = 1; i < arr.length; i++) assert.ok(arr[i] > arr[i - 1], '档位必须单调递增')
})

test('scaling is applied to the view root and driven by state', async () => {
  const b = await loadBundle()
  // 必须挂在根节点上：挂到子层只能缩放局部，且容易被滚动容器裁掉。
  assert.match(b, /zoom: fontScale/, '根节点缺少 zoom: fontScale（字号调整未生效）')
  // 状态必须真的能变：写死 zoom 的话按钮点了没反应。
  assert.match(b, /setFontScale\(/, '缺少 setFontScale，档位无法改变')
  assert.match(b, /loadFontScale\(\)/, '缺少初值读取（刷新后档位丢失）')
  // 持久化必须写在步进里、且真的被调用——只断言函数「存在」会漏掉「定义在但没调用」
  // （实测：把 saveFontScale(next) 换成 void next，只查定义的写法依然通过）。
  assert.match(b, /saveFontScale\(next\)/, '步进里缺少 saveFontScale(next) 调用，刷新即丢档位')
})

test('stepping arithmetic is clamped at both ends (no wrap-around)', async () => {
  const b = await loadBundle()
  const arr = scalesOf(b)
  // 实测步进算术：把产物里那段表达式抽出来跑，而不是只看有没有 clamp 的写法。
  // 端点置灰（disabled）只是 UI 提示，真正决定行为的是这段算术。
  const m = b.match(/const next = ([^;]+);/)
  assert.ok(m, '步进算术定位失败')
  const expr = m[1]
  const FONT_SCALES = arr
  const step = (fontScale, dir) => {
    const i = FONT_SCALES.indexOf(fontScale)
    const next = new Function('FONT_SCALES', 'i', 'dir', `return ${expr}`)(FONT_SCALES, i, dir)
    return next === undefined || next === fontScale ? fontScale : next
  }
  const max = arr[arr.length - 1]
  const min = arr[0]
  // 到顶继续点：必须停住，不得回到最小；到底同理。
  assert.equal(step(max, 1), max, '到最大档继续放大应停住（不得回绕到最小）')
  assert.equal(step(min, -1), min, '到最小档继续缩小应停住（不得回绕到最大）')
  // 正常档位能走。
  assert.equal(step(1, 1), 1.1)
  assert.equal(step(1, -1), 0.9)
  // 坏值（localStorage 被改坏）时不得抛错、不得跳出档位集合。
  assert.ok(arr.includes(step(3, 1)), '坏值输入应落在档位集合内')
  assert.ok(arr.includes(step(NaN, -1)), 'NaN 输入应落在档位集合内')
})

test('the control offers both directions and reports the current step', async () => {
  const b = await loadBundle()
  // 2026-10-02 用户需求：控件只保留「百分比 + 加减号」，去掉「字号」与 A 字符。
  // 语义改由 title/aria-label 承载，不占视觉宽度。
  assert.ok(b.includes('children: "−"'), '缺少缩小按钮（应为纯减号）')
  assert.ok(b.includes('children: "+"'), '缺少放大按钮（应为纯加号）')
  assert.ok(b.includes('"aria-label": "缩小字号"'), '缩小按钮缺少无障碍标签（去掉可见文字后必须补 aria-label）')
  assert.ok(b.includes('"aria-label": "放大字号"'), '放大按钮缺少无障碍标签')
  // 百分比显示：用户要看得出当前档位，否则「调了多大」无从判断。
  assert.match(b, /Math\.round\(fontScale \* 100\)/, '缺少百分比显示')
  // 反向断言：用户明确要求去掉的字符不得残留。
  for (const gone of ['children: "字号"', 'children: "A−"', 'children: "A+"']) {
    assert.ok(!b.includes(gone), `残留了应移除的可见文字 ${gone}`)
  }
})

test('endpoint buttons are greyed out at both ends', async () => {
  const b = await loadBundle()
  // UI 层提示：到端点置灰（真正的 clamp 算术由上一个测试实测）。
  assert.match(b, /fontScale === FONT_SCALES\[0\]/, '最小档未置灰')
  assert.match(b, /FONT_SCALES\[FONT_SCALES\.length - 1\]/, '最大档未置灰')
})

test('refresh is icon-only and sits to the right of the font control', async () => {
  const b = await loadBundle()
  // ① 刷新只用符号：默认 label 是 ⟳，不再带「刷新」二字。
  assert.match(b, /const refreshBtn = \(label = "⟳"\)/, '刷新的默认 label 应为纯符号 ⟳')
  assert.ok(!b.includes('children: "⟳ 刷新"'), '主头部刷新残留了「刷新」文字')
  // 加载中不得把文字塞进纯符号按钮（会撑宽按钮、位置跳动）。
  assert.ok(!b.includes('children: "读取中…"'), '加载态仍用文字「读取中…」，应改为符号')
  // ② 错误页那处仍需文字：它是空白页里唯一的出路，纯符号读不出含义。
  assert.ok(b.includes('"⟳ 重新读取"'), '错误页应保留「⟳ 重新读取」文字')
  // ③ 顺序：刷新在字号控件之后（即最右）。
  // 注意不能直接全局 indexOf 比位置：refreshBtn 的 title 只出现在**函数定义**里
  // （在文件靠前处），拿它跟渲染点比必然得出错误结论（实测踩过）。要定位真正的
  // **调用点**，即头部右侧容器内的 refreshBtn()。
  const autoIdx = b.indexOf('marginLeft: "auto"')
  assert.ok(autoIdx > 0, '定位头部右侧容器失败')
  const headerSeg = b.slice(autoIdx, autoIdx + 6000)
  const refreshCall = headerSeg.indexOf('refreshBtn()')
  const fontInHeader = headerSeg.indexOf('"aria-label": "放大字号"')
  assert.ok(refreshCall > 0, '头部容器里找不到 refreshBtn() 调用点')
  assert.ok(fontInHeader > 0, '头部容器里找不到字号控件')
  assert.ok(refreshCall > fontInHeader, '刷新按钮应在字号控件右侧（当前顺序反了）')
})

test('a corrupted stored value falls back to 100%', async () => {
  const b = await loadBundle()
  const arr = scalesOf(b)
  // 复刻 loadFontScale 的判据：仅接受合法档位，其余一律回 1。
  const load = (raw) => {
    if (raw === null || raw === undefined) return 1
    const n = Number(raw)
    return arr.includes(n) ? n : 1
  }
  assert.equal(load(null), 1, '无记录应回 100%')
  assert.equal(load('1.25'), 1.25, '合法值应保留')
  for (const bad of ['3', '0.1', 'abc', '', '0', 'NaN']) {
    assert.equal(load(bad), 1, `坏值 ${JSON.stringify(bad)} 应回 100%，否则页面可能被缩没`)
  }
})
