/**
 * dsh-plan-view — host-side Cordis entry: the plan view's own data plane.
 *
 * 本插件此前 CLIENT-only（读文件走 better-sidebar 的 /sidebar/api 通用路由，
 * 每调用 ~100ms 且完全串行，见 .plan/待拍板-planview加载性能-20260930.md）。
 * 票 19（2026-09-30 拍板「完全解耦」）后：数据面改走本文件挂的两条专用路由，
 * 进程内直读 fs，一次请求返回全部数据；better-sidebar 依赖清零。
 *
 * 读取契约从客户端随迁（与 plan-lint 双源一致，改动须同步两边）：
 *   - effort 判据（2026-09-29 拍板）：子目录含 map.md = wayfinder 图；无 map
 *     但含 spec.md = spec-only 实施图——同算 effort。
 *   - 收集白名单（2026-09-30 目录契约拍板，写入矩阵 §六）：issues/（存量
 *     tickets/ 兼容）+ approval|qa|ledger 图内单据目录 + impl|impl-fe 存量只读。
 *     assets/ 是调研资源不是票；契约外目录是视图不可见孤岛（plan-lint 检查[8]）。
 *   - `.plan` 侧根层展示白名单（2026-09-30 票 18）：只收审批档形状
 *     （待拍板- 与 已拍板- 前缀），与 plan-lint 检查[9] 同判据。
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

// 收集白名单（2026-09-30 目录契约拍板，写入矩阵 §六）。
export const COLLECT_DIR_NAMES = new Set(['issues', 'tickets', 'approval', 'qa', 'ledger', 'impl', 'impl-fe'])

// `.plan` 侧根层展示白名单（2026-09-30 票 18，plan-lint 检查[9] 同判据）。
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
  })))

  const files = []
  // 根层 md：tracker 根全收；`.plan` 根只收审批档形状（票 18 白名单）。
  for (const f of rootTree.filter((e) => !e.isDir && isMd(e.name))) {
    if (!effortScan && !PLAN_ROOT_ALLOW.test(f.name)) continue
    files.push({ file: f, from: ROOT_GROUP, group: ROOT_GROUP })
  }
  // 全局台账（2026-09-21 拍板一账一文件）与根层 qa/（无图归属测例/缺陷）。
  for (const name of ['ledger', 'qa']) {
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
      if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: { message: 'method not allowed' } }); return }
      const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname
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
