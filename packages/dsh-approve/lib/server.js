/**
 * dsh-approve — host-side Cordis plugin.
 *
 * This file is the NODE entry point loaded by the Cordis loader via
 * `package.json main / exports["."]`. It must NEVER import react or any
 * browser-only module. The CLIENT half (ApprovalPanel) lives separately at
 * `lib/client.js` (built by tsdown with the DSH client face) and is loaded
 * by the client module system, not this entry.
 *
 * Hooks (same as before):
 *  - `tools/pre-execute`  (prepend): command gate + ensureRoutes + ask reason.
 *  - `approval/request`   (prepend): suppress DSH escalation + whitelisted-call grant.
 *  - `tools/post-execute`: reclaim callId correlation map.
 *
 * HTTP routes (registered lazily via webServer service):
 *  - POST /dsh-approve/whitelist-add
 *  - POST /dsh-approve/whitelist-remove
 *  - GET  /dsh-approve/status
 *
 * Config: ~/.dsh/dsh-approve.json (re-read per decision → live).
 * Mount marker: ~/.dsh/dsh-approve.mounted (diagnostic only).
 */
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decide, classifyCommand, SHELL_TOOLS, REMOTE_TOOLS, DANGEROUS_PATTERNS } from './policy.js'

const CONFIG_PATH = join(homedir(), '.dsh', 'dsh-approve.json')
const MOUNT_MARKER = join(homedir(), '.dsh', 'dsh-approve.mounted')
const ESCALATION_PREFIX = 'escalate sandbox to'

/** Compiled deny patterns: the built-in floor plus the user's extras. */
function compileDenyPatterns(extra = []) {
  const out = [...DANGEROUS_PATTERNS]
  for (const raw of Array.isArray(extra) ? extra : []) {
    if (typeof raw !== 'string' || raw === '') continue
    try { out.push(new RegExp(raw)) } catch (e) { console.error(`[dsh-approve] invalid denyPattern "${raw}": ${String(e?.message ?? e)} (ignored)`) }
  }
  return out
}

/** Load + validate the config file (re-read per decision → edits apply immediately). */
function freshConfig() {
  const fallback = { whitelist: [], denyPatterns: [], enforceDanger: true, suppressDshApproval: true, denyPatternsCompiled: compileDenyPatterns() }
  try {
    if (!existsSync(CONFIG_PATH)) return fallback
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    const whitelist = (Array.isArray(raw.whitelist) ? raw.whitelist : []).filter(e => typeof e === 'string' && e.trim() !== '').map(e => e.trim())
    const denyPatterns = Array.isArray(raw.denyPatterns) ? raw.denyPatterns : []
    const enforceDanger = raw.enforceDanger !== false
    const suppressDshApproval = raw.suppressDshApproval !== false
    return { whitelist, denyPatterns, enforceDanger, suppressDshApproval, denyPatternsCompiled: compileDenyPatterns(denyPatterns) }
  } catch (e) {
    console.error(`[dsh-approve] failed to read ${CONFIG_PATH}: ${String(e?.message ?? e)} — defaults (fail closed)`)
    return fallback
  }
}

function firstMatchingPattern(command, patterns) {
  for (const re of patterns) { if (re instanceof RegExp && re.test(command)) return re.source }
  return undefined
}

/** Atomic whitelist persistence. */
function persistWhitelist(items) {
  let cfg = {}
  try { if (existsSync(CONFIG_PATH)) cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch {}
  const data = { ...cfg, whitelist: items }
  const tmp = `${CONFIG_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, CONFIG_PATH)
  return items
}
function whitelistAdd(command) {
  const current = freshConfig().whitelist
  const entry = command.trim()
  if (entry === '') throw new Error('command must be a non-empty string')
  if (!current.includes(entry)) current.push(entry)
  return persistWhitelist(current)
}
function whitelistRemove(command) {
  return persistWhitelist(freshConfig().whitelist.filter(e => e !== command.trim()))
}

/** Ask reason (per user's exact copy, 2026-08-22). */
function askReason({ command }) {
  return `命令在会话工作区之外运行：\n命令：${command.trim()}`
}

/** Deny reason. */
function denyReason({ pattern }) {
  return `dsh-approve：命令命中系统级危险规则 /${pattern ?? '?'}/，已阻止。确有必要可加入白名单后放行。`
}

function writeMountMarker() {
  try { writeFileSync(MOUNT_MARKER, new Date().toISOString(), 'utf8') } catch {}
}

export default {
  name: 'dsh-approve',
  inject: ['tools'],
  apply(ctx) {
    const whitelistedCalls = new Map()

    /* ---- tools/pre-execute: ensure routes + command gate ---- */
    let routesRegistered = false
    const ensureRoutes = () => {
      if (routesRegistered) return
      const ws = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
      if (!ws || typeof ws.register !== 'function') return
      const readBody = async (req) => { const ch = []; for await (const c of req) ch.push(c); const t = Buffer.concat(ch).toString('utf8'); return t === '' ? {} : JSON.parse(t) }
      const json = (res, s, v) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)) }
      try {
        ws.register({ kind: 'exact', path: '/dsh-approve/whitelist-add', handler: async (req, res) => {
          try { const p = await readBody(req); const cmd = typeof p.command === 'string' ? p.command.trim() : ''; if (!cmd) { json(res, 400, { ok: false, error: 'command must be a non-empty string' }); return } const wl = whitelistAdd(cmd); json(res, 200, { ok: true, command: cmd, whitelist: wl, whitelistCount: wl.length }) } catch (e) { json(res, 500, { ok: false, error: String(e?.message ?? e) }) }
        }})
        ws.register({ kind: 'exact', path: '/dsh-approve/whitelist-remove', handler: async (req, res) => {
          try { const p = await readBody(req); const cmd = typeof p.command === 'string' ? p.command.trim() : ''; const wl = whitelistRemove(cmd); json(res, 200, { ok: true, command: cmd, whitelist: wl, whitelistCount: wl.length }) } catch (e) { json(res, 500, { ok: false, error: String(e?.message ?? e) }) }
        }})
        ws.register({ kind: 'exact', path: '/dsh-approve/status', handler: async (_req, res) => {
          try { const st = freshConfig(); json(res, 200, { active: true, plugin: 'dsh-approve', configPath: CONFIG_PATH, whitelist: st.whitelist, whitelistCount: st.whitelist.length, enforceDanger: st.enforceDanger, suppressDshApproval: st.suppressDshApproval }) } catch (e) { json(res, 500, { ok: false, error: String(e?.message ?? e) }) }
        }})
        console.log('[dsh-approve] HTTP routes registered: /dsh-approve/*')
        routesRegistered = true
      } catch (e) { console.warn(`[dsh-approve] couldn't register HTTP routes: ${String(e?.message ?? e)}`) }
    }

    ctx.on('tools/pre-execute', async (exec, next) => {
      ensureRoutes()
      if (!exec || !SHELL_TOOLS.has(exec.name)) return next()
      const cfg = freshConfig()
      const args = (exec.arguments !== null && typeof exec.arguments === 'object') ? exec.arguments : {}
      const command = typeof args.command === 'string' ? args.command : typeof args.code === 'string' ? args.code : undefined
      if (typeof command !== 'string' || !command.trim()) return next()
      const workdir = typeof args.workdir === 'string' ? args.workdir : undefined
      const workspace = exec.agent && exec.agent.session ? exec.agent.session.header.cwd : undefined
      const decision = decide({ command, whitelist: cfg.whitelist, denyPatterns: cfg.denyPatternsCompiled, workdir, workspace, remote: REMOTE_TOOLS.has(exec.name), enforceDanger: cfg.enforceDanger })
      switch (decision) {
        case 'whitelist': { whitelistedCalls.set(exec.callId, command.trim()); return { kind: 'allow' } }
        case 'dangerous': { return { kind: 'deny', reason: denyReason({ pattern: firstMatchingPattern(command.trim(), cfg.denyPatternsCompiled) }) } }
        case 'outside': { return { kind: 'ask', reason: askReason({ command }) } }
        default: return next()
      }
    }, { prepend: true })

    ctx.on('approval/request', async (req, next) => {
      const cfg = freshConfig()
      if (req && typeof req.reason === 'string' && req.reason.startsWith(ESCALATION_PREFIX) && cfg.suppressDshApproval) return 'allowed-once'
      if (req && SHELL_TOOLS.has(req.toolName) && req.callId !== undefined && whitelistedCalls.has(req.callId)) { whitelistedCalls.delete(req.callId); return 'allowed-once' }
      return next()
    }, { prepend: true })

    ctx.on('tools/post-execute', (exec, _result, next) => { if (exec && exec.callId !== undefined) whitelistedCalls.delete(exec.callId); return next() })

    /* ---- model tools ---- */
    const registerTool = (def) => { try { ctx.tools.register(def) } catch (e) { console.warn(`[dsh-approve] tool "${def.name}" failed: ${String(e?.message ?? e)}`) } }
    const jsonOutput = () => ({ schema: { type: 'object', additionalProperties: true }, render(_, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] } })
    registerTool({ name: 'dsh_approve_status', description: 'Report dsh-approve state: whitelist entries, danger floor, suppression flag.', parameters: { type: 'object', properties: {} }, output: jsonOutput(), async execute() { const st = freshConfig(); return { active: true, plugin: 'dsh-approve', configPath: CONFIG_PATH, whitelist: st.whitelist, whitelistCount: st.whitelist.length, enforceDanger: st.enforceDanger, suppressDshApproval: st.suppressDshApproval } } })
    registerTool({ name: 'dsh_approve_whitelist_add', description: 'Append ONE exact shell command to the whitelist (persisted, live).', parameters: { type: 'object', properties: { command: { type: 'string', description: 'The exact full command string.' } }, required: ['command'] }, output: jsonOutput(), async execute(args) { const cmd = typeof args?.command === 'string' ? args.command.trim() : ''; if (!cmd) return { ok: false, error: 'command must be a non-empty string' }; const wl = whitelistAdd(cmd); return { ok: true, command: cmd, whitelist: wl, whitelistCount: wl.length } } })
    registerTool({ name: 'dsh_approve_whitelist_remove', description: 'Remove ONE exact shell command from the whitelist (persisted, live).', parameters: { type: 'object', properties: { command: { type: 'string', description: 'The exact full command string.' } }, required: ['command'] }, output: jsonOutput(), async execute(args) { const cmd = typeof args?.command === 'string' ? args.command.trim() : ''; if (!cmd) return { ok: false, error: 'command must be a non-empty string' }; const wl = whitelistRemove(cmd); return { ok: true, command: cmd, whitelist: wl, whitelistCount: wl.length } } })

    /* ---- mount marker + boot log ---- */
    writeMountMarker()
    ensureRoutes()
    const cfg = freshConfig()
    console.log(`[dsh-approve] mounted (${cfg.whitelist.length} whitelist entries, enforceDanger=${cfg.enforceDanger}, suppressDshApproval=${cfg.suppressDshApproval})`)
  },
}