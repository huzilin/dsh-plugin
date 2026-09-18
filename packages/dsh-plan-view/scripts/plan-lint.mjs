#!/usr/bin/env node
/**
 * plan-lint — read-only structural lint for a repo's `.plan/` directory.
 *
 * Usage: node plan-lint.mjs [repo-root]     (defaults to cwd)
 *
 * Rules come from dsh-plan-view's skills/plan-protocol/SKILL.md §三「文档形态约定」;
 * this script is only their executor — change the protocol first, then this.
 *
 * Checks:
 *   1. duplicate-ticket  — one ticket id living in more than one directory (双档).
 *   2. missing-map       — a directory holding ticket-like .md files that has no
 *                          map.md on the path from .plan/ (the plan view skips the
 *                          whole directory, so its tickets are invisible).
 *   3. status-header     — `type: approval` documents missing the four-field header
 *                          (type/date/status/origin) or carrying a status outside the
 *                          protocol vocabulary; task tickets with an unknown status.
 *
 * Output: one `<path>: <rule> — <detail>` line per violation, exit 1 when any.
 * Reads only. Never writes.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'

const root = process.argv[2] ? process.argv[2].replace(/\/+$/, '') : process.cwd()
const planDir = join(root, '.plan')

if (!existsSync(planDir)) {
  console.error(`plan-lint: no .plan/ under ${root}`)
  process.exit(2)
}

// ── collect every .md under .plan/, skipping archives ────────────────────────
const SKIP = new Set(['.archive', 'node_modules', 'assets', 'qa'])

const violations = []
const files = [] // { path (repo-relative), abs, dir, frontmatter, body }

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const fm = {}
  if (m && m[1] != null) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([^:]+):\s*(.*)$/)
      if (kv) fm[kv[1].trim()] = kv[2].trim()
    }
  }
  return { fm, hasHeader: Boolean(m) }
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP.has(name)) continue
      walk(abs)
    } else if (name.endsWith('.md')) {
      const raw = readFileSync(abs, 'utf8')
      const { fm, hasHeader } = parseFrontmatter(raw)
      files.push({
        abs,
        path: relative(root, abs),
        dir: dirname(abs),
        name,
        fm,
        hasHeader,
      })
    }
  }
}

walk(planDir)

// ── rule 1: duplicate ticket ids across directories (双档) ───────────────────
// A ticket id is its filename minus .md. Copy tickets for cross-reference must
// carry `superseded-by:` in their status — those are the sanctioned shape and
// do not count as drift.
const byId = new Map()
for (const f of files) {
  if (/^(map|readme)\.md$/i.test(f.name)) continue
  const id = f.name.replace(/\.md$/i, '')
  if (!byId.has(id)) byId.set(id, [])
  byId.get(id).push(f)
}
for (const [id, group] of byId) {
  if (group.length < 2) continue
  const drifted = group.filter(f => !(f.fm.status ?? '').startsWith('superseded-by'))
  // more than one home claims to be live
  if (drifted.length > 1) {
    violations.push(`${group[0].path}: duplicate-ticket — id "${id}" lives in ${group.length} places and ${drifted.length} of them lack a superseded-by status`)
  }
}

// ── rule 2: ticket-bearing directories with no map.md on their path ──────────
// The plan view only loads a directory as an effort when a map.md sits on the
// path from .plan/; tickets under an unmapped directory are silently invisible.
const TICKET_LIKE = /^(?!map\.md$|readme\.md$).+\.md$/i
const dirs = new Map()
for (const f of files) {
  if (!TICKET_LIKE.test(f.name)) continue
  if (!dirs.has(f.dir)) dirs.set(f.dir, [])
  dirs.get(f.dir).push(f)
}
function hasMapOnPath(dir) {
  let d = dir
  while (d.startsWith(planDir)) {
    if (existsSync(join(d, 'map.md'))) return true
    if (d === planDir) return false
    d = dirname(d)
  }
  return false
}
for (const [dir, group] of dirs) {
  if (dir === planDir) continue // root-level documents are legal without a map
  if (!hasMapOnPath(dir)) {
    violations.push(`${relative(root, dir)}/: missing-map — ${group.length} ticket-like file(s) under a directory the plan view will not load (no map.md on the path from .plan/)`)
  }
}

// ── rule 3: status headers ────────────────────────────────────────────────────
const APPROVAL_STATUS = new Set(['pending', 'closed', 'active', 'abandoned'])
const TICKET_STATUS = new Set(['open', 'todo', 'doing', 'done', 'closed'])
for (const f of files) {
  const type = (f.fm.type ?? '').toLowerCase()
  const status = f.fm.status ?? ''
  if (type === 'approval') {
    for (const field of ['type', 'date', 'status', 'origin']) {
      if (!f.fm[field]) {
        violations.push(`${f.path}: status-header — approval document missing frontmatter field "${field}"`)
      }
    }
    const head = status.split(':')[0].trim()
    if (status && !APPROVAL_STATUS.has(head) && !status.startsWith('superseded-by')) {
      violations.push(`${f.path}: status-header — approval status "${status}" is outside the vocabulary (pending/closed/superseded-by:<path>/active/abandoned)`)
    }
    if (!status) {
      violations.push(`${f.path}: status-header — approval document has no status`)
    }
  }
  if (type === 'task' && status && !TICKET_STATUS.has(status)) {
    violations.push(`${f.path}: status-header — task status "${status}" is outside the vocabulary (open/todo/doing/done/closed)`)
  }
  // A document that calls itself 待拍板 but carries no header at all: the
  // pre-protocol generation. Flagged so it can be headed or retired, not lost.
  if (!f.hasHeader && /待拍板/.test(f.name)) {
    violations.push(`${f.path}: status-header — filename claims 待拍板 but the file has no frontmatter header`)
  }
}

// ── report ────────────────────────────────────────────────────────────────────
if (violations.length === 0) {
  console.log(`plan-lint: ${files.length} markdown file(s) under .plan/, no violations.`)
  process.exit(0)
}
for (const v of violations) console.log(v)
console.log(`\nplan-lint: ${violations.length} violation(s) across ${files.length} file(s).`)
process.exit(1)
