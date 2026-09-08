/**
 * dsh-zvec-router — workspace retrieval routing for DeepSeek Harness.
 *
 * Two independent contributions:
 *
 * 1. `code_search` — a composite tool that answers a workspace question with
 *    EXACT evidence first (ripgrep through the zvec-grep engine, exhaustive and
 *    read-from-disk) and SEMANTIC discovery second (the vector index, for
 *    questions whose wording or location is unknown). One call, one bounded
 *    response, both routes labelled so the model can tell an exhaustive list
 *    from a ranked sample.
 *
 * 2. Prompt guidance — shadows the first-party `tool:grep` / `tool:glob`
 *    sections so the model routes by evidence kind instead of habit. The
 *    native `grep` / `glob` tools stay registered and authoritative; nothing
 *    is intercepted or rewritten at dispatch time.
 *
 * Design constraints this file honours (each verified against the harness
 * source at packages/core/tools/src/index.ts):
 *
 * - `PreToolDecision` excludes argument rewriting, so routing can never be
 *   implemented by rewriting a `grep` call in `tools/pre-execute`. Guidance and
 *   a composite tool are the only seams that keep both routes available.
 * - `ctx.tools.register()` accepts a raw `{ name, description, parameters,
 *   output, execute }` definition. This plugin therefore imports nothing from
 *   `@deepseek-ai/dsh-tools`: it is installed as a symlink to a path outside
 *   the profile tree, where the profile's hoisted `@deepseek-ai/*` packages do
 *   not resolve.
 * - The zvec engine is a LONG-LIVED native resource (embedding model, file
 *   watcher, index handles). It is created lazily per workspace root, shared by
 *   every session on that root, and closed exactly once when this plugin's
 *   context is disposed.
 *
 * @module dsh-zvec-router
 */

/** Cordis plugin name. */
export const name = 'zvec-router'

/** The preset-scope services this plugin uses directly. */
export const inject = ['tools', 'systemPrompt', 'agents']

/** Default result budget per route, overridable through plugin config. */
const DEFAULTS = {
  exactLimit: 20,
  semanticLimit: 5,
  maxExactLimit: 100,
  maxSemanticLimit: 15,
  excerptChars: 700,
  timeoutMs: 30000,
  mountTool: true,
  routePrompt: true,
}

/** Engine package specifier — the only cross-version contract used here. */
const ENGINE_SPEC = '@zvec/zvec-grep'

/**
 * Directory whose `node_modules` should satisfy {@link ENGINE_SPEC}.
 *
 * A profile-installed plugin is often a symlink into a source tree outside the
 * profile (this one ships from `~/workdir/dsh-plugin/...`), and Node resolves a
 * bare specifier from the module's REAL path — so the profile's hoisted copy is
 * invisible and the import fails. Set this to the profile directory to resolve
 * from there instead; leave unset to resolve from this module's own location.
 * Read once at first use, not at import time, so a config change needs no
 * reload trickery.
 */
const RESOLVE_FROM_DIR = process.env.DSH_ZVEC_ROUTER_RESOLVE_FROM ?? ''

/**
 * Clamp one configured number into `[min, max]`, falling back when the value is
 * not a usable number.
 * @param {unknown} value - configured value.
 * @param {number} fallback - value used when `value` is not a finite number.
 * @param {number} min - inclusive lower bound.
 * @param {number} max - inclusive upper bound.
 * @returns {number} the clamped value.
 */
function clampNumber(value, fallback, min, max) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/**
 * Resolve plugin config against {@link DEFAULTS}.
 * @param {unknown} config - raw Cordis config object.
 * @returns {typeof DEFAULTS} the effective configuration.
 */
function resolveConfig(config) {
  const raw = config ?? {}
  return {
    exactLimit: clampNumber(raw.exactLimit, DEFAULTS.exactLimit, 1, DEFAULTS.maxExactLimit),
    semanticLimit: clampNumber(raw.semanticLimit, DEFAULTS.semanticLimit, 0, DEFAULTS.maxSemanticLimit),
    maxExactLimit: DEFAULTS.maxExactLimit,
    maxSemanticLimit: DEFAULTS.maxSemanticLimit,
    excerptChars: clampNumber(raw.excerptChars, DEFAULTS.excerptChars, 200, 4000),
    timeoutMs: clampNumber(raw.timeoutMs, DEFAULTS.timeoutMs, 1000, 300000),
    mountTool: raw.mountTool !== false,
    routePrompt: raw.routePrompt !== false,
    ...(typeof raw.embedding === 'string' && raw.embedding.length > 0 ? { embedding: raw.embedding } : {}),
    ...(typeof raw.device === 'string' && raw.device.length > 0 ? { device: raw.device } : {}),
  }
}

/**
 * Truncate one excerpt to a character budget, appending a marker when cut.
 * @param {string} text - full excerpt.
 * @param {number} max - character budget.
 * @returns {string} the bounded excerpt.
 */
function boundExcerpt(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`
}

/**
 * Normalize one engine item to the bounded shape returned to the model.
 * @param {Record<string, unknown>} item - one `ZvecGrepContextItem`.
 * @param {number} max - excerpt character budget.
 * @returns {Record<string, unknown>} the projected item.
 */
function projectItem(item, max) {
  const range = item.range ?? {}
  const file = item.file ?? {}
  const out = {
    path: typeof file.relativePath === 'string' ? file.relativePath : String(file.absolutePath ?? ''),
    status: item.status === 'possibly_stale' ? 'possibly_stale' : 'fresh',
    matchedBy: Array.isArray(item.matchedBy) ? item.matchedBy.join('+') : String(item.matchedBy ?? ''),
    content: boundExcerpt(typeof item.content === 'string' ? item.content : '', max),
  }
  if (typeof range.startLine === 'number') out.startLine = range.startLine
  if (typeof range.endLine === 'number') out.endLine = range.endLine
  if (typeof item.score === 'number') out.score = item.score
  return out
}

/**
 * One engine call bounded by a timeout so a stalled native resource surfaces as
 * a tool error instead of hanging the turn.
 * @param {Promise<unknown>} pending - the engine promise.
 * @param {number} timeoutMs - budget in milliseconds.
 * @returns {Promise<unknown>} the settled value.
 */
async function withTimeout(pending, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      pending,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`zvec engine did not respond within ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Import the zvec-grep engine module.
 *
 * Resolution is anchored at {@link RESOLVE_FROM_DIR} when set, because a
 * symlinked plugin's real path sits outside the profile tree where the engine
 * is installed. `createRequire(dir).resolve()` yields the engine's entry file,
 * which `import()` then loads by absolute URL — one specifier, one lookup, no
 * reliance on the plugin's own location.
 * @returns {Promise<typeof import('@zvec/zvec-grep')>} the module namespace.
 */
async function loadEngineModule() {
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const { readFile } = await import('node:fs/promises')
  for (const dir of resolveRoots()) {
    try {
      // Import the package's ESM entry file, not the package directory: a
      // directory has no default entry that honours the `exports` map.
      const pkg = join(dir, 'node_modules', ENGINE_SPEC)
      const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'))
      const entry = typeof manifest.exports?.['.'] === 'string'
        ? manifest.exports['.']
        : manifest.exports?.['.']?.import ?? manifest.main ?? 'dist/index.js'
      return await import(pathToFileURL(join(pkg, entry)).href)
    } catch {
      // Try the next root; a bare specifier import is the last resort below.
    }
  }
  return import(ENGINE_SPEC)
}

/**
 * Directories whose `node_modules/<ENGINE_SPEC>` should be tried, in order.
 *
 * The engine is installed in the DSH profile, but a symlinked plugin's real
 * path lies outside that tree, so a bare `import()` resolves from the plugin
 * and fails. Probing explicit roots is the portable fix: `import.meta.resolve`
 * ignores its parent argument on some Node versions, and `require.resolve`
 * cannot see an `exports`-only ESM package.
 * @returns {string[]} candidate profile directories.
 */
function resolveRoots() {
  const roots = []
  if (RESOLVE_FROM_DIR !== '') roots.push(RESOLVE_FROM_DIR)
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') {
    for (const profile of ['web', 'desktop']) roots.push(`${home}/profiles/${profile}`)
  }
  return roots
}

/**
 * Lazy per-workspace engine cache. `createZvecGrep` returns a promise, so the
 * cache holds the promise: concurrent callers on one root share one engine
 * instead of racing to create two.
 * @param {{ embedding?: string, device?: string }} options - engine options.
 * @returns {{ engineFor: (root: string) => Promise<any>, closeAll: () => Promise<void> }} the cache.
 */
function createEngineCache(options) {
  /** @type {Map<string, Promise<any>>} */
  const engines = new Map()
  /** @type {Promise<typeof import('@zvec/zvec-grep')> | undefined} */
  let modulePromise

  /**
   * Import the engine module once per process, resolving from
   * {@link RESOLVE_FROM_DIR} when one is configured.
   * @returns {Promise<typeof import('@zvec/zvec-grep')>} the module namespace.
   */
  const loadModule = () => (modulePromise ??= loadEngineModule().catch((error) => {
    // A failed import must not be cached as a rejection the plugin can never
    // recover from: drop it so a later call retries.
    modulePromise = undefined
    throw error
  }))

  return {
    engineFor(root) {
      const existing = engines.get(root)
      if (existing !== undefined) return existing
      const created = loadModule().then(module => module.createZvecGrep({ root, ...options }))
      engines.set(root, created)
      // Drop a failed creation so the next call retries rather than replaying
      // the same rejection forever.
      created.catch(() => {
        if (engines.get(root) === created) engines.delete(root)
      })
      return created
    },
    async closeAll() {
      const entries = [...engines.values()]
      engines.clear()
      const results = await Promise.allSettled(entries.map(async engine => (await engine).close()))
      const failed = results.filter(result => result.status === 'rejected')
      if (failed.length > 0) {
        throw new Error(`failed to close ${failed.length} zvec engine(s)`)
      }
    },
  }
}

/**
 * Build the `code_search` tool definition.
 *
 * Parameters are raw JSON Schema in the subset the registry enforces
 * (`type`/`properties`/`required`/`items`/`enum` + annotations; no
 * `default`, no `minimum`). Defaults are applied by {@link resolveConfig} and
 * by this tool's execute body — never by the schema.
 *
 * @param {{ engineFor: (root: string) => Promise<any> }} cache - engine cache.
 * @param {ReturnType<typeof resolveConfig>} config - effective config.
 * @returns {Record<string, unknown>} a registry-ready tool definition.
 */
function createCodeSearchTool(cache, config) {
  return {
    name: 'code_search',
    description: 'Search the working directory and return exact and semantic evidence in one call. '
      + '`pattern` runs a ripgrep regular expression and returns an EXHAUSTIVE, read-from-disk match list — use it for a known identifier, literal, error message, configuration key, or a complete list of occurrences. '
      + '`query` runs semantic retrieval and returns a RANKED SAMPLE of the most relevant regions — use it when the wording or location is unknown, or when the question spans architecture, relationships, or data flow. '
      + 'Give both when you have an anchor and an intent; give one when only one applies. '
      + 'Results carry `coverage` (`rg_exhaustive` / `rg_truncated` / `ranked_sample`) and per-item `status` (`fresh` / `possibly_stale`), so an exact list and a sample are never confusable. '
      + 'Use read on a cited range for surrounding context.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Ripgrep regular expression for an exhaustive, read-from-disk match list. Use for known identifiers, literals, or complete occurrence lists.',
        },
        query: {
          type: 'string',
          description: 'Natural-language intent for semantic discovery. Use when wording or location is unknown, or the question spans architecture, relationships, or data flow.',
        },
        path: {
          type: 'string',
          description: 'Restrict the search to this file or directory, relative to the working directory (or absolute). Omit to search the whole workspace.',
        },
        glob: {
          type: 'string',
          description: 'One glob filter selecting which files to search, e.g. "*.ts" or "**/*.test.ts".',
        },
        exactLimit: { type: 'integer', description: `Maximum exact matches to return, 1-${config.maxExactLimit}.` },
        semanticLimit: { type: 'integer', description: `Maximum semantic regions to return, 0-${config.maxSemanticLimit}.` },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string' },
          exact: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pattern: { type: 'string' },
              coverage: { type: 'string' },
              truncated: { type: 'boolean' },
              matches: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string' },
                    startLine: { type: 'integer' },
                    endLine: { type: 'integer' },
                    content: { type: 'string' },
                    status: { type: 'string' },
                    matchedBy: { type: 'string' },
                  },
                },
              },
              error: { type: 'string' },
            },
          },
          semantic: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string' },
              coverage: { type: 'string' },
              status: { type: 'string' },
              message: { type: 'string' },
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string' },
                    startLine: { type: 'integer' },
                    endLine: { type: 'integer' },
                    content: { type: 'string' },
                    status: { type: 'string' },
                    matchedBy: { type: 'string' },
                    score: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        required: ['root'],
      },
      /**
       * Project the canonical value onto model-facing text.
       * @param {unknown} _args - validated arguments.
       * @param {Record<string, unknown>} value - the canonical result.
       * @returns {{ type: 'text', text: string }[]} the rendered blocks.
       */
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    /**
     * Run one or both retrieval routes.
     * @param {Record<string, unknown>} args - validated arguments.
     * @param {{ agent?: { session?: { header?: { cwd?: string } } }, signal?: AbortSignal }} exec - execution context.
     * @returns {Promise<Record<string, unknown>>} the canonical result.
     */
    async execute(args, exec) {
      const root = exec.agent?.session?.header?.cwd
      if (typeof root !== 'string' || root.length === 0) {
        throw new Error('code_search requires a session workspace')
      }
      const pattern = typeof args.pattern === 'string' ? args.pattern : undefined
      const query = typeof args.query === 'string' ? args.query : undefined
      const exactLimit = clampNumber(args.exactLimit, config.exactLimit, 1, config.maxExactLimit)
      const semanticLimit = clampNumber(args.semanticLimit, config.semanticLimit, 0, config.maxSemanticLimit)
      const scope = {
        ...(typeof args.glob === 'string' && args.glob.trim() !== '' ? { globs: [args.glob] } : {}),
      }
      // The two routes filter by path through different knobs: `rgPaths` is read
      // only by the ripgrep route, `includePaths` only by the index route.
      const pathGiven = typeof args.path === 'string' && args.path.trim() !== ''
      const exactScope = { ...scope, ...(pathGiven ? { rgPaths: [args.path] } : {}) }
      const semanticScope = { ...scope, ...(pathGiven ? { includePaths: [args.path] } : {}) }

      if (pattern === undefined && query === undefined) {
        throw new Error('code_search requires `pattern` (exact, exhaustive) or `query` (semantic discovery)')
      }

      // Await engine creation BEFORE starting either route: on a cold start the
      // two routes otherwise race the index's read lock, and the loser surfaces
      // as a spurious `unavailable`.
      const engine = await cache.engineFor(root)
      /** @type {Record<string, unknown>} */
      const result = { root }
      /** @type {Promise<void>[]} */
      const routes = []

      if (pattern !== undefined) {
        routes.push((async () => {
          const entry = { pattern }
          try {
            const outcome = await withTimeout(
              engine.context({ root, query: pattern, rg: true, limit: exactLimit, ...exactScope, autoUpdate: false }),
              config.timeoutMs,
            )
            entry.coverage = outcome.coverage
            entry.truncated = outcome.coverage === 'rg_truncated'
            entry.matches = (outcome.items ?? []).map(item => projectItem(item, config.excerptChars))
          } catch (error) {
            entry.coverage = 'unavailable'
            entry.error = error instanceof Error ? error.message : String(error)
            entry.matches = []
          }
          result.exact = entry
        })())
      }

      if (query !== undefined && semanticLimit > 0) {
        routes.push((async () => {
          const entry = { query }
          try {
            const outcome = await withTimeout(
              engine.context({ root, query, limit: semanticLimit, ...semanticScope, autoUpdate: false }),
              config.timeoutMs,
            )
            entry.coverage = outcome.coverage
            entry.status = 'ready'
            entry.results = (outcome.items ?? []).map(item => projectItem(item, config.excerptChars))
          } catch (error) {
            // An absent or still-building index is a routing signal, not a
            // failure of the whole call: the exact route still answers.
            entry.status = 'unavailable'
            entry.message = error instanceof Error ? error.message : String(error)
            entry.results = []
          }
          result.semantic = entry
        })())
      }

      await Promise.all(routes)
      return result
    },
  }
}

/**
 * Guidance that replaces the first-party `tool:grep` / `tool:glob` sections for
 * one agent. The sections MUST be registered on the AGENT's own scope (via
 * `agent.ctx`), never on the preset's scope: `tool:grep` / `tool:glob` are
 * registered by `@deepseek-ai/dsh-tool-fs-search` as rows of the SAME preset
 * composition, so a preset-scope section with the same name is a duplicate
 * registration and fails the mount loudly (which is exactly what happened in
 * the first release). Registering on the deeper agent scope shadows the preset
 * copy — the documented most-specific-wins mechanism.
 * @param {boolean} hasTool - whether `code_search` is mounted.
 * @returns {{ name: string, text: string }[]} the sections to register.
 */
function routingSections(hasTool) {
  const first = hasTool
    ? 'Use code_search to answer a workspace question with both routes at once: pass `pattern` for an exhaustive, read-from-disk match list and/or `query` for semantic discovery.'
    : 'Search the workspace by evidence kind, not by habit: exact search for what you can name, semantic search for what you can only describe.'
  return [
    {
      name: 'tool:grep',
      text: `${first} `
        + 'Use exact search (`grep`, or code_search `pattern`) for a known identifier, literal, regular expression, configuration key, error message, or an exhaustive occurrence list — these are ripgrep matches read from disk, so they are complete and current. '
        + 'Use semantic search (`zvec_search`, or code_search `query`) when the wording or location is unknown, or when the question needs architecture, relationships, control flow, design rationale, or synthesis across files — those results are a ranked sample and may lag a recent edit by a moment. '
        + 'Do not use semantic search where an exhaustive list is required, and do not use exact search to discover code you cannot yet name.',
    },
    {
      name: 'tool:glob',
      text: 'Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. '
        + 'Results are files only, never directories, and include hidden and ignored files (VCS metadata directories are excluded). '
        + 'Use semantic search instead when the target is known by what it does rather than by its name or path.',
    },
  ]
}

/**
 * Mount the routing tool and guidance.
 *
 * The `code_search` tool has a unique name, so it registers on the preset's
 * own scope (visible to every agent composed under it, like `grep` / `glob`).
 * The `tool:grep` / `tool:glob` SHADOW sections, however, must go on each
 * AGENT's scope: their names are already taken by `tool-fs-search` rows in the
 * same preset composition, and a same-scope duplicate fails the mount.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} config - raw Cordis config object.
 * @returns {void}
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const cache = createEngineCache({
    ...(resolved.embedding !== undefined ? { embedding: resolved.embedding } : {}),
    ...(resolved.device !== undefined ? { device: resolved.device } : {}),
  })

  if (resolved.mountTool) {
    ctx.tools.register(createCodeSearchTool(cache, resolved))
  }

  // Per-agent section shadowing. Registering on `agent.ctx` scopes the sections
  // to that one agent (a descendant of the preset standing scope), so they
  // shadow the `tool-fs-search` originals instead of colliding with them.
  // A section fiber registered under the agent's ctx is torn down with the
  // agent, so no explicit disposal is needed here.
  const sections = routingSections(resolved.mountTool)
  const installSections = (agent) => {
    agent.ctx.inject(['systemPrompt'], (scope) => {
      for (const section of sections) {
        scope.systemPrompt.section({
          name: section.name,
          order: scope.systemPrompt.getSectionOrder(section.name === 'tool:grep' ? 'TOOL_GREP' : 'TOOL_GLOB'),
          text: section.text,
        })
      }
    })
  }

  if (resolved.routePrompt) {
    for (const agent of ctx.agents.list()) installSections(agent)
    ctx.on('agent/created', ({ agent }) => { installSections(agent) })
  }

  ctx.effect(() => async () => {
    try {
      await cache.closeAll()
    } catch (error) {
      ctx.logger.warn(`zvec-router: engine cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, 'zvec-router: engine disposal')
}
