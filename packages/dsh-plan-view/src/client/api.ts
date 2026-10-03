/**
 * Fetch wrappers for the dsh-plan-view client.
 *
 * Two channels, both same-origin fetches from this page:
 *   /plan-view/<method>   — this plugin's own data plane (snapshot + ticket
 *                           write-back; server half in lib/server.js). Since
 *                           票19 (2026-09-30 拍板「完全解耦」) this replaced the
 *                           better-sidebar /sidebar/api fs surface, whose
 *                           per-call cost (~100ms, fully serialized) made the
 *                           tab load in ~10s; one snapshot request now covers
 *                           the whole load.
 *   /api/<ns>/<method>    — the harness Typert gateway (sessions list/liveness).
 * Self-contained: no better-sidebar dependency remains.
 */

interface SessionScope {
  sessionId: string
  cwd?: string
}

/** One governance snapshot: everything the tab renders, in one response. */
export interface Snapshot {
  cwd: string
  efforts: { dir: string; mapRaw: string; specRaw: string | null; prototypes: { name: string; path: string }[] }[]
  files: { path: string; name: string; from: string; group: string; content: string }[]
  rounds: { ids: string[]; readmeRaw: string | null }
  contextRaw: string
}

async function planView<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`/plan-view/${method}`, {
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

/** Load the whole governance view in one request. cwd comes back server-resolved. */
export function snapshot(sessionId: string, round?: string): Promise<Snapshot> {
  return planView<Snapshot>('snapshot', round === undefined ? { sessionId } : { sessionId, round })
}

/**
 * B1 binding write-back: upsert one frontmatter key on a ticket file. The
 * server does read-modify-write atomically, so the client never needs the
 * file's current content (fsRead left with the better-sidebar decoupling).
 */
export function bindTicket(sessionId: string, path: string, key: string, value: string): Promise<void> {
  return planView<void>('write', { sessionId, path, key, value })
}

/**
 * 原型预览 URL（2026-10-04 票 24）：iframe src 直接指向服务端只读 GET 端点，
 * html 内容不进 snapshot（膨胀）。路径围栏在服务端（cwd 内 + /prototype/*.html）；
 * 变体切换（#variant=…）是文档内 hash 行为，归原型自带的切换器管。
 */
export function prototypeUrl(sessionId: string, path: string): string {
  return `/plan-view/prototype?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
}

// ─── /api — harness Typert gateway ───────────────────────────────────────────
//
// A Remote call is `POST /api/<ns>/<method>` carrying the client-request
// envelope; the gateway validates `args` against the generated descriptor,
// whose field names are the Host method's parameter names, verbatim:
// session/list takes `_request` (its Host parameter is `_request`). The /api
// trust fence is Host/Origin-based, not per-plugin: a same-origin fetch from
// this page passes it like any other client call.
//
// Dispatch no longer goes through this surface: session/prompt (auto-send),
// session/create and commands/execute were retired when the action layer moved
// to draft-first injection (input-bridge + the client-runtime `sessions`
// service) — buttons now fill the composer and the human sends.

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


export type { SessionScope }
