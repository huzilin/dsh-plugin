/**
 * 票面路径显示与点击打开的回归钉（ticket 14）。
 *
 * 被测的是两个纯函数，不是渲染：地址形态错了，右侧栏就打不开文件；相对化错了，
 * 页面显示的就是别的路径。两处都是「看一眼以为对、错了要真机才发现」的逻辑，
 * 所以钉在这里，跑 `node --test test/file-path.test.js` 即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileAddress, displayPath, sameAssetRef } from '../src/client/file-path.ts'

const SID = 'session-6f3a1c2e-0000-4000-8000-abcdefabcdef'
const CWD = '/Users/me/workdir/dsh-plugin'

test('fileAddress names a workspace file through the session scope', () => {
  // 绝对路径在地址里带前导空段（官方语法，`parseFileAddress` 靠它还原绝对形式）。
  assert.equal(
    fileAddress(SID, `${CWD}/.scratch/plan-lint-gate/issues/14-票面路径.md`),
    `dsh-resource://file/session/${SID}//Users/me/workdir/dsh-plugin/.scratch/plan-lint-gate/issues/14-%E7%A5%A8%E9%9D%A2%E8%B7%AF%E5%BE%84.md`,
  )
  // 相对路径原样拼在会话 id 之后，无空段。
  assert.equal(
    fileAddress(SID, '.plan/待拍板-x.md'),
    `dsh-resource://file/session/${SID}/.plan/%E5%BE%85%E6%8B%8D%E6%9D%BF-x.md`,
  )
})

test('fileAddress encodes the segments that would otherwise break the address', () => {
  // 空格、`#`、`?` 都必须在段内编码，否则地址在第一个 `#` 处被截断。
  assert.equal(
    fileAddress('s1', 'a b/c#d/e?f.md'),
    'dsh-resource://file/session/s1/a%20b/c%23d/e%3Ff.md',
  )
  // `:` 保持字面量，Windows 盘符读起来仍是原样。
  assert.equal(fileAddress('s1', 'C:/x/y.md'), 'dsh-resource://file/session/s1/C:/x/y.md')
})

test('fileAddress normalizes separators and leading ./', () => {
  assert.equal(fileAddress('s1', '.\\a\\b.md'), 'dsh-resource://file/session/s1/a/b.md')
  assert.equal(fileAddress('s1', './a/b.md'), 'dsh-resource://file/session/s1/a/b.md')
})

test('displayPath relativizes inside the workspace and leaves the outside alone', () => {
  assert.equal(displayPath(`${CWD}/.plan/待拍板-x.md`, CWD), '.plan/待拍板-x.md')
  assert.equal(displayPath('/Users/me/other/x.md', CWD), '/Users/me/other/x.md')
  assert.equal(displayPath(`${CWD}/x.md`, `${CWD}/`), 'x.md')
})

test('displayPath keeps a path that merely shares a prefix with the workspace', () => {
  // `/Users/me/workdir/dsh-plugin-2` 不是工作区内的文件，截成 `-2/x.md` 就指错了。
  assert.equal(displayPath('/Users/me/workdir/dsh-plugin-2/x.md', CWD), '/Users/me/workdir/dsh-plugin-2/x.md')
})

test('displayPath without a workspace keeps the path as-is', () => {
  assert.equal(displayPath(`${CWD}/x.md`, undefined), `${CWD}/x.md`)
  assert.equal(displayPath(`${CWD}/x.md`, ''), `${CWD}/x.md`)
})

// ─── sameAssetRef（票 21：推演产物三视图的 assets: 字段归组）─────────────────

test('sameAssetRef matches repo-relative, prefix-less, dotted and bare-name refs', () => {
  const abs = `${CWD}/.scratch/workflows/assets/round-001-20260924.md`
  assert.equal(sameAssetRef(abs, '.scratch/workflows/assets/round-001-20260924.md', CWD), true)
  assert.equal(sameAssetRef(abs, 'workflows/assets/round-001-20260924.md', CWD), true)
  assert.equal(sameAssetRef(abs, './round-001-20260924.md', CWD), true)
  assert.equal(sameAssetRef(abs, 'round-001-20260924.md', CWD), true)
  assert.equal(sameAssetRef(abs, abs, CWD), true)
  assert.equal(sameAssetRef(abs, 'other-round.md', CWD), false)
  assert.equal(sameAssetRef(abs, '', CWD), false)
  // cwd 未知时退化为整串比对；缺前缀 ref 靠 assets/ 尾段兜底（尽力而为，
  // 跨 effort 撞名属票作者自担的歧义——视图场景 cwd 恒已知）。
  assert.equal(sameAssetRef(abs, abs, undefined), true)
  assert.equal(sameAssetRef(abs, 'workflows/assets/round-001-20260924.md', undefined), true)
})
