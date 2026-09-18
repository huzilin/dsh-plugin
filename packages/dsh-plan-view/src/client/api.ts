/**
 * Minimal fetch wrappers for a DSH sidebar plugin.
 *
 * Two channels, both same-origin fetches from this page:
 *   /sidebar/api/<method> — better-sidebar's fs surface (read + write .plan/).
 *   /api/<ns>/<method>    — the harness Typert gateway (sessions, commands).
 * Self-contained: does not depend on better-sidebar's internal api module.
 */

interface SessionScope {
  sessionId: string
  cwd?: string
}

interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  isSymlink: boolean
  broken: boolean
}

interface FsTextResult { kind: 'text'; content: string; truncated: boolean }
interface FsBinaryResult { kind: 'binary'; size: number; truncated: boolean; head: string }

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`/sidebar/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const parsed: { ok?: boolean; value?: T; error?: { message?: string } } = await resp.json()
  if (!resp.ok || parsed?.ok !== true) {
    throw new Error(parsed?.error?.message ?? `HTTP ${resp.status}`)
  }
  return parsed.value as T
}

function scopePayload(scope: SessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return { sessionId: scope.sessionId, ...(scope.cwd != null ? { cwd: scope.cwd } : {}), ...extra }
}

export async function fsTree(scope: SessionScope, path: string): Promise<{ entries: FsEntry[] }> {
  return call('fs.tree', scopePayload(scope, { path }))
}

export async function fsRead(scope: SessionScope, path: string): Promise<FsTextResult | FsBinaryResult> {
  return call('fs.read', scopePayload(scope, { path }))
}

export async function fsWrite(scope: SessionScope, path: string, content: string): Promise<void> {
  await call('fs.write', scopePayload(scope, { path, content }))
}

// ─── /api — harness Typert gateway ───────────────────────────────────────────
//
// A Remote call is `POST /api/<ns>/<method>` carrying the client-request
// envelope; the gateway validates `args` against the generated descriptor,
// whose field names are the Host method's parameter names (hence `_request`
// for session/* — the Host parameter is spelled `_request`). The /api trust
// fence is Host/Origin-based, not per-plugin: a same-origin fetch from this
// page passes it like any other client call. Verified live against a running
// harness: session/list returns items, commands/list reaches agent lookup.

async function rpc<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method,
      payload: { args },
    }),
  })
  const full: { result?: { ok?: boolean; value?: T; error?: { message?: string } } } = await resp.json()
  if (!resp.ok || full.result?.ok !== true) {
    throw new Error(full.result?.error?.message ?? `HTTP ${resp.status}`)
  }
  return full.result.value as T
}

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
}

export async function sessionList(): Promise<SessionSummary[]> {
  const v = await rpc<{ items: SessionSummary[] }>('session/list', { _request: {} })
  return v.items
}

/** E1 liveness probe: find the session in the list, undefined when absent. */
// ponytail: first page only — the list covers every recently-updated session,
// which is the only kind a jump targets. Add cursor walking if archive jumps matter.
export async function sessionAlive(sessionId: string): Promise<SessionSummary | undefined> {
  return (await sessionList()).find(s => s.sessionId === sessionId)
}

export async function sessionCreate(cwd?: string): Promise<string> {
  const v = await rpc<{ sessionId: string }>('session/create', { _request: cwd === undefined ? {} : { cwd } })
  return v.sessionId
}

/** Non-blocking dispatch: queue one human message on the session's inbox. */
export async function sessionPrompt(sessionId: string, text: string): Promise<void> {
  await rpc('session/prompt', {
    _request: {
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  })
}

/** Run one slash command (e.g. `/plan-approve <doc>`) inside a session. */
export async function commandExecute(agentId: string, line: string): Promise<unknown> {
  return rpc('commands/execute', { agentId, line, submittedAttachments: [] })
}

export type { SessionScope, FsEntry, FsTextResult, FsBinaryResult }
