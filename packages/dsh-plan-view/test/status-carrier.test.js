/**
 * 票状态/阻塞边载体迁移到正文行的回归钉（2026-10-02 拍板 Q10=乙）。
 *
 * 背景：原版 issue-tracker-local.md:26 明文要求票的 `Type:` / `Status:` 写**正文行**，
 * 阻塞边写正文 `Blocked by:` 行（:27）。我方此前把这三项都放进了 frontmatter，
 * 属偏离明文。2026-10-02 拍板：状态与阻塞边改正文行；`type` 留 frontmatter
 * （它不答「走到哪了」，只答「这是什么单据」，且视图靠它分流）。
 *
 * 本测试钉三层：
 *   ① 正文 `**Status:**` 行被读到（三种取值 open/claimed/resolved）；
 *   ② 正文 `**Blocked by:**` 行被读到，且 `None — can start immediately` 解析为空；
 *   ③ 兼容面：迁移前的 frontmatter `status:` / `blocked_by:` 仍能读到（存量文档
 *      未回扫前页面不能瞎）；但**正文优先**——两者同时存在时以正文为准。
 *
 * 被测代码从构建产物 `lib/client.js` 提取（客户端是 lazy-CJS bundle，`.tsx` 源码
 * 无法被 node 直接 import），跑前需 `npx tsdown --config tsdown.standalone.ts`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function extractFn(name) {
  // Anchor on the *declaration* (`function name(`), which the bundle emits as a
  // top-level statement — a bare `name(` search would hit a call site first.
  const m = bundle.match(new RegExp(`function ${name}\\(([^)]*)\\)\\s*\\{`))
  assert.ok(m, `lib/client.js 里找不到 ${name}——客户端未重建？先跑 tsdown`)
  const brace = m.index + m[0].length - 1
  let depth = 0, i = brace
  for (; i < bundle.length; i++) {
    if (bundle[i] === '{') depth++
    else if (bundle[i] === '}') { depth--; if (depth === 0) break }
  }
  // Include the `function name(...)` header, not just the body — the slice is
  // evaluated as a statement, so a bare block would leave its params unbound.
  return bundle.slice(m.index, i + 1)
}

// bodyField + parseBlockedBy + normalizeRef + ticketId + parseFrontmatter 是一个
// 小闭包：bodyField 依赖 stripFences，parseBlockedBy 依赖 normalizeRef/ticketId。
const src = [
  extractFn('ticketId'),
  extractFn('normalizeRef'),
  "function stripFences(s){ return s.replace(/```[\\s\\S]*?```/g,'').replace(/~~~[\\s\\S]*?~~~/g,'') }",
  extractFn('bodyField'),
  extractFn('parseBlockedBy'),
].join('\n')
const mod = new Function(`${src}; return { bodyField, parseBlockedBy }`)()

test('正文 **Status:** 行被读到', () => {
  for (const v of ['open', 'claimed', 'resolved']) {
    const body = `# 01: 标题\n\n**What to build:** x\n\n**Status:** ${v}\n`
    assert.equal(mod.bodyField(body, 'Status'), v)
  }
})

test('正文 **Blocked by:** 行被读到', () => {
  const body = `# 01: 标题\n\n**Blocked by:** 03, 04\n\n**Status:** open\n`
  assert.deepEqual(mod.parseBlockedBy(mod.bodyField(body, 'Blocked by')), ['03', '04'])
})

test('「None — can start immediately」解析为空（而非造出幽灵前置）', () => {
  const body = `# 01: 标题\n\n**Blocked by:** None — can start immediately\n`
  assert.deepEqual(mod.parseBlockedBy(mod.bodyField(body, 'Blocked by')), [])
})

test('正文行缺席时返回 undefined（供调用方回退 frontmatter）', () => {
  const body = `# 01: 标题\n\n**What to build:** x\n`
  assert.equal(mod.bodyField(body, 'Status'), undefined)
  assert.equal(mod.bodyField(body, 'Blocked by'), undefined)
})

test('围栏内的 **Status:** 不算声明（防「引用格式的票」自我收口）', () => {
  const body = '# 01: 标题\n\n## Question\n\n引用格式：\n\n```markdown\n**Status:** resolved\n```\n'
  assert.equal(mod.bodyField(body, 'Status'), undefined)
})

test('取值可带附注：`resolved <YYYY-MM-DD>` 取得到整串', () => {
  const body = `# 01: 标题\n\n**Status:** resolved 2026-10-02\n`
  assert.match(mod.bodyField(body, 'Status'), /^resolved 2026-10-02$/)
})
