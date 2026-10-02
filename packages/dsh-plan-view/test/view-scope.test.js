/**
 * 视图组件作用域回归钉（2026-10-02）。
 *
 * 背景事故：`OverviewView` 里用了自由变量 `cases`——它在 `PlanView`（父组件）
 * 作用域内定义（`const cases = useMemo(...)`），从未作为 prop 传给 `OverviewView`。
 * TypeScript 能编译通过（产物是 JS，无类型检查拦自由变量），构建也不报错，
 * 但**运行到「总览」页即抛 `ReferenceError: cases is not defined`**，整个 React
 * 渲染树崩掉——现象就是用户报的「点击总览会导致 plan 挂掉」。
 *
 * 教训：这类「组件用了不属于自己的变量」的缺陷，**类型检查与构建都拦不住**，
 * 只有真实渲染或静态作用域检查能发现。本测试用后者：把每个视图组件的函数体
 * 抽出来，逐个数它引用了哪些「既不是入参、也不是本组件内定义」的标识符。
 *
 * 被测物是**构建产物**（`lib/client.js`）。跑之前需先
 * `npx tsdown --config tsdown.standalone.ts`。跑 `node --test test/`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/** 抽出 `function Name(...) { ... }` 的完整函数体（配平花括号）。 */
function extractFunction(bundle, name) {
  const i = bundle.indexOf(`function ${name}(`)
  assert.ok(i >= 0, `产物里找不到组件 ${name} —— 客户端未重建？先跑 tsdown`)
  // 先跳过**形参表**（其中可能含解构花括号），再对函数体配平花括号。
  // 不能直接从第一个 `{` 开始数：那会停在解构入参的 `}` 上（本文件踩过，
  // 结果 extractFunction 只返回 144 字符的签名片段，断言全部失真）。
  let p = bundle.indexOf('(', i)
  let pd = 0
  for (; p < bundle.length; p++) {
    if (bundle[p] === '(') pd++
    else if (bundle[p] === ')') { pd--; if (pd === 0) break }
  }
  const bodyStart = bundle.indexOf('{', p)
  let d = 0
  for (let k = bodyStart; k < bundle.length; k++) {
    if (bundle[k] === '{') d++
    else if (bundle[k] === '}') { d--; if (d === 0) return bundle.slice(i, k + 1) }
  }
  throw new Error(`函数 ${name} 花括号不配平`)
}

/** 取解构入参名：`function X({ a, b, c = 1, ...rest })` → ['a','b','c','rest']。 */
function destructuredParams(fnSrc) {
  const m = fnSrc.match(/function\s+\w+\s*\(\s*\{([\s\S]*?)\}\s*(?::[^)]*)?\)/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().split(/[=:]/)[0].trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
}

/**
 * 在一个组件函数体内，找出「被引用但既非入参、也未在函数内声明」的标识符。
 *
 * 先剥除字符串/模板串与注释——否则 `"cases.md"`、`'all'` 这类**文本**会被误判
 * 成变量引用（本测试首版就踩了：GuideView 的「qa/cases.md」说明文字报了假阳性）。
 * 再排除三种「长得像变量但不是自由引用」的位置：对象字面量的键（`all:`）、
 * 属性访问右侧（`x.all`）、以及 JSX 属性名（`all={...}`）。
 */
function findFreeVariables(bundle, name, suspects) {
  const fn = extractFunction(bundle, name)
  const params = new Set(destructuredParams(fn))

  // 剥字符串（含模板串）与行/块注释，用等长空白替换以保持位置无关性。
  const stripped = fn
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, (m) => ' '.repeat(m.length))
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))

  const free = []
  for (const s of suspects) {
    if (params.has(s)) continue
    // 只认「独立标识符」用法：前面不是 . 或词字符或引号，后面不是冒号（对象键）、
    // 也不是词字符。`=` 后的位置与 JSX 属性名仍会命中，故再排 `\s*=` 形态。
    const re = new RegExp(`(?<![\\w$.])${s}(?![\\w$])(?!\\s*:)(?!\\s*=[^=])`, 'g')
    if (!re.test(stripped)) continue
    const declaredLocally = new RegExp(
      `(?:const|let|var)\\s+${s}\\b|function\\s+${s}\\b`,
    ).test(stripped)
    if (!declaredLocally) free.push(s)
  }
  return free
}

// 父组件（PlanView）作用域里定义、容易被下层视图误用的名字。
// 这份清单就是「父作用域专属变量」的登记处；新增父层 useMemo 时可加进来。
const PARENT_SCOPE_NAMES = ['cases', 'all', 'data', 'efforts', 'defects', 'ledgers', 'adrs', 'approvals']

const VIEW_COMPONENTS = [
  'OverviewView', 'CasesView', 'DefectView', 'LedgerView',
  'ApprovalsView', 'AdrView', 'ChainView', 'SpeculationTypeView',
  'ViewA', 'ViewC', 'ViewD', 'GuideView',
]

test('视图组件不得引用父作用域自由变量（OverviewView cases 事故回归钉）', async () => {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

  const offenders = []
  for (const name of VIEW_COMPONENTS) {
    const free = findFreeVariables(b, name, PARENT_SCOPE_NAMES)
    if (free.length > 0) offenders.push(`${name}: ${free.join(', ')}`)
  }

  assert.deepEqual(
    offenders, [],
    `以下视图组件引用了既非入参也未本地声明的父作用域变量，`
    + `运行到该页会抛 ReferenceError 并挂掉整个渲染：\n  ${offenders.join('\n  ')}`,
  )
})

test('OverviewView 确实接收 cases（进度封顶判据所需）', async () => {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const params = destructuredParams(extractFunction(b, 'OverviewView'))
  assert.ok(params.includes('cases'),
    'OverviewView 必须接收 cases：effortProgress 用它判「缺测例 → 封顶 80%」')
})

test('OverviewView 调用点必须传 cases（防只改签名不改调用）', async () => {
  const b = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 产物形态：jsx(OverviewView, { tickets: all, efforts: data.efforts, cases, ... })
  // cases 走 ES 简写（同名变量直接投喂），故匹配 `cases` 而非 `cases:`。
  const i = b.indexOf('jsx)(OverviewView, {')
  assert.ok(i >= 0, '产物里找不到 OverviewView 的 jsx 调用点')
  const call = b.slice(i, b.indexOf('})', i) + 2)
  assert.ok(/(?<![\w$.])cases\s*[,:}]/.test(call),
    'OverviewView 调用点漏传 cases —— 签名加了 prop 但调用点没跟上')
})
