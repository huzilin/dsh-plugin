/**
 * Minimal fetch wrapper for DSH sidebar API — reads fs.tree and fs.read.
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
  const parsed: { ok?: boolean; value?: unknown; error?: { message?: string } } = await resp.json()
  if (!resp.ok || parsed?.ok !== true || parsed?.value === undefined) {
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

export type { SessionScope, FsEntry, FsTextResult, FsBinaryResult }
