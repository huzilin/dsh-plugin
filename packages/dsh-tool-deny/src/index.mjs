/**
 * dsh-tool-deny — remove host-injected tools from THIS preset's visible toolset.
 *
 * Motivation: the host (web profile) unconditionally registers a handful of
 * tools (restart_harness, notify_test, …) whose JSON schemas cost real tokens
 * (~1.3k here) — too much to waste on a 32k local model for tools this coding
 * preset doesn't need. This preset-scoped plugin uses the core tools service's
 * `restrict({deny})` to mask those globals for every agent nested under this
 * preset. The tools leave the model-facing schema AND the system prompt, so it
 * is a genuine token saving (not just an execution guard).
 *
 * Why a plugin row (vs. editing dsh-restart source): the restriction lives in
 * the preset's own scope layer, so it is per-preset by construction — full /
 * liangshen / team presets are untouched, and a future preset can trim any
 * tool (notify, dsh_approve_*, mcp__semantica_*, …) with the same one-liner.
 *
 * Defensive: `tools.restrict()` throws on any name that is not a registered
 * global, which would fail the whole preset mount. We therefore filter the
 * config.deny list down to names that actually resolve in the global view
 * (`ctx.tools.get(name)`), so a missing host tool degrades to a no-op instead
 * of breaking the preset.
 */
export const name = 'tool-deny'

/** The tools service must exist before we can restrict its globals. */
export const inject = ['tools']

export function apply(ctx, config) {
  const requested = config?.deny
  if (!Array.isArray(requested) || requested.length === 0) return

  const present = requested.filter(n => typeof n === 'string' && ctx.tools.get(n) !== undefined)
  if (present.length === 0) return

  // Restrict for this scope and everything nested under it (the agent chain).
  ctx.tools.restrict({ deny: present })
}
