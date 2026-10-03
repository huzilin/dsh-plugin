/**
 * dsh-plan-view — host-side Cordis entry: the plan view's own data plane.
 *
 * 本插件此前 CLIENT-only（读文件走 better-sidebar 的 /sidebar/api 通用路由，
 * 每调用 ~100ms 且完全串行，见 .plan/approval/待拍板-planview加载性能-20260930.md）。
 * 票 19（2026-09-30 拍板「完全解耦」）后：数据面改走本文件挂的两条专用路由，
 * 进程内直读 fs，一次请求返回全部数据；better-sidebar 依赖清零。
 *
 * 读取契约从客户端随迁（与 plan-lint 双源一致，改动须同步两边）：
 *   - effort 判据（2026-09-29 拍板）：子目录含 map.md = wayfinder 图；无 map
 *     但含 spec.md = spec-only 实施图——同算 effort。
 *   - 收集白名单（2026-09-30 目录契约拍板，写入矩阵 §六；assets 为同日票 21
 *     三视图拍板扩面）：issues/（存量 tickets/ 兼容）+ approval|qa|ledger 图内
 *     单据目录 + impl|impl-fe 存量只读 + assets/（推演产物，按票面 `assets:`
 *     字段关联展示，不当票计型）。契约外目录是视图不可见孤岛（plan-lint 检查[8]）。
 *   - `.plan` 侧审批档收集（2026-09-30 收拢拍板）：正本落点 = `.plan/approval/`
 *     子目录（全局件审批成员目录化）；根层 `待拍板-/已拍板-` 前缀仅存量兼容
 *     （未迁移仓可见性不回退），plan-lint 检查[9] 已按新落点报根层违例。
 *   - `docs/adr/` 全局展示层（2026-09-30 拍板「docs/adr 纳入视图全局层」）：
 *     知识层原地自维护、不入治理目录，视图只读展示——只收 `NNNN-<slug>.md`
 *     形状（ADR-FORMAT.md 契约），group='adr'；现行面（round=null）才有，
 *     历史轮快照不含（ADR 非轮成员）。
 *   - `.plan` 根下没有任何 effort（2026-09-29 拍板）：effortScan=false。
 *
 * Node half 仍不 import 任何 react / 浏览器模块。
 */
import { opendir, readFile, realpath, writeFile, rename, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'

export const name = 'dsh-plan-view'

// 数据面依赖面：webServer（挂路由）+ sessions（header cwd）；webRuntime 与
// sessionPersistence 走 ctx.get 容缺取（缺失时降级：无受信主机名单/persistence 兜底）。
export const inject = ['webServer', 'sessions']

// ─── 读取契约常量（客户端 PlanView.tsx 的同款判据，双源一致）──────────────────

// 收集白名单（2026-09-30 目录契约拍板，写入矩阵 §六；assets 为同日三视图拍板扩面；
// prototype 为 2026-10-04 拍板加入——其文件走 efforts[].prototypes 清单（见
// listPrototypes），html 非 md 不会进票面，登记在案为白名单双源一致）。
// assets/ 是推演产物不是票：收集仅为按票面 `assets:` 字段关联展示（票 21），
// 客户端分流不进票面、不计工单数。
export const COLLECT_DIR_NAMES = new Set(['issues', 'tickets', 'approval', 'qa', 'ledger', 'assets', 'prototype', 'impl', 'impl-fe'])

// effort 原型产物形状（2026-10-04 拍板，票 23 契约）：prototype/ 下自包含
// 单文件 html（LOGIC 分支脚本/README 不入清单——视图只预览 html）。
export const PROTO_FILE = /\.html$/i

// `.plan` 根层审批档形状（2026-09-30 票 18 引入）：收拢拍板后新落点 =
// `.plan/approval/`，根层仅存量兼容（未迁移仓审批档不从视图消失）。
export const PLAN_ROOT_ALLOW = /^(?:待拍板|已拍板)-/

// ADR 文件形状（ADR-FORMAT.md 契约：docs/adr/NNNN-<slug>.md）；形状外不收。
const ADR_FILE = /^\d{4}-/

// Effort 陪伴文档不是票（map/spec/readme 描述 effort 本身）。
const NON_TICKET = /^(map|spec|tech-spec|fe-v1-spec|readme)\.md$/i

// 归档轮目录名（round-id 以日期开头是归档格式约定）；同时作白名单防目录穿越。
const ROUND_ID = /^\d{4}-\d{2}-\d{2}/

// Marks files read from a root's own top level, which belong to no effort.
const ROOT_GROUP = '\u0000root'

const isMd = (name) => name.endsWith('.md')

// ─── fs 原语（单层列目录，容缺）───────────────────────────────────────────────

async function listDir(path) {
  try {
    const dir = await opendir(path)
    const entries = []
    for await (const dirent of dir) {
      entries.push({ name: dirent.name, path: join(path, dirent.name), isDir: dirent.isDirectory() })
    }
    return entries
  } catch {
    return null // 目录缺失 = 该根/子目录整体不存在，与客户端版「容缺跳过」同义
  }
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null // 缺档容错（spec-only effort 无 map.md 是常态，2026-09-29 nvwa 实证）
  }
}

// ─── 收集器（纯数据面，node --test 直测）──────────────────────────────────────

// 单 effort 的票面文件：白名单子目录 + effort 根层（NON_TICKET 排除），按 path 去重。
async function collectTicketFiles(effortDir) {
  const tree = await listDir(effortDir)
  if (tree === null) return []
  const inDirs = tree.filter((e) => e.isDir && !e.name.startsWith('.') && COLLECT_DIR_NAMES.has(e.name))
  const groups = await Promise.all([
    ...inDirs.map(async (d) => {
      const t = await listDir(d.path)
      return (t ?? []).filter((f) => !f.isDir && isMd(f.name)).map((f) => ({ file: f, group: d.name }))
    }),
    Promise.resolve(tree.filter((f) => !f.isDir && isMd(f.name)).map((f) => ({ file: f, group: ROOT_GROUP }))),
  ])
  const seen = new Set()
  const all = []
  for (const e of groups.flat()) {
    if (NON_TICKET.test(e.file.name) || seen.has(e.file.path)) continue
    seen.add(e.file.path)
    all.push(e)
  }
  return all
}

// 单治理根（.scratch=effortScan true / .plan=false / 归档轮目录=true）。
// 形状对齐客户端原 loadPlan：efforts + 根层件 + 全局 ledger/qa + 各 effort 票面。

// effort 原型产物清单（2026-10-04 拍板，票 23 契约）：prototype/ 下的
// 自包含单文件 html，只列清单不内联内容（html 体积大，按需走
// /plan-view/prototype 端点取）。目录缺失 = 无原型，容缺返回空。
async function listPrototypes(effortDir) {
  const t = await listDir(join(effortDir, 'prototype'))
  return (t ?? [])
    .filter((f) => !f.isDir && PROTO_FILE.test(f.name))
    .map((f) => ({ name: f.name, path: f.path }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function collectRoot(planDir, effortScan) {
  const rootTree = await listDir(planDir)
  if (rootTree === null) return null
  const hasMapHere = effortScan && rootTree.some((e) => !e.isDir && e.name === 'map.md')
  const subDirs = effortScan ? rootTree.filter((e) => e.isDir && !e.name.startsWith('.') && e.name !== 'node_modules') : []
  const effortDirs = (await Promise.all(subDirs.map(async (d) => {
    const t = await listDir(d.path)
    return (t ?? []).some((e) => !e.isDir && (e.name === 'map.md' || e.name === 'spec.md')) ? d.path : null
  }))).filter((p) => p !== null)
  const allEfforts = hasMapHere ? [planDir, ...effortDirs] : effortDirs

  const efforts = await Promise.all(allEfforts.map(async (dir) => ({
    dir,
    mapRaw: (await readText(join(dir, 'map.md'))) ?? '',
    specRaw: (await readText(join(dir, 'spec.md'))) ?? null,
    prototypes: await listPrototypes(dir),
  })))

  const files = []
  // 根层 md：tracker 根全收；`.plan` 根只收审批档形状（票 18 白名单）。
  for (const f of rootTree.filter((e) => !e.isDir && isMd(e.name))) {
    if (!effortScan && !PLAN_ROOT_ALLOW.test(f.name)) continue
    files.push({ file: f, from: ROOT_GROUP, group: ROOT_GROUP })
  }
  // 全局单据子目录（2026-09-30 收拢拍板起含 approval/）：审批档 + 台账 + qa。
  for (const name of ['approval', 'ledger', 'qa']) {
    if (!rootTree.some((e) => e.isDir && e.name === name)) continue
    const t = await listDir(join(planDir, name))
    for (const f of (t ?? []).filter((e) => !e.isDir && isMd(e.name))) {
      files.push({ file: f, from: ROOT_GROUP, group: name })
    }
  }
  // 各 effort 的票面文件。注意：hasMapHere 的根自身不跑 collectTicketFiles——
  // 客户端原版同行为（根自身只收根层 md，其 issues/ 子目录不在收集面）。
  for (const d of effortDirs) {
    for (const g of await collectTicketFiles(d)) {
      files.push({ file: g.file, from: d, group: g.group })
    }
  }
  return { efforts, files }
}

/**
 * 一次快照：round=null 看现行双根（`.scratch/` + `.plan/` 合并），round=轮 id
 * 看 `.archive/rounds/<id>/` 单根（它就是当时 `.scratch/` 的快照，effortScan=true）。
 */
export async function collectSnapshot(cwd, round = null) {
  const roots = round === null
    ? [
        { dir: join(cwd, '.scratch'), effortScan: true },
        { dir: join(cwd, '.plan'), effortScan: false },
      ]
    : [{ dir: join(cwd, '.archive', 'rounds', round), effortScan: true }]

  const parts = (await Promise.all(roots.map((r) => collectRoot(r.dir, r.effortScan)))).filter((p) => p !== null)
  // ADR 全局展示层（2026-09-30 拍板）：现行面才有——历史轮是 .scratch 快照，
  // ADR 属知识层非轮成员，混进轮视图会把「当时」与「现在」搅在一起。
  if (round === null) {
    const adrTree = await listDir(join(cwd, 'docs', 'adr'))
    const adrFiles = (adrTree ?? [])
      .filter((e) => !e.isDir && isMd(e.name) && ADR_FILE.test(e.name))
      .map((f) => ({ file: f, from: ROOT_GROUP, group: 'adr' }))
    parts.push({ efforts: [], files: adrFiles })
  }
  const seen = new Set()
  const files = []
  for (const p of parts) {
    for (const e of p.files) {
      if (seen.has(e.file.path)) continue // 双根重叠（存量未迁移图）按路径去重，同原 loadPlanMerged
      seen.add(e.file.path)
      files.push(e)
    }
  }
  // 内容一次读齐（响应给原文，frontmatter/kind 解析留客户端不动）。
  const fileContents = await Promise.all(files.map(async (e) => ({
    path: e.file.path, name: e.file.name, from: e.from, group: e.group,
    content: (await readText(e.file.path)) ?? '',
  })))

  // 历史轮清单 + 轮次索引 README（读不到给 null，客户端空态）。
  const roundsDir = await listDir(join(cwd, '.archive', 'rounds'))
  const ids = (roundsDir ?? [])
    .filter((e) => e.isDir && ROUND_ID.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse() // 新轮在前
  const readmeRaw = await readText(join(cwd, '.archive', 'README.md'))

  return {
    cwd,
    efforts: parts.flatMap((p) => p.efforts),
    files: fileContents,
    rounds: { ids, readmeRaw },
    contextRaw: (await readText(join(cwd, 'CONTEXT.md'))) ?? '',
  }
}

/**
 * 原型预览路径围栏（2026-10-04 票 24）：realpath 后必须仍落会话 cwd 内，
 * 且命中 effort 原型形状（任意 `/prototype/` 目录段下的单层 .html 文件——
 * 现行 `.scratch/<effort>/prototype/` 与历史轮 `.archive/rounds/<id>/…/prototype/`
 * 都放行，其余一律拒）。返回 null = 放行；返回字符串 = 拒因。
 */
export function prototypePathError(realCwd, realPath) {
  if (!(realPath === realCwd || realPath.startsWith(`${realCwd}/`))) return `path "${realPath}" is outside workspace`
  if (!/\/prototype\/[^/]+\.html$/.test(realPath)) return `path "${realPath}" is not an effort prototype html`
  return null
}

/**
 * B1 绑定写回的原文变换：upsert 一个 frontmatter 键，其余原样保留。
 * 服务端做 read-modify-write，客户端免「读原文」往返（fsRead 已随解耦清退）。
 */
export function upsertFrontmatterKey(raw, key, value) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m && m[1] != null) {
    const lines = m[1].split('\n')
    const i = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (i >= 0) lines[i] = `${key}: ${value}`
    else lines.push(`${key}: ${value}`)
    return `---\n${lines.join('\n')}\n---\n${m[2] ?? ''}`
  }
  return `---\n${key}: ${value}\n---\n\n${raw}`
}

// ─── HTTP 面（fence + 信封对齐客户端 fetch 解析）──────────────────────────────

// Host/Origin 围栏：复刻 better-sidebar trust-fence 语义（自包含，不 import）。
function fenced(req, trustedHosts) {
  const headers = req.headers ?? {}
  const host = headers.host
  if (host === undefined || host === '') return false
  const hostname = host.split(':')[0]
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  if (!loopback && !(trustedHosts ?? []).includes(hostname)) return false
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const origin = headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch { return false }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > 1 << 20) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text) // malformed → 500 internal，与入参校验同层
}

// 会话 cwd：header 优先（内存命中即时）；冷会话走 persistence 轻量 list
//（只读 header 快照，**绝不 open**——open 读档会永久挂起，2026-09-30 8ecb415 实证）。
// 两处皆无 → 显式报错，不落 process.cwd() 兜底（错仓数据比报错更糟）。
async function cwdOf(ctx, sessionId) {
  const headerCwd = ctx.sessions.get(sessionId)?.header?.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  const listed = await ctx.get('sessionPersistence')?.list?.() ?? []
  const metaCwd = listed.find(s => s.header?.id === sessionId)?.header?.cwd
  if (metaCwd !== undefined && metaCwd !== '') return metaCwd
  return null
}

export function apply(ctx) {
  const trustedHosts = () => ctx.get('webRuntime')?.trustedHosts ?? []
  const cwdOfPayload = async (payload) => {
    const sessionId = payload?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('missing or invalid "sessionId"')
    const cwd = await cwdOf(ctx, sessionId)
    if (cwd === null) throw new Error(`session "${sessionId}" has no resolvable working directory`)
    return cwd
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/plan-view',
    handler: async (req, res) => {
      if (!fenced(req, trustedHosts())) { writeJson(res, 403, { ok: false, error: { message: 'forbidden' } }); return }
      const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      // 原型预览（2026-10-04 票 24）：唯一的 GET 面——iframe src 直接指它，
      // fragment（#variant=…）归文档内切换器管。fence 照跑；路径围栏见
      // prototypePathError（cwd 内 + effort 原型形状，任意文件读拦死）。
      if (req.method === 'GET' && method === '/plan-view/prototype') {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const filePath = url.searchParams.get('path') ?? ''
        try {
          const sessionId = url.searchParams.get('sessionId') ?? ''
          if (!isAbsolute(filePath)) throw new Error('missing or invalid "path"')
          const cwd = await cwdOf(ctx, sessionId)
          if (cwd === null) throw new Error(`session "${sessionId}" has no resolvable working directory`)
          const [realCwd, realPath] = await Promise.all([realpath(cwd), realpath(filePath)])
          const rejected = prototypePathError(realCwd, realPath)
          if (rejected !== null) { writeJson(res, 403, { ok: false, error: { message: rejected } }); return }
          const html = await readFile(realPath, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(html)
        } catch (error) {
          writeJson(res, 404, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
        }
        return
      }
      if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: { message: 'method not allowed' } }); return }
      try {
        const payload = await readJsonBody(req)
        if (method === '/plan-view/snapshot') {
          const cwd = await cwdOfPayload(payload)
          const round = payload.round
          if (round !== undefined && round !== null && (typeof round !== 'string' || !ROUND_ID.test(round))) {
            throw new Error('invalid "round"')
          }
          writeJson(res, 200, { ok: true, value: await collectSnapshot(cwd, round ?? null) })
          return
        }
        if (method === '/plan-view/write') {
          const cwd = await cwdOfPayload(payload)
          const { path, key, value } = payload
          if (typeof path !== 'string' || path === '' || typeof key !== 'string' || key === '' || typeof value !== 'string') {
            throw new Error('missing or invalid "path"/"key"/"value"')
          }
          if (!isAbsolute(path)) throw new Error('"path" must be absolute')
          // 围栏：票面路径 realpath 后必须仍落会话 cwd 内（低频单次，不吝 realpath）。
          const [realCwd, realPath] = await Promise.all([realpath(cwd), realpath(path)])
          if (!(realPath === realCwd || realPath.startsWith(`${realCwd}/`))) {
            writeJson(res, 403, { ok: false, error: { message: `path "${path}" is outside workspace` } })
            return
          }
          const raw = await readFile(realPath, 'utf8')
          const tmp = `${realPath}.dsh-plan-view-tmp-${process.pid}`
          try {
            await writeFile(tmp, upsertFrontmatterKey(raw, key, value), 'utf8')
            await rename(tmp, realPath)
          } catch (error) {
            await rm(tmp, { force: true }).catch(() => {})
            throw error
          }
          writeJson(res, 200, { ok: true, value: { written: true } })
          return
        }
        writeJson(res, 404, { ok: false, error: { message: 'unknown plan-view method' } })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
      }
    },
  }), 'dsh-plan-view: snapshot/write routes')
}
