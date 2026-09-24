/**
 * Plan view v2: reads .plan/ wayfinder maps, derives ticket status per
 * the TRACKER-MARKDOWN contract, and renders three views:
 *   A — Kanban (grouped list with destination banner + progress)
 *   C — Table (filterable/sortable data grid)
 *   D — Relation graph (tiered DAG with Start/End nodes)
 *
 * All three share a unified dark theme and markdown-rendered detail panels.
 * Self-contained: uses its own api module, inline styles, zero CSS deps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fsRead, fsTree, fsWrite, sessionAlive, sessionList,
  type SessionScope, type SessionSummary, type FsEntry,
} from './api'
import { deliverDraft } from './input-bridge'

// ─── Types ──────────────────────────────────────────────────────────────────

type TicketStatus = 'resolved' | 'out_of_scope' | 'claimed' | 'open'

interface ParsedTicket {
  id: string; file: string; title: string; type: string | undefined
  blockedBy: string[]; resolved: boolean; outOfScope: boolean; claimedBy: string | undefined
  status: string | undefined  // frontmatter `status` — the portable state field
  date: string | undefined    // frontmatter `date` — used for "how long has this been pending"
  origin: string | undefined  // frontmatter `origin` — why an approval doc exists
  session: string | undefined       // frontmatter `session` — the session bound to this ticket (B1)
  originSession: string | undefined // frontmatter `origin_session` — the session that produced an approval (B1)
  qaCases: boolean            // frontmatter `qa_cases: true` — 测例已构建（to-qa-testcases 回写）
  qaTested: boolean           // frontmatter `qa_tested: true` — 测例已执行（run-qa-testcases 回写）
  qaAccepted: boolean         // frontmatter `qa_accepted: true` — 验收通过（AC 全过 + 无未关闭缺陷）
  path?: string               // resolved fs path, since tickets are not always under tickets/
  effort?: string             // which effort dir this came from; ROOT_GROUP for .plan's own top level
  group?: string              // subdirectory within the effort: 'tickets' | 'impl' | 'impl-fe' | …
  body: string  // full markdown body for detail panels
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {}; let body = raw
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m && m[1] != null) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([^:]+):\s*(.*)$/)
      if (kv?.[1] != null && kv?.[2] != null) fm[kv[1].trim()] = kv[2].trim()
    }
    body = m[2] ?? ''
  }
  return { fm, body }
}

function deriveTicketStatus(file: string, raw: string): ParsedTicket {
  const { fm, body } = parseFrontmatter(raw)
  const hasAnswer = /^## Answer\b/m.test(body) && /^## Answer\b[\s\S]*\n\S/m.test(body)
  const hasRuledOut = /^## Ruled out\b/m.test(body) && /^## Ruled out\b[\s\S]*\n\S/m.test(body)
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  return {
    id: ticketId(file),
    file, title: titleMatch?.[1]?.replace(/`[^`]*`/g, '')?.trim() ?? file,
    type: fm.type,
    blockedBy: parseBlockedBy(fm.blocked_by),
    resolved: hasAnswer, outOfScope: hasRuledOut, claimedBy: fm.claimed_by,
    status: fm.status, date: fm.date, origin: fm.origin,
    session: fm.session, originSession: fm['origin_session'], body,
    qaCases: fm.qa_cases === 'true', qaTested: fm.qa_tested === 'true', qaAccepted: fm.qa_accepted === 'true',
  }
}

/**
 * Set (or add) one frontmatter key in a raw document, preserving everything
 * else. This is the B1 write-back: dispatching work from the plan view binds
 * the session id onto the ticket so the next click jumps back instead of
 * forking a new session.
 */
function upsertFrontmatterKey(raw: string, key: string, value: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m && m[1] != null) {
    const lines = m[1].split('\n')
    const i = lines.findIndex(l => l.startsWith(`${key}:`))
    if (i >= 0) lines[i] = `${key}: ${value}`
    else lines.push(`${key}: ${value}`)
    return `---\n${lines.join('\n')}\n---\n${m[2] ?? ''}`
  }
  return `---\n${key}: ${value}\n---\n\n${raw}`
}

// Status vocabulary shared by both conventions in the wild: wayfinder's
// body-section markers (`## Answer` / `## Ruled out`) and a plain frontmatter
// `status` field, which is what non-wayfinder repos write. Both are honoured;
// the section markers win when present, since they carry more detail.
const DONE_STATUS = new Set(['done', 'closed', 'resolved', 'complete', 'completed', 'shipped'])
const OUT_STATUS = new Set(['abandoned', 'rejected', 'wontfix', "won't fix", 'cancelled', 'canceled', 'superseded'])
const CLAIMED_STATUS = new Set(['doing', 'in_progress', 'in-progress', 'wip', 'claimed', 'in review', 'review'])

// A status string may arrive as `done`, or with a trailing note
// (`done # 2026-09-12 交付`), or `superseded-by:<path>`. Compare on the head word.
function statusWord(t: ParsedTicket): string {
  const raw = (t.status ?? '').trim().toLowerCase()
  if (raw.startsWith('superseded-by')) return 'superseded'
  return raw.split(/[\s(#:—-]/)[0] ?? ''
}

function displayStatus(t: ParsedTicket): TicketStatus {
  if (t.outOfScope) return 'out_of_scope'
  if (t.resolved) return 'resolved'
  const w = statusWord(t)
  if (DONE_STATUS.has(w)) return 'resolved'
  if (OUT_STATUS.has(w)) return 'out_of_scope'
  if (t.claimedBy) return 'claimed'
  if (CLAIMED_STATUS.has(w)) return 'claimed'
  return 'open'
}

// ─── Ticket identity ─────────────────────────────────────────────────────────
//
// A ticket's id is its filename without the extension: `W1-写作台IA重构`,
// `R12-定稿管线终校与关联域合并`, `01`. Wayfinder repos happen to use bare
// numbers as filenames, so their ids stay numeric and old behaviour is kept;
// repos that use names get distinct ids instead of all collapsing to one node.

function ticketId(file: string): string { return file.replace(/\.md$/i, '') }

// The short form shown in the circular badge: the leading run of letters+digits
// (`01`, `W1`, `SET1`, `R12`), falling back to the start of a name-only file.
// Wayfinder's bare numbers keep their old look.
function shortId(t: ParsedTicket): string {
  const m = t.id.match(/^([A-Za-z]*\d+)/)
  // ponytail: 4 chars is a badge, not a title — wider ids truncate, never wrap.
  return (m?.[1] ?? t.id).slice(0, 4).toUpperCase()
}

// `blocked_by` is written several ways across repos: `[02]`, `["W3-大纲版本化"]`,
// `["R2"]`, even `["../state-machine/改造工单/R12-….md"]`. Normalise each entry to
// the same space as ticketId so the dependency graph can actually resolve them.
function normalizeRef(raw: string): string {
  const s = raw.trim().replace(/^["']|["']$/g, '').split('/').pop() ?? ''
  return ticketId(s)
}

function parseBlockedBy(value: string | undefined): string[] {
  return (value ?? '').replace(/[\[\]]/g, '').split(',').map(normalizeRef).filter(Boolean)
}

// Resolve a normalised ref against the ids actually present. Bare numbers must
// match zero-padded filenames (`2` → `02`); a name must match its file with or
// without the `.md` suffix, and a title fragment matches its leading id.
function resolveRef(ref: string, byId: Map<string, ParsedTicket>): string | undefined {
  if (byId.has(ref)) return ref
  if (/^\d+$/.test(ref)) {
    const padded = ref.padStart(2, '0')
    if (byId.has(padded)) return padded
  }
  for (const id of byId.keys()) {
    // `W3` should find `W3-大纲版本化`; `R12` should find `R12-定稿管线…`.
    if (id === ref || id.startsWith(`${ref}-`) || id.split('-')[0] === ref) return id
  }
  return undefined
}

// ─── Markdown renderer (lightweight, zero deps) ──────────────────────────────
//
// Block-structured rather than chained regexes: the ticket bodies are mostly
// tables (thousands of rows), block quotes, code fences and ordered lists, and a
// line-by-line pass is the only way to get those right. Inline formatting is
// applied inside each block after the block shape is settled.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline spans: code, bold, italic, links. Runs on already-escaped text. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="pvm-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="pvm-a" href="$2" target="_blank" rel="noreferrer">$1</a>')
}

const splitRow = (line: string) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const isDivider = (line: string) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')

function md(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  let para: string[] = []
  let list: string[] = []       // ul buffer
  let olist: string[] = []      // ol buffer
  let quote: string[] = []

  const flushPara = () => {
    if (para.length) { out.push(`<p class="pvm-p">${para.map(inline).join('<br/>')}</p>`); para = [] }
  }
  const flushList = () => {
    if (list.length) { out.push(`<ul class="pvm-ul">${list.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`); list = [] }
  }
  const flushOlist = () => {
    if (olist.length) { out.push(`<ol class="pvm-ol">${olist.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`); olist = [] }
  }
  const flushQuote = () => {
    if (quote.length) { out.push(`<blockquote class="pvm-quote">${quote.map(inline).join('<br/>')}</blockquote>`); quote = [] }
  }
  const flushAll = () => { flushPara(); flushList(); flushOlist(); flushQuote() }

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced code: consume verbatim until the closing fence (or EOF).
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      flushAll()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? '')) { buf.push(lines[i] ?? ''); i++ }
      i++ // closing fence
      out.push(`<pre class="pvm-pre"><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    // Table: a header row followed by a divider row.
    if (line.includes('|') && isDivider(lines[i + 1] ?? '')) {
      flushAll()
      const head = splitRow(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && (lines[i] ?? '').includes('|') && !/^\s*$/.test(lines[i] ?? '')) {
        body.push(splitRow(lines[i] ?? '')); i++
      }
      out.push(
        '<div class="pvm-tw"><table class="pvm-table"><thead><tr>'
        + head.map(c => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>',
      )
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h && h[1] && h[2] !== undefined) {
      flushAll()
      const lvl = h[1].length
      const tag = lvl <= 1 ? 'h2' : lvl === 2 ? 'h3' : 'h4'
      out.push(`<${tag} class="pvm-h">${inline(h[2])}</${tag}>`)
      i++; continue
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); out.push('<hr class="pvm-hr"/>'); i++; continue }

    const q = line.match(/^>\s?(.*)$/)
    if (q) { flushPara(); flushList(); flushOlist(); quote.push(q[1] ?? ''); i++; continue }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) { flushPara(); flushOlist(); flushQuote(); list.push(ul[1] ?? ''); i++; continue }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) { flushPara(); flushList(); flushQuote(); olist.push(ol[1] ?? ''); i++; continue }

    if (/^\s*$/.test(line)) { flushAll(); i++; continue }

    flushList(); flushOlist(); flushQuote()
    para.push(line)
    i++
  }
  flushAll()
  return out.join('')
}

// ─── Theme — DSH dark palette ───────────────────────────────────────────────
//
// Values mirror `@deepseek-ai/dsh-client-ui-theme`'s dark mapping
// (design-platform.css: neutral-bluish layers, white-alpha borders, the
// deepseek/blue accents). Hard-coded rather than read from CSS variables
// because this view is self-contained inline styles — depending on the host
// having loaded the theme stylesheet would make it break outside the web shell.
// Declared before MD_CSS and every other top-level consumer: module
// evaluation is top-down, so a const used above its declaration is a TDZ error.

const BG = '#151517'          // neutral-bluish-950 — page
const HEADER_BG = '#1b1b1c'   // 900 — bars, panels
const CARD = '#232324'        // 875 — cards, layer-1
const CARD_DARK = '#1f1f20'   // between 900 and 875 — recessed cards
const RAISED = '#2c2c2e'      // 850 — hover/raised, layer-2
const TEXT = '#e9ecf2'        // bluish-150 — primary text
const TEXT_DIM = '#adb2b8'    // bluish-400 — secondary text
const TEXT_FAINT = '#81858c'  // bluish-600 — tertiary/meta
const BORDER = 'rgba(255,255,255,.10)'        // border-l2
const BORDER_LIGHT = 'rgba(255,255,255,.06)'  // border-l1
const ACCENT = '#4176e6'      // deepseek-500 — brand
const ACCENT_SOFT = '#609bfa' // blue-400
const CHIP_BG = 'rgba(255,255,255,.07)'

// Scoped styles for the rendered body. Kept here (not in a stylesheet) so the
// view stays self-contained; injected once per mount via a <style> tag.
const MD_CSS = `
.pvm-p{margin:.5em 0;line-height:1.75}
.pvm-h{margin:1.1em 0 .5em;font-weight:700;color:${TEXT};line-height:1.4}
h2.pvm-h{font-size:17px;border-bottom:1px solid ${BORDER_LIGHT};padding-bottom:.3em}
h3.pvm-h{font-size:15px}
h4.pvm-h{font-size:13.5px;color:${TEXT_DIM}}
.pvm-ul,.pvm-ol{margin:.5em 0;padding-left:1.5em}
.pvm-ul li,.pvm-ol li{margin:.25em 0;line-height:1.7}
.pvm-quote{margin:.6em 0;padding:.5em .9em;border-left:3px solid ${ACCENT};background:rgba(255,255,255,.04);border-radius:0 6px 6px 0;color:${TEXT_DIM}}
.pvm-code{background:rgba(255,255,255,.09);padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;color:${ACCENT_SOFT}}
.pvm-pre{margin:.7em 0;padding:.8em 1em;background:#141416;border:1px solid ${BORDER_LIGHT};border-radius:8px;overflow:auto}
.pvm-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${TEXT_DIM};white-space:pre}
.pvm-tw{margin:.7em 0;overflow:auto;border:1px solid ${BORDER_LIGHT};border-radius:8px}
.pvm-table{border-collapse:collapse;width:100%;font-size:12.5px}
.pvm-table th{background:${RAISED};color:${TEXT};font-weight:700;text-align:left;padding:7px 10px;border-bottom:1px solid ${BORDER};white-space:nowrap}
.pvm-table td{padding:7px 10px;border-bottom:1px solid ${BORDER_LIGHT};color:${TEXT_DIM};vertical-align:top}
.pvm-table tr:last-child td{border-bottom:none}
.pvm-a{color:${ACCENT_SOFT};text-decoration:none}
.pvm-a:hover{text-decoration:underline}
.pvm-hr{border:none;border-top:1px solid ${BORDER_LIGHT};margin:1em 0}
`

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_THEME: Record<string, { icon: string; color: string }> = {
  research: { icon: '🔍', color: ACCENT }, grilling: { icon: '🔥', color: '#f2555a' },
  prototype: { icon: '🛠️', color: '#f7ad31' }, task: { icon: '⚡', color: ACCENT_SOFT },
}
// Types a repo actually writes that are not in the table above. Kept separate so
// an unknown type shows a neutral bullet rather than a bare "?" — a question
// mark reads as "something is broken", which it never is.
const TYPE_FALLBACK = { icon: '•', color: '#888' }
// Sentinel for "this file declares no type" — a real bucket, never a hidden one.
const NO_TYPE = '\u0000no-type'
const typeTheme = (t: string | undefined) => TYPE_THEME[t ?? ''] ?? TYPE_FALLBACK
const DOT: Record<string, string> = { open: '#81858c', claimed: '#f7ad31', resolved: '#4ed17e', out_of_scope: '#61666b' }
const STATUS_LABELS: Record<TicketStatus, string> = { open: 'Open', claimed: 'Claimed', resolved: 'Resolved', out_of_scope: 'Out of scope' }
const STATUS_ORDER: TicketStatus[] = ['open', 'claimed', 'resolved', 'out_of_scope']

// ─── "Waiting on you" ────────────────────────────────────────────────────────
//
// The reason this view exists: work does not only sit in tickets. An approval
// document holds decisions that are blocked on the human, and those are the
// ones that get forgotten — nobody re-reads a document to discover it is still
// waiting. So a `status: pending` document is surfaced as its own kind of item,
// carrying how long it has been waiting.

// ─── Kinds: a ticket asks for work, an approval asks for a ruling ────────────
//
// The two are different objects sharing a directory. A ticket is work to be
// executed; an approval is a decision blocked on the human, and carries a
// lifecycle (pending → closed) that a ticket does not. The view labels them so
// a reader knows which one they are looking at without opening it.

type TicketKind = 'ticket' | 'approval' | 'ledger' | 'defect' | 'cases' | 'note'

// 票型词表（plan-protocol §三）：声明这些 type 的文档才主张「要干活」，归工单。
// approval / qa-defect / ledger 三个保留 type 在下方分支单独接走；词表外的
// type 值按「说明 / 杂项」解析，不作单据校验对象（2026-09-24 协议补条）。
const TICKET_TYPES = new Set(['task', 'impl', 'research', 'prototype', 'grilling'])

/** Approval documents are `type: approval`, or any doc carrying a pending-style status. */
function ticketKind(t: ParsedTicket): TicketKind {
  const ty = (t.type ?? '').trim().toLowerCase()
  if (ty === 'approval') return 'approval'
  // An explicit `type` beats a status inference: a defect/ledger frontmatter may
  // lawfully carry `status: pending` (plan-protocol five states), which must not
  // re-route it to approvals — the qa whitelist would then silently drop it.
  if (ty === 'qa-defect') return 'defect'
  // A ledger (挂账台账) is the plan's standing debt register. It asks for work
  // only when its 启动条件 (start condition) is met, so it must not surface as
  // a ticket or repeat inside every map — it gets its own tab.
  if (ty === 'ledger') return 'ledger'
  // 测试用例设计文档：图内一图一份 `qa/cases.md`（地图「🧪 测例」子页）；
  // 根层 `qa/cases-*.md` 是无图归属的回测测例（SOP/整页回测），进第一层
  // 「🧪 测例&缺陷」tab。均由路径识别，不加 frontmatter。
  if (t.group === 'qa' && (t.file === 'cases.md' || /^cases-/.test(t.file))) return 'cases'
  if (isPending(t)) return 'approval'
  // map/spec/index documents describe the effort rather than asking for work.
  if (ty === 'spec' || ty === 'design' || /^(map|readme|index)$/i.test(t.id)) return 'note'
  // A document declaring neither a type nor a status is not claiming to be a
  // ticket — it is a note (a research record, a handoff). Counting it
  // as a ticket invented work that did not exist, so it is classified neutral.
  // Both fields are read because either one is a claim of intent; a real ticket
  // states at least one.
  if (!ty && !t.status) return 'note'
  // 有 type 但词表外：协议规定按说明/杂项解析。pending 推断仍在上游先生效——
  // 历史待拍板档可能不带 type: approval，不能因 type 词表外被挤出「待拍板」页。
  if (ty && !TICKET_TYPES.has(ty)) return 'note'
  return 'ticket'
}

const KIND_META: Record<TicketKind, { label: string; icon: string; color: string }> = {
  ticket: { label: '工单', icon: '🎫', color: ACCENT_SOFT },
  approval: { label: '待拍板', icon: '⏳', color: '#f7ad31' },
  ledger: { label: '台账', icon: '📒', color: '#4ed17e' },
  defect: { label: '缺陷', icon: '🐞', color: '#f2555a' },
  cases: { label: '测例', icon: '🧪', color: '#609bfa' },
  note: { label: '说明', icon: '📄', color: TEXT_FAINT },
}

// ─── Map kinds: 推演图 vs 实施图 ─────────────────────────────────────────────
//
// 一个 effort 是推演图（wayfinder：票型 research/grilling/prototype，终点=决策
// 清零）还是实施图（票型 task/impl，终点=落码验收），由票型推导——不需要文档
// 自我声明。两类图工作流不同（推演靠讨论，实施靠派工），展示上分两组。
type MapKind = 'speculation' | 'impl'

const SPECULATION_TYPES = new Set(['research', 'grilling', 'prototype'])
const IMPL_TYPES = new Set(['task', 'impl'])

function mapKind(dir: string, tickets: ParsedTicket[]): MapKind | undefined {
  let speculation = false, impl = false
  for (const t of tickets) {
    if (t.effort !== dir) continue
    const ty = (t.type ?? '').trim().toLowerCase()
    if (SPECULATION_TYPES.has(ty)) speculation = true
    if (IMPL_TYPES.has(ty)) impl = true
  }
  if (speculation) return 'speculation'
  if (impl) return 'impl'
  return undefined
}

const MAP_KIND_META: Record<MapKind, { label: string; icon: string }> = {
  speculation: { label: '推演图', icon: '🗺️' },
  impl: { label: '实施图', icon: '🛠️' },
}

/** Frontmatter `status` marks a document as an approval awaiting a ruling. */
function isPending(t: ParsedTicket): boolean { return statusWord(t) === 'pending' }

/** Whole days since the document's `date`. Undefined when there is no usable date. */
function ageDays(t: ParsedTicket): number | undefined {
  if (!t.date) return undefined
  const then = Date.parse(t.date)
  if (Number.isNaN(then)) return undefined
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

function ageLabel(t: ParsedTicket): string | undefined {
  const d = ageDays(t)
  if (d === undefined) return undefined
  if (d === 0) return '今天'
  return `挂了 ${d} 天`
}

// ─── Archive rounds（历史轮次）───────────────────────────────────────────────
//
// plan-archive 把走完的一轮整目录 `git mv` 进 `.archive/rounds/<round-id>/`，
// 轮目录就是该轮当时 `.plan/` 的快照（map + tickets + 待拍板，结构原样）。
// 所以「看历史轮」不需要新解析器：把现有的加载逻辑指到轮目录即可。
// 轮次清单按目录名（round-id 以日期开头是归档格式约定）；主题从
// `.archive/README.md` 的「轮次索引」表读，读不到就只显示目录名。

interface RoundInfo { id: string; topic?: string }

function parseRoundsIndex(raw: string): Map<string, RoundInfo> {
  const out = new Map<string, RoundInfo>()
  let inSection = false  // 正处于「轮次索引」节
  let inTable = false    // 节内表格已开始
  for (const line of raw.split('\n')) {
    if (/^#{1,6}\s/.test(line)) { inSection = /^#{1,6}\s+轮次索引/.test(line); inTable = false; continue }
    if (!line.trimStart().startsWith('|')) {
      // 表随非 `|` 行结束；只认节内第一张表，后续其他表（如示例）不再收
      if (inTable) { inSection = false; inTable = false }
      continue
    }
    if (!inSection) continue
    inTable = true
    const cells = line.split('|').map(c => c.trim())
    const id = (cells[1] ?? '').replace(/`/g, '')
    // 跳过表头与 `|:--|` 分隔行
    if (!id || id.includes('--') || id === 'round-id') continue
    out.set(id, { id, topic: cells[2] || undefined })
  }
  return out
}

async function loadRounds(scope: SessionScope, root: string): Promise<RoundInfo[]> {
  let tree: { entries: FsEntry[] }
  try { tree = await fsTree(scope, `${root}/.archive/rounds`) } catch { return [] }
  const ids = tree.entries
    .filter((e: FsEntry) => e.isDir && /^\d{4}-\d{2}-\d{2}/.test(e.name))
    .map((e: FsEntry) => e.name)
    .sort()
    .reverse() // 新轮在前
  if (ids.length === 0) return []
  const meta = await fsRead(scope, `${root}/.archive/README.md`)
    .then(r => r.kind === 'text' ? parseRoundsIndex(r.content) : new Map<string, RoundInfo>())
    .catch(() => new Map<string, RoundInfo>())
  return ids.map(id => meta.get(id) ?? { id })
}

// ─── Data loading ────────────────────────────────────────────────────────────

const mdEntries = (tree: { entries: FsEntry[] }) => tree.entries.filter((e: FsEntry) => e.name.endsWith('.md') && !e.isDir)

// Marks files read from `.plan/`'s own top level, which belong to no effort.
const ROOT_GROUP = '\u0000root'

// Ticket files live in different shapes across repos:
//   wayfinder : <effort>/tickets/*.md      (its own directory, the original contract)
//   novel     : <effort>/*.md              (beside map.md)
//               <effort>/impl-fe/*.md      (one level down, grouped by workstream)
// Read all that exist rather than assuming one, so a repo only has to match
// *a* convention instead of this view's.
async function collectTicketFiles(scope: SessionScope, effortDir: string): Promise<{ file: FsEntry; group: string }[]> {
  const tree = await fsTree(scope, effortDir)
  const inTickets = tree.entries.find((e: FsEntry) => e.isDir && e.name === 'tickets')
  // Read every ticket source this effort has, rather than stopping at the first
  // one found. An effort commonly holds both the wayfinder-native `tickets/` and
  // workstream directories beside it (`impl/`, `impl-fe/`); returning early on
  // `tickets/` would silently hide every ticket in the others.
  //
  // Each file keeps the name of the subdirectory it came from, so a view can
  // separate e.g. design tickets from implementation ones.
  //
  // Skip map/spec/readme companions: they describe the effort, they are not tickets.
  const NON_TICKET = /^(map|spec|tech-spec|fe-v1-spec|readme)\.md$/i
  const subDirs = tree.entries.filter((e: FsEntry) => e.isDir && !e.hidden && e.name !== 'node_modules')
  const groups = await Promise.all([
    inTickets ? fsTree(scope, inTickets.path).then(t => mdEntries(t).map(f => ({ file: f, group: 'tickets' }))) : Promise.resolve([]),
    Promise.resolve(mdEntries(tree).map(f => ({ file: f, group: ROOT_GROUP }))),
    ...subDirs
      .filter((d: FsEntry) => d.name !== 'tickets')
      .map(async (d: FsEntry) => mdEntries(await fsTree(scope, d.path)).map(f => ({ file: f, group: d.name }))),
  ])
  const seen = new Set<string>()
  const all: { file: FsEntry; group: string }[] = []
  for (const e of groups.flat()) {
    if (NON_TICKET.test(e.file.name) || seen.has(e.file.path)) continue
    seen.add(e.file.path)
    all.push(e)
  }
  return all
}

// ─── Four views, one collection pass ─────────────────────────────────────────
//
// The tab shows the different things that happen to share a directory:
//   路线 (route)     — the wayfinder map: an effort's destination and its DAG
//   工单 (tickets)   — work waiting to be done
//   待拍板 (approvals) — decisions waiting on the human
//   台账 (ledger)    — standing debts across maps (挂账台账)
//   缺陷 (defects)   — test-found bugs, scoped to one map (缺陷台账)
// They are collected together, then split by kind, so each view is one filter
// over the same data rather than three loaders that can disagree.

interface PlanData {
  tickets: ParsedTicket[]      // every markdown file found, with its kind resolved
  effortDir: string
  mapRaw: string | null
  efforts: { dir: string; mapRaw: string }[]  // every effort that has a map
}

function classify(t: ParsedTicket): TicketKind { return ticketKind(t) }

async function loadPlan(scope: SessionScope, planDir: string): Promise<PlanData | null> {
  const rootTree = await fsTree(scope, planDir)
  const hasMapHere = rootTree.entries.some((e: FsEntry) => e.name === 'map.md' && !e.isDir)
  // A `.plan/` may hold several efforts side by side, each with its own map.md
  // (novel has two: the workbench and the backend effort). Read every one of
  // them — picking the first would silently hide the others.
  const subDirs = rootTree.entries.filter((e: FsEntry) => e.isDir && !e.hidden && e.name !== 'node_modules')
  const subMaps = await Promise.all(subDirs.map(async (d: FsEntry) => (
    (await fsTree(scope, d.path)).entries.some((e: FsEntry) => e.name === 'map.md' && !e.isDir) ? d.path : null
  )))
  const effortDirs = subMaps.filter((p): p is string => p !== null)
  const allEfforts = hasMapHere ? [planDir, ...effortDirs] : effortDirs

  // Sources of markdown, all merged:
  //   1. the directory's own top level  — ALWAYS read. Approval documents live
  //      here (to-approval saves to `.plan/<slug>-<date>.md`), and a directory
  //      without its own map.md still holds them. Whether the top level is
  //      itself an effort is a separate question and must not gate this.
  //   2. each effort with a map.md       — that effort's tickets.
  //
  // Each group remembers which effort it came from, so the route view can show
  // one map at a time with only that map's tickets. Without this the tickets are
  // one undifferentiated pile and a map's own work cannot be isolated.
  const [mapRaws, ...fileGroups] = await Promise.all([
    Promise.all(allEfforts.map((d: string) => fsRead(scope, `${d}/map.md`))),
    Promise.resolve(mdEntries(rootTree).map(f => ({ file: f, from: ROOT_GROUP, group: ROOT_GROUP }))),
    // 全局台账目录（2026-09-21 拍板一账一文件）：`.plan/ledger/*.md`，from=ROOT_GROUP。
    rootTree.entries.some((e: FsEntry) => e.isDir && e.name === 'ledger')
      ? fsTree(scope, `${planDir}/ledger`).then(t => mdEntries(t).map(f => ({ file: f, from: ROOT_GROUP, group: 'ledger' })))
      : Promise.resolve([]),
    // 根层 qa/（2026-09-21 拍板）：无图归属的测例/缺陷（SOP 回测、整页回测）——
    // `cases-*.md` 与 `DEF-*.md`（type: qa-defect），from=ROOT_GROUP，进第一层「测例&缺陷」tab。
    rootTree.entries.some((e: FsEntry) => e.isDir && e.name === 'qa')
      ? fsTree(scope, `${planDir}/qa`).then(t => mdEntries(t).map(f => ({ file: f, from: ROOT_GROUP, group: 'qa' })))
      : Promise.resolve([]),
    ...effortDirs.map(async (d: string) => await collectTicketFiles(scope, d).then(gs => gs.map(g => ({ file: g.file, from: d, group: g.group })))),
  ])
  const efforts = allEfforts.map((dir: string, i: number) => ({
    dir, mapRaw: mapRaws[i]?.kind === 'text' ? mapRaws[i].content : '',
  }))
  const seen = new Set<string>()
  const picked: { file: FsEntry; from: string; group: string }[] = []
  for (const e of fileGroups.flat()) {
    if (seen.has(e.file.path)) continue
    seen.add(e.file.path)
    picked.push(e)
  }
  const raws = await Promise.all(picked.map(e => fsRead(scope, e.file.path).then(r => r.kind === 'text' ? r.content : '')))
  // The `qa/` directory is whitelist-only: only files declaring `type: qa-defect`
  // enter the view at all. cases.md / test.md carry no frontmatter, so they have
  // no `type` — a headless file classifies as a plain ticket, the ticket board's
  // default kindSet includes it, and no view-level filter can exclude it. So the
  // drop happens here, at the data layer, before the tickets array exists.
  // Side effect by design: any future headless file in `qa/` (README, notes…)
  // stays invisible too — 加头 = 被看见，不加头 = 不被看见.
  const tickets = picked
    .map((e, i) => ({ ...deriveTicketStatus(e.file.name, raws[i] ?? ''), path: e.file.path, effort: e.from, group: e.group }))
    .filter((t, i) => picked[i]?.group !== 'qa' || ticketKind(t) === 'defect' || picked[i]?.file.name === 'cases.md')
  // The route view's banner shows the first effort that actually has a map body.
  const primary = efforts.find(e => e.mapRaw !== '') ?? efforts[0]
  return { tickets, effortDir: primary?.dir ?? planDir, mapRaw: primary?.mapRaw ?? null, efforts }
}

// ─── Shared detail modal + action layer ──────────────────────────────────────
//
// Every page opens the same modal, so the actions live here once: ① 开始推演 /
// ② 推进 on a ticket, ③ 跳转 / 拍板 on a pending approval. Dispatch is
// draft-first (dsh-mattpocock-skills-deck 同款机制): the button fills the
// instruction into the target session's composer via the input bridge and the
// human reviews and sends it — nothing is queued behind the user's back. The
// binding (frontmatter `session:`) is still written back here so the next
// click lands in the same session instead of forking a new one.

const shortSession = (id: string) => id.replace(/^session-/, '').slice(0, 8)

const EXPLORE_PROMPT = (t: ParsedTicket) =>
  `继续推演这张工单：${t.path ?? t.file}\n\n先读票面原文与它引用的文档，然后继续未决项的推演；需要人拍板的结论，用 to-approval 落成待拍板文档。`
const ADVANCE_PROMPT = (t: ParsedTicket) =>
  `推进这张工单：${t.path ?? t.file}\n\n按票面实施；完成后按 plan-protocol 回写票面状态（status 与落地注）。`

/**
 * 客户端 runtime 的会话面（dsh-client-runtime ISessions 的实际用到子集，
 * deck openTextInNewSession 同款契约）：create({cwd}) → SessionId；open(sid) 切换；
 * scope(sid) + sessionOf(ctx) → SessionFace.rename(title) 改名。
 */
interface SessionsFace {
  create(opts?: { cwd?: string }): Promise<string>
  open(sessionId: string): void
  scope?(sessionId: string): unknown
  sessionOf?(scope: unknown): { rename?(title: string): Promise<unknown> } | undefined
}

function sessionsOf(ctx: any): SessionsFace | undefined {
  try { return ctx?.get?.('sessions') as SessionsFace | undefined } catch { return undefined }
}

/** 给会话改名，失败不阻断派单（deck 同款：命名是锦上添花）。 */
function renameSession(sessions: SessionsFace, sessionId: string, title: string): void {
  try {
    const scopeCtx = sessions.scope?.(sessionId)
    const face = scopeCtx !== undefined ? sessions.sessionOf?.(scopeCtx) : undefined
    const r = face?.rename?.(title)
    if (r !== undefined && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {})
  } catch { /* 命名失败忽略 */ }
}

/** 注入走不通时的兜底：把指令复制到剪贴板，人手动粘贴。返回给用户看的话。 */
async function copyFallback(text: string): Promise<string> {
  try {
    await navigator.clipboard?.writeText(text)
    return '指令已复制到剪贴板——粘贴到输入框确认后发送。'
  } catch {
    return '此环境连剪贴板都不可用，请手动把指令粘进输入框。'
  }
}

function DetailModal({ ticket, planDir, scope, ctx, sessions, onChanged, onClose, readOnly }: {
  ticket: ParsedTicket
  planDir: string
  scope: SessionScope
  ctx: any
  sessions: Map<string, SessionSummary>
  onChanged: () => void
  onClose: () => void
  readOnly?: boolean   // 历史轮次快照：归档纪律「勿据以实现」，派活/拍板动作停用
}) {
  const [fullBody, setFullBody] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [rebind, setRebind] = useState(false) // E1: bound session died — offering recreate
  useEffect(() => {
    let alive = true
    // `path` is known when the file was discovered; fall back to the wayfinder
    // layout for callers that only carry a file name.
    const target = ticket.path ?? `${planDir}/tickets/${ticket.file}`
    fsRead(scope, target).then(r => {
      // Re-read to get the full body, but strip the frontmatter: the summary
      // already rendered it as chips, and it is not part of the document.
      if (alive && r.kind === 'text') setFullBody(parseFrontmatter(r.content).body)
    })
    return () => { alive = false }
  }, [ticket.file, ticket.path, planDir, scope])
  // Close on Escape, and lock the background from scrolling while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * 把指令草稿送进目标会话的输入框。目标会话正开着就立即填；否则经输入桥挂
   * 交接草稿后切过去，输入区随会话切换重挂时消费。都走不通退剪贴板。
   */
  const deliverPrompt = async (sessionId: string | undefined, text: string, okMsg: string) => {
    if (sessionId === undefined) { setMsg(await copyFallback(text)); return }
    try {
      if (deliverDraft(sessionId, text) === 'queued') {
        const open = sessionsOf(ctx)?.open
        if (open === undefined) { setMsg(await copyFallback(text)); return }
        open(sessionId)
      }
      setMsg(okMsg)
    } catch (e) {
      setMsg(`打开 session 失败：${(e as Error).message}。${await copyFallback(text)}`)
    }
  }
  /** Pure jump with the E1 liveness check. */
  const jump = async (sessionId: string) => {
    setMsg(null); setBusy('jump')
    try {
      const live = await sessionAlive(sessionId)
      if (live === undefined) { setMsg('该 session 已不可用（可能已被回收）。'); return }
      const open = sessionsOf(ctx)?.open
      if (open === undefined) { setMsg('此环境没有跳转能力（sessions 服务不可用）。'); return }
      open(sessionId)
    } catch (e) { setMsg(`跳转失败：${(e as Error).message}`) }
    finally { setBusy(null) }
  }
  /** New session via the client runtime, write the B1 binding, prefill, jump. */
  const createAndBind = async (promptText: string) => {
    setMsg(null); setRebind(false); setBusy('create')
    try {
      const sessions = sessionsOf(ctx)
      if (sessions?.create === undefined) {
        setMsg(`此环境没有会话创建能力（sessions 服务不可用）。${await copyFallback(promptText)}`)
        return
      }
      const sessionId = await sessions.create(scope.cwd === undefined ? {} : { cwd: scope.cwd })
      const target = ticket.path ?? `${planDir}/tickets/${ticket.file}`
      const raw = await fsRead(scope, target)
      if (raw.kind === 'text') await fsWrite(scope, target, upsertFrontmatterKey(raw.content, 'session', sessionId))
      renameSession(sessions, sessionId, `#${shortId(ticket)} ${ticket.title}`.slice(0, 60))
      await deliverPrompt(sessionId, promptText, `已在新 session ${shortSession(sessionId)} 预填指令（草稿，确认后发送），绑定已写回票面。`)
      onChanged()
    } catch (e) { setMsg(`派发失败：${(e as Error).message}`) }
    finally { setBusy(null) }
  }
  /** ①/② draft-first dispatch on a ticket: refill the bound session, else create one. */
  const dispatchTicket = async (mode: 'explore' | 'advance') => {
    const promptText = mode === 'explore' ? EXPLORE_PROMPT(ticket) : ADVANCE_PROMPT(ticket)
    if (ticket.session === undefined) { await createAndBind(promptText); return }
    setMsg(null); setBusy(mode)
    try {
      const live = await sessionAlive(ticket.session)
      if (live === undefined) { setRebind(true); setMsg('绑定的 session 已不可用。可新建 session 并重新绑定。'); return }
      await deliverPrompt(ticket.session, promptText, `指令已填进 session ${shortSession(ticket.session)} 的输入框，确认后发送。`)
    } catch (e) { setMsg(`查询 session 失败：${(e as Error).message}`) }
    finally { setBusy(null) }
  }
  /** ③ 拍板: prefill `/plan-approve <doc>` in the session the user is looking at. */
  const settle = async () => {
    setMsg(null); setBusy('settle')
    try {
      await deliverPrompt(scope.sessionId, `/plan-approve ${ticket.file}`, '已把 /plan-approve 预填进当前会话输入框，确认后发送。')
      onChanged()
    } catch (e) { setMsg(`拍板失败：${(e as Error).message}`) }
    finally { setBusy(null) }
  }

  const kind = ticketKind(ticket)
  const pending = isPending(ticket)
  const boundLive = ticket.session !== undefined ? sessions.get(ticket.session) : undefined
  const btn = (label: string, onClick: () => void, key: string, tone: string = ACCENT): React.ReactNode => (
    <button
      type="button"
      disabled={busy !== null}
      onClick={onClick}
      style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${tone}`, background: `${tone}1a`, color: tone, cursor: busy === null ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, opacity: busy === null || busy === key ? 1 : 0.5 }}
    >
      {busy === key ? '…' : label}
    </button>
  )
  const actions: React.ReactNode[] = []
  if (!readOnly) {
    if (kind === 'ticket') {
      if (ticket.session !== undefined && rebind) {
        actions.push(btn('新建 session 并重新绑定', () => void createAndBind(ADVANCE_PROMPT(ticket)), 'create', '#f7ad31'))
        actions.push(btn('取消', () => { setRebind(false); setMsg(null) }, 'cancel', '#666'))
      } else {
        if (ticket.session === undefined) actions.push(btn('🧭 开始推演', () => void dispatchTicket('explore'), 'explore'))
        actions.push(btn('▶ 推进', () => void dispatchTicket('advance'), 'advance'))
      }
    }
    if (kind === 'approval' && pending) actions.push(btn('✅ 拍板（预填 /plan-approve）', () => void settle(), 'settle', '#4ed17e'))
  }
  const jumps: [string, string][] = []
  if (ticket.session !== undefined) jumps.push([ticket.session, '绑定 session'])
  if (ticket.originSession !== undefined) jumps.push([ticket.originSession, '来源 session'])
  const body = fullBody ?? ticket.body
  const chipRow: React.ReactNode[] = jumps.map(([id, label]) => {
    if (!isDshSession(id)) {
      return (
        <span
          key={id}
          title={`外部 agent session: ${id}——点击复制恢复命令`}
          onClick={() => { const cmd = `zcode --resume ${id}`; void navigator.clipboard?.writeText(cmd); setMsg(`已复制恢复命令：${cmd}（粘贴到终端执行）`) }}
          style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#609bfa18', color: '#609bfa', border: `1px solid ${BORDER}`, cursor: 'pointer' }}
        >
          📎 {label} {id}
        </span>
      )
    }
    const live = sessions.get(id)
    return (
      <span
        key={id}
        title={`${label}: ${id}${live === undefined ? '（已不可用）' : live.running ? '（运行中）' : '（空闲）'}`}
        onClick={() => { if (busy === null) void jump(id) }}
        style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: live !== undefined ? '#2ecc7118' : CHIP_BG, color: live !== undefined ? '#4ed17e' : '#888', border: `1px solid ${BORDER}`, cursor: 'pointer' }}
      >
        {live === undefined ? '⚪' : live.running ? '🟢' : '⚪'} {label} {shortSession(id)}
      </span>
    )
  })
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ width: 'min(1080px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: HEADER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,.55)' }} onClick={e => e.stopPropagation()}>
        <style>{MD_CSS}</style>
        <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: DOT[displayStatus(ticket)] }}>{typeTheme(ticket.type).icon}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, lineHeight: 1.4, flex: 1 }}>{ticket.title}</span>
          <button style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, borderBottom: `1px solid ${BORDER_LIGHT}` }}>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: CHIP_BG, color: '#888', border: `1px solid ${BORDER}` }}>#{shortId(ticket)}</span>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: `${KIND_META[ticketKind(ticket)].color}22`, color: KIND_META[ticketKind(ticket)].color }}>{KIND_META[ticketKind(ticket)].icon} {KIND_META[ticketKind(ticket)].label}</span>
          {ticket.type && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: `${typeTheme(ticket.type).color}22`, color: typeTheme(ticket.type).color }}>{ticket.type}</span>}
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: CHIP_BG, color: DOT[displayStatus(ticket)], border: `1px solid ${BORDER}` }}>{STATUS_LABELS[displayStatus(ticket)]}</span>
          {ticket.claimedBy && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#f0a50022', color: '#f7ad31' }}>👤 {ticket.claimedBy}</span>}
          {ticket.qaCases && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#609bfa22', color: '#609bfa' }}>🧪 测例已构建</span>}
          {ticket.qaTested && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#4ed17e22', color: '#4ed17e' }}>🧪 已测试</span>}
          {ticket.qaAccepted && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#2ecc7122', color: '#4ed17e' }}>🏁 已验收</span>}
          {ticket.status && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: CHIP_BG, color: '#aaa', border: `1px solid ${BORDER}` }}>status: {ticket.status}</span>}
          {ageLabel(ticket) && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#ffa94d22', color: '#f7ad31' }}>{ageLabel(ticket)}</span>}
          {ticket.origin && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: CHIP_BG, color: '#888', border: `1px solid ${BORDER}` }}>origin: {ticket.origin}</span>}
          {ticket.blockedBy.length > 0 && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#ff6b6b22', color: '#f2555a' }}>blocked_by: {ticket.blockedBy.map(n => `#${n}`).join(', ')}</span>}
          {chipRow}
        </div>
        {(actions.length > 0 || msg !== null) && (
          <div style={{ padding: '10px 20px', borderBottom: `1px solid ${BORDER_LIGHT}`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {actions}
            {boundLive?.running === true && <span style={{ fontSize: 11, color: '#4ed17e' }}>🟢 session 运行中</span>}
            {msg !== null && <span style={{ fontSize: 12, color: TEXT_DIM, flex: 1, minWidth: 200 }}>{msg}</span>}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 20px', fontSize: 13, color: TEXT_DIM }} dangerouslySetInnerHTML={{ __html: md(body) }} />
      </div>
    </div>
  )
}

// ─── Variant A: Kanban ───────────────────────────────────────────────────────

function ViewA({ tickets, planDir, scope, ctx, sessions, onChanged, destination, readOnly }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; destination: string | null; readOnly?: boolean }) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  const groups = useMemo(() => {
    const g: Record<TicketStatus, ParsedTicket[]> = { resolved: [], out_of_scope: [], claimed: [], open: [] }
    for (const t of tickets) g[displayStatus(t)].push(t)
    return g
  }, [tickets])
  // Decisions blocked on the human, oldest first — the ones that get forgotten.
  const waiting = useMemo(
    () => tickets.filter(isPending).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)),
    [tickets],
  )
  const active = tickets.filter(t => !t.outOfScope)
  const done = tickets.filter(t => t.resolved).length
  const pct = active.length > 0 ? Math.round((done / active.length) * 100) : 0
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT }}>
      <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Kanban</span>
        <span style={{ fontSize: 12, color: '#888' }}>{tickets.length} tickets · {done} resolved</span>
      </div>
      {/* 归档轮次里不该再有 pending；万一轮内有漏拍板的旧文档，也不在此催办 */}
      {!readOnly && waiting.length > 0 && (
        <div style={{ margin: '8px 16px 0', padding: '8px 12px', borderRadius: 8, background: '#3a2410', border: '1px solid #7a4a15', fontSize: 13 }}>
          <div style={{ fontWeight: 700, color: '#f7ad31', marginBottom: 4 }}>⏳ 等你拍板（{waiting.length}）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {waiting.map(t => (
              <div key={t.id} onClick={() => setFocus(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e8c9a0' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f7ad31' }}>{shortId(t)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                {ageLabel(t) && <span style={{ fontSize: 11, color: '#f7ad31', flexShrink: 0 }}>{ageLabel(t)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {destination && <div style={{ margin: '8px 16px 0', padding: '8px 12px', borderRadius: 8, background: HEADER_BG, border: `1px solid ${BORDER}`, color: '#aaa', fontSize: 13 }}>{destination}</div>}
      <div style={{ margin: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: CHIP_BG, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: `linear-gradient(90deg, #4ed17e, ${ACCENT})` }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#4ed17e', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 10, padding: '12px 16px', overflowX: 'auto' }}>
        {STATUS_ORDER.filter(s => groups[s].length > 0).map(s => (
          <div key={s} style={{ flex: '1 1 0', minWidth: 200, display: 'flex', flexDirection: 'column', background: BG, border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: `1px solid ${BORDER_LIGHT}`, background: HEADER_BG }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[s] }} />
              <span style={{ fontWeight: 700, fontSize: 12 }}>{STATUS_LABELS[s]}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{groups[s].length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groups[s].map(t => (
                <div key={t.file} style={{ padding: 8, borderRadius: 8, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer' }} onClick={() => setFocus(t)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#888', background: CHIP_BG, borderRadius: 999, minWidth: 20, height: 20, padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{shortId(t)}</span>
                    <span style={{ fontSize: 12 }}>{KIND_META[ticketKind(t)].icon}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: `${KIND_META[ticketKind(t)].color}22`, color: KIND_META[ticketKind(t)].color }}>{KIND_META[ticketKind(t)].icon} {KIND_META[ticketKind(t)].label}</span>
                    {t.type && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: `${typeTheme(t.type).color}22`, color: typeTheme(t.type).color }}>{t.type}</span>}
                    {isPending(t) && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#ffa94d33', color: '#f7ad31' }}>{ageLabel(t) ?? '待拍板'}</span>}
                    {t.claimedBy && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#f0a50022', color: '#f7ad31' }}>👤 {t.claimedBy}</span>}
                    {t.blockedBy.length > 0 && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#ff6b6b22', color: '#f2555a' }}> {t.blockedBy.map(n => `#${n}`).join(',')}</span>}
                    {t.qaCases && <span title="测例已构建（qa_cases）" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#609bfa22', color: '#609bfa' }}>🧪 测例</span>}
                    {t.qaTested && <span title="测例已执行（qa_tested）" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#4ed17e22', color: '#4ed17e' }}>🧪 已测试</span>}
                    {t.qaAccepted && <span title="验收通过（qa_accepted）" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#2ecc7122', color: '#4ed17e' }}>🏁 已验收</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

// ─── Variant C: Table ────────────────────────────────────────────────────────

function ViewC({ tickets, planDir, scope, ctx, sessions, onChanged, readOnly }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; readOnly?: boolean }) {
  const [query, setQuery] = useState('')
  // Default to work still outstanding. Completed tickets are the bulk of a
  // mature repo (here 51 of 55), so showing them by default buries the three
  // that actually need attention. They stay one click away, not hidden.
  const OUTSTANDING: TicketStatus[] = ['open', 'claimed']
  const [statusSet, setStatusSet] = useState<Set<TicketStatus>>(() => new Set(OUTSTANDING))
  // Filter over the types actually in the data, not a hardcoded four. A repo
  // writing `type: impl` must not start with every row filtered out.
  // A file with no `type` is a real case (23 such files in novel), not an error.
  // Bucket it under NO_TYPE so it is visible and filterable — leaving it out of
  // the set silently hid every such file from this view.
  const allTypes = useMemo(() => {
    const named = [...new Set(tickets.map(t => t.type).filter((x): x is string => !!x))].sort()
    return tickets.some(t => !t.type) ? [...named, NO_TYPE] : named
  }, [tickets])
  const [typeSet, setTypeSet] = useState<Set<string>>(() => new Set(Object.keys(TYPE_THEME)))
  const [kindSet, setKindSet] = useState<Set<TicketKind>>(() => new Set(['ticket', 'approval', 'note'] as TicketKind[]))
  // First render has no tickets yet; the effect below widens the filter to the
  // discovered types so nothing is hidden by default.
  const typeInit = useRef(false)
  useEffect(() => {
    if (typeInit.current || tickets.length === 0) return
    typeInit.current = true
    setTypeSet(new Set(allTypes))
  }, [allTypes, tickets.length])
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'num', dir: 1 })
  const [detail, setDetail] = useState<ParsedTicket | null>(null)
  const rows = useMemo(() => {
    let out = tickets.filter(t => {
      if (onlyBlocked && t.blockedBy.length === 0) return false
      if (!statusSet.has(displayStatus(t))) return false
      if (!kindSet.has(ticketKind(t))) return false
      if (allTypes.length > 0 && !typeSet.has(t.type ?? NO_TYPE)) return false
      if (query && !`${t.title} ${t.body} ${t.claimedBy ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    out = [...out].sort((a, b) => {
      let v = 0
      if (sort.key === 'num') v = a.id.localeCompare(b.id, undefined, { numeric: true })
      else if (sort.key === 'status') v = STATUS_ORDER.indexOf(displayStatus(a)) - STATUS_ORDER.indexOf(displayStatus(b))
      else if (sort.key === 'kind') v = ticketKind(a).localeCompare(ticketKind(b))
      else v = (a.type ?? '').localeCompare(b.type ?? '')
      return v * sort.dir
    })
    return out
  }, [tickets, query, statusSet, typeSet, kindSet, onlyBlocked, sort])
  const toggle = <T,>(set: Set<T>, v: T): Set<T> => { const nx = new Set(set); if (nx.has(v)) nx.delete(v); else nx.add(v); return nx }
  const sortBy = (key: string) => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  const arrow = (key: string) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '')
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT }}>
      <div style={{ padding: '10px 16px', background: HEADER_BG, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Table</span>
        <span style={{ fontSize: 12, color: '#888' }}>
          {rows.length}/{tickets.length} tickets
          {statusSet.size < STATUS_ORDER.length && <span style={{ color: '#666' }}>（默认隐藏已完成；勾 Status 里的 Resolved 可看）</span>}
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 200, flexShrink: 0, background: HEADER_BG, borderRight: `1px solid ${BORDER}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Search</div>
            <input style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDER}`, background: HEADER_BG, color: TEXT, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} placeholder="title / body / owner…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
            {STATUS_ORDER.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT_DIM, cursor: 'pointer', padding: '1px 0' }}>
                <input type="checkbox" checked={statusSet.has(s)} onChange={() => setStatusSet(toggle(statusSet, s))} />
                <span style={{ color: DOT[s] }}>●</span> {STATUS_LABELS[s]}
              </label>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Kind</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(['ticket', 'approval', 'note'] as TicketKind[]).map(k => {
                const meta = KIND_META[k]
                const on = kindSet.has(k)
                return <span key={k} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${meta.color}`, color: on ? '#fff' : meta.color, background: on ? meta.color : 'transparent' }} onClick={() => setKindSet(toggle(kindSet, k))}>{meta.icon} {meta.label}</span>
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Type</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allTypes.map(t => {
                const theme = t === NO_TYPE ? { icon: '∅', color: TEXT_FAINT } : typeTheme(t)
                const on = typeSet.has(t)
                const label = t === NO_TYPE ? '（无 type）' : t
                return <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${theme.color}`, color: on ? '#fff' : theme.color, background: on ? theme.color : 'transparent' }} onClick={() => setTypeSet(toggle(typeSet, t))}>{theme.icon} {label}</span>
              })}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT_DIM, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyBlocked} onChange={e => setOnlyBlocked(e.target.checked)} /> Only blocked
          </label>
          <button style={{ marginTop: 'auto', padding: '6px 0', borderRadius: 6, border: `1px solid ${BORDER}`, background: HEADER_BG, color: '#888', cursor: 'pointer', fontSize: 11 }} onClick={() => { setQuery(''); setStatusSet(new Set(OUTSTANDING)); setTypeSet(new Set(allTypes)); setKindSet(new Set(['ticket', 'approval', 'note'] as TicketKind[])); setOnlyBlocked(false) }}>Reset</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXT_FAINT }}>No matching tickets</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, background: HEADER_BG, borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, cursor: 'pointer' }} onClick={() => sortBy('num')}># {arrow('num')}</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, cursor: 'pointer' }} onClick={() => sortBy('kind')}>Kind {arrow('kind')}</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, cursor: 'pointer' }} onClick={() => sortBy('type')}>Type {arrow('type')}</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, cursor: 'pointer' }} onClick={() => sortBy('status')}>Status {arrow('status')}</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>Owner</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const th = typeTheme(t.type)
                  return (
                    <tr key={t.file} style={{ cursor: 'pointer' }} onClick={() => setDetail(t)}>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, fontFamily: 'monospace', color: TEXT_FAINT, fontSize: 11 }}>{shortId(t)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, fontWeight: 600, color: TEXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${KIND_META[ticketKind(t)].color}1e`, color: KIND_META[ticketKind(t)].color, border: `1px solid ${KIND_META[ticketKind(t)].color}44`, fontSize: 11 }}>{KIND_META[ticketKind(t)].icon} {KIND_META[ticketKind(t)].label}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${th.color}1e`, color: th.color, border: `1px solid ${th.color}44`, fontSize: 11 }}>{th.icon} {t.type ?? '（无 type）'}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}` }}><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[displayStatus(t)] }} />{STATUS_LABELS[displayStatus(t)]}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, color: t.claimedBy ? '#f7ad31' : TEXT_FAINT }}>{t.claimedBy ?? '—'}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, color: t.blockedBy.length > 0 ? '#f2555a' : TEXT_FAINT, fontFamily: 'monospace', fontSize: 11 }}>{t.blockedBy.length > 0 ? t.blockedBy.map(n => `#${n}`).join(' ') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {detail && <DetailModal ticket={detail} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setDetail(null)} readOnly={readOnly} />}
    </div>
  )
}

// ─── Variant D: Relation Graph (tiered DAG) ──────────────────────────────────

const NODE_W = 176, STEP_X = 200, NODE_H = 44
const RUNG_TOP = 140, RUNG_STEP = 110
const START_Y = 36, END_GAP = 110, CAP_H = 30, CAP_W = 100

interface Pos { x: number; cx: number; y: number }
// `from`/`to` are ticket ids, plus two sentinels for the START / END caps.
const START = '\u0000start'
const END = '\u0000end'
type NodeRef = string | typeof START | typeof END
interface GraphEdge { from: NodeRef; to: NodeRef; dashed?: boolean; key: string }

function layoutGraph(tickets: ParsedTicket[]) {
  const grid = tickets.filter(t => !t.outOfScope)
  const side = tickets.filter(t => t.outOfScope)
  const byId = new Map(tickets.map(t => [t.id, t]))
  // Resolve each ticket's refs once, into real ids; unresolved refs are dropped
  // (they may point outside this directory, which the graph cannot draw).
  const deps = new Map<string, string[]>()
  for (const t of tickets) {
    deps.set(t.id, t.blockedBy.map(r => resolveRef(r, byId)).filter((x): x is string => x !== undefined))
  }
  const depsOf = (t: ParsedTicket) => deps.get(t.id) ?? []
  const depth = new Map<string, number>()
  const visit = (n: string): number => {
    if (depth.has(n)) return depth.get(n)!
    const t = byId.get(n); if (!t) return 0
    const d = depsOf(t).filter(b => byId.has(b) && !byId.get(b)!.outOfScope).reduce((m, b) => Math.max(m, visit(b)), 0) + 1
    depth.set(n, d); return d
  }
  for (const t of grid) visit(t.id)
  const maxL = Math.max(1, ...grid.map(t => depth.get(t.id)!))
  const layers: ParsedTicket[][] = Array.from({ length: maxL }, () => [])
  for (const t of grid) layers[depth.get(t.id)! - 1].push(t)
  const cmp = (a: ParsedTicket, b: ParsedTicket) => a.id.localeCompare(b.id, undefined, { numeric: true })
  layers[0].sort(cmp)
  for (let l = 1; l < maxL; l++) {
    const upIdx = new Map<string, number>()
    layers[l - 1].forEach((t, i) => upIdx.set(t.id, i))
    layers[l].sort((a, b) => {
      const pa = depsOf(a).filter(p => upIdx.has(p)), pb = depsOf(b).filter(p => upIdx.has(p))
      const ba = pa.reduce((s, p) => s + upIdx.get(p)!, 0) / Math.max(1, pa.length)
      const bb = pb.reduce((s, p) => s + upIdx.get(p)!, 0) / Math.max(1, pb.length)
      return ba - bb || cmp(a, b)
    })
  }
  const maxCount = Math.max(...layers.map(o => o.length), 1)
  const W_MAIN = Math.max(600, maxCount * STEP_X + 40)
  // Out-of-scope nodes live in their own lane to the right of the main DAG,
  // never on top of it: x is lane-aligned, y keeps the tier of the parent
  // (or the first row when there is no parent). Same-tier OOS nodes spread
  // horizontally so they never overlap each other.
  const sideGap = 48
  const sideRows = new Map<number, ParsedTicket[]>()
  let maxSideRow = 0
  for (const t of side) {
    const p = depsOf(t).find(b => byId.has(b) && !byId.get(b)!.outOfScope)
    let tier = 0
    if (p !== undefined) {
      const parentTier = layers.findIndex(l => l.some(tk => tk.id === p))
      tier = (parentTier >= 0 ? parentTier : 0) + 1
    }
    const yKey = RUNG_TOP + tier * RUNG_STEP
    if (!sideRows.has(yKey)) sideRows.set(yKey, [])
    sideRows.get(yKey)!.push(t)
    maxSideRow = Math.max(maxSideRow, sideRows.get(yKey)!.length)
  }
  const W = side.length > 0 ? Math.max(W_MAIN, W_MAIN + sideGap + (maxSideRow - 1) * STEP_X + NODE_W + 40) : W_MAIN
  const pos = new Map<string, Pos>()
  layers.forEach((o, li) => {
    const lw = o.length * STEP_X - 24; const left = (W_MAIN - lw) / 2
    o.forEach((t, i) => { const x = left + i * STEP_X; pos.set(t.id, { x, cx: x + NODE_W / 2, y: RUNG_TOP + li * RUNG_STEP }) })
  })
  const laneX = W_MAIN + sideGap
  const sidePos = new Map<string, Pos>()
  for (const [y, row] of sideRows) {
    row.forEach((t, i) => { const x = laneX + i * STEP_X; sidePos.set(t.id, { x, cx: x + NODE_W / 2, y }) })
  }
  const childrenOf = new Map<string, string[]>()
  const edges: GraphEdge[] = []
  for (const t of grid) {
    const n = t.id
    for (const p of depsOf(t)) if (byId.has(p) && !byId.get(p)!.outOfScope) {
      const key = `e${p}-${n}`; edges.push({ from: p, to: n, key })
      if (!childrenOf.has(p)) childrenOf.set(p, []); childrenOf.get(p)!.push(n)
    }
  }
  const roots = layers[0].map(t => t.id)
  roots.forEach((r, i) => edges.push({ from: START, to: r, key: `s${i}` }))
  const leaves = grid.filter(t => (childrenOf.get(t.id) ?? []).length === 0 && t.resolved).map(t => t.id)
  leaves.forEach((l, i) => edges.push({ from: l, to: END, key: `l${i}` }))
  for (const t of side) {
    const n = t.id; const p = depsOf(t).find(b => byId.has(b))
    if (p !== undefined) edges.push({ from: p, to: n, dashed: true, key: `d${p}-${n}` })
  }
  const endY = RUNG_TOP + (maxL - 1) * RUNG_STEP + END_GAP
  const maxSideY = sidePos.size > 0 ? Math.max(...[...sidePos.values()].map(p => p.y)) : 0
  const H = Math.max(endY + CAP_H / 2 + 40, maxSideY + NODE_H + 40)
  return { pos, sidePos, edges, W, H, capX: W_MAIN / 2, endY, startCapY: START_Y - CAP_H / 2, endCapY: endY - CAP_H / 2 }
}

function ViewD({ tickets, planDir, scope, ctx, sessions, onChanged, readOnly }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; readOnly?: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const L = useMemo(() => layoutGraph(tickets), [tickets])
  const { pos, sidePos, edges, W, H, capX, startCapY, endCapY, endY } = L
  const focus = tickets.find(t => t.id === sel) ?? null
  const conn = (n: string) => {
    const keys = new Set<string>()
    for (const e of edges) { if (e.from === n || e.to === n) keys.add(e.key) }
    return keys
  }
  const mk = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Relation</span>
        <span style={{ fontSize: 12, color: '#888' }}>{tickets.length} tickets · hover / click node to highlight edges</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', cursor: 'default' }} onClick={() => setSel(null)}>
        <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }}>
          <div style={{ position: 'absolute', left: capX - CAP_W / 2, top: startCapY, display: 'flex', alignItems: 'center', justifyContent: 'center', width: CAP_W, height: CAP_H, borderRadius: 999, background: CARD, border: `2px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: TEXT, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }}>Start</div>
          {[...pos.entries()].map(([n, p]) => {
            const t = tickets.find(x => x.id === n)!
            return (
              <div key={n} style={{ position: 'absolute', display: 'flex', background: CARD, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', zIndex: 3, boxShadow: sel === n || hover === n ? '0 4px 20px rgba(0,0,0,.5), 0 0 0 2px #fff3' : '0 3px 12px rgba(0,0,0,.3)', border: `1px solid ${BORDER}`, width: NODE_W, height: NODE_H, left: p.x, top: p.y }} onClick={e => { e.stopPropagation(); setSel(n) }} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
                <span style={{ width: 4, flexShrink: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10, background: DOT[displayStatus(t)] }} />
                <div style={{ padding: '7px 8px 7px 8px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', background: CHIP_BG, borderRadius: 999, minWidth: 18, height: 18, padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{shortId(t)}</span>
                    <span style={{ fontSize: 12 }}>{KIND_META[ticketKind(t)].icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: TEXT_FAINT, display: 'flex', gap: 6 }}>{STATUS_LABELS[displayStatus(t)]}{t.claimedBy && <> 👤 {t.claimedBy}</>}</div>
                </div>
              </div>
            )
          })}
          {[...sidePos.entries()].map(([n, p]) => {
            const t = tickets.find(x => x.id === n)!
            return (
              <div key={n} style={{ position: 'absolute', display: 'flex', background: CARD_DARK, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', zIndex: 3, boxShadow: '0 2px 8px rgba(0,0,0,.3)', border: '2px dashed #383860', width: NODE_W, height: NODE_H, left: p.x, top: p.y }} onClick={e => { e.stopPropagation(); setSel(n) }} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
                <span style={{ width: 4, flexShrink: 0, background: 'rgba(255,255,255,.16)' }} />
                <div style={{ padding: '7px 8px 7px 8px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', background: CHIP_BG, borderRadius: 999, minWidth: 18, height: 18, padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{shortId(t)}</span>
                    <span style={{ fontSize: 12 }}>⛔</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: TEXT_FAINT }}>ruled out</div>
                </div>
              </div>
            )
          })}
          <div style={{ position: 'absolute', left: capX - CAP_W / 2, top: endCapY, display: 'flex', alignItems: 'center', justifyContent: 'center', width: CAP_W, height: CAP_H, borderRadius: 999, background: CARD, border: `2px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: TEXT, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }}>End</div>
          <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 1 }}>
            <defs>
              <marker id="da" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#454570" /></marker>
              <marker id="da2" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={TEXT} /></marker>
            </defs>
            {edges.map(e => {
              const aPos = e.from === START ? { cx: capX, y: startCapY } : pos.get(e.from)
              const bPos = e.to === END ? { cx: capX, y: endY } : (pos.get(e.to) ?? sidePos.get(e.to))
              if (!aPos || !bPos) return null
              const active = hover ?? sel
              const connected = active === null || conn(active).has(e.key)
              const sx = aPos.cx, sy = e.from === START ? startCapY + CAP_H : aPos.y + NODE_H
              const ex = e.to === END ? capX : bPos.cx
              const ey = e.to === END ? endY : (e.dashed ? bPos.y : bPos.y + NODE_H / 2)
              const sw = e.dashed ? 1.4 : connected ? 3 : 1.4
              const sc = e.dashed ? 'rgba(255,255,255,.35)' : connected ? TEXT : 'rgba(255,255,255,.22)'
              return <path key={e.key} d={mk(sx, sy, ex, ey)} fill="none" stroke={sc} strokeWidth={sw} strokeDasharray={e.dashed ? '5 4' : undefined} opacity={active !== null && !connected ? 0.45 : 1} markerEnd={connected && !e.dashed ? 'url(#da2)' : e.dashed ? undefined : 'url(#da)'} style={{ transition: 'stroke-width .18s, opacity .18s' }} />
            })}
          </svg>
        </div>
      </div>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setSel(null)} readOnly={readOnly} />}
    </div>
  )
}

// ─── Overview (D1): stages + cross-effort stuck points ──────────────────────
//
// The route/tickets/approvals tabs each show one slice. This page answers the
// single question a returning reader actually has: where is everything stuck?
// Stages derive from the data already loaded — no extra reads — and every row
// opens the shared modal, where the jump/dispatch actions live.

function effortStage(own: ParsedTicket[]): { stage: string; color: string } {
  const open = own.filter(t => ticketKind(t) === 'ticket' && (displayStatus(t) === 'open' || displayStatus(t) === 'claimed'))
  const pend = own.filter(t => ticketKind(t) === 'approval' && isPending(t))
  const byId = new Map(own.map(t => [t.id, t]))
  const unmet = (t: ParsedTicket) => t.blockedBy.some(r => {
    const b = resolveRef(r, byId)
    const bt = b === undefined ? undefined : byId.get(b)
    return bt !== undefined && (displayStatus(bt) === 'open' || displayStatus(bt) === 'claimed')
  })
  const frontier = open.filter(t => !unmet(t))
  if (open.length > 0) return frontier.length > 0
    ? { stage: '② 落地链中', color: ACCENT_SOFT }
    : { stage: '⛔ 卡 blocked', color: '#f2555a' }
  if (pend.length > 0) return { stage: '① 决策循环中', color: '#f7ad31' }
  return { stage: '✅ 收口', color: '#4ed17e' }
}

// ─── Effort chips ────────────────────────────────────────────────────────────
//
// The one map selector, shared by every map-scoped page (2026-09-21 拍板：
// 筛选后看到的都是同一张图). Bound to the top-level effortIdx, so switching
// maps on one page switches them everywhere; only the per-chip count differs
// per page (tickets, approvals, defects…), via countFor/totalCount.

function inEffort(t: ParsedTicket, dir: string): boolean {
  return t.effort === dir || t.effort === ROOT_GROUP
}

// session 字段双格式：DSH 会话是 `session-<uuid>`，可跳转、可查存活；
// 其他值（如 zcode 的 sess_xxx）视为外部 agent session——展示名字、
// 点击复制恢复命令（zcode --resume），不做 DSH 跳转。
const isDshSession = (id: string): boolean => id.startsWith('session-')

function EffortChips({ efforts, all, effortIdx, setEffortIdx, countFor, totalCount }: {
  efforts: { dir: string; mapRaw: string }[]
  all: ParsedTicket[]
  effortIdx: number
  setEffortIdx: (i: number) => void
  countFor: (dir: string) => number
  totalCount: number
}) {
  // 分开展示：推演图一组、实施图一组，未判型的垫后（2026-09-20 拍板）。
  const groups = (['speculation', 'impl', undefined] as const)
    .map(kind => ({ kind, items: efforts.map((e, i) => ({ e, i, kind: mapKind(e.dir, all) })).filter(w => w.kind === kind) }))
    .filter(g => g.items.length > 0)
  const allOn = effortIdx < 0
  // 全部验收通过（2026-09-22 增）：图内工单（含根层松散票，与计数同口径）
  // 至少一张，且每张都 qa_accepted（🏁 已验收）。out_of_scope（Ruled out）票
  // 不算未验收工作，不阻塞绿色（推断口径，与总览进度条的在途口径一致）。
  const allAccepted = (dir: string): boolean => {
    const work = all.filter(t => inEffort(t, dir) && ticketKind(t) === 'ticket' && !t.outOfScope)
    return work.length > 0 && work.every(t => t.qaAccepted)
  }
  return (
    <div style={{ display: 'flex', gap: 6, padding: '10px 14px 8px', flexWrap: 'wrap', borderBottom: `1px solid ${BORDER_LIGHT}`, alignItems: 'center' }}>
      {efforts.length > 1 && (
        <span onClick={() => setEffortIdx(-1)} style={{ fontSize: 11.5, padding: '4px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${allOn ? ACCENT : BORDER}`, color: allOn ? ACCENT : TEXT_FAINT, background: allOn ? `${ACCENT}22` : 'transparent' }}>
          全部地图 <span style={{ opacity: .7 }}>{totalCount}</span>
        </span>
      )}
      {groups.map(g => (
        <span key={String(g.kind)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {groups.length > 1 && (
            <span style={{ fontSize: 10, color: TEXT_FAINT, padding: '3px 2px' }}>
              {g.kind ? `${MAP_KIND_META[g.kind].icon} ${MAP_KIND_META[g.kind].label}` : '📄 其他'}
            </span>
          )}
          {g.items.map(({ e, i, kind }) => {
            const on = effortIdx === i
            const done = allAccepted(e.dir)
            const accent = done ? '#4ed17e' : ACCENT
            return (
              <span key={e.dir} onClick={() => setEffortIdx(i)} title={done ? `${e.dir}（全部工单已验收）` : e.dir} style={{ fontSize: 11.5, padding: '4px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? accent : done ? '#4ed17e55' : BORDER}`, color: on || done ? accent : TEXT_FAINT, background: on ? `${accent}22` : 'transparent' }}>
                {kind ? MAP_KIND_META[kind].icon : '🗺️'} {e.dir.split('/').pop()} <span style={{ opacity: .7 }}>{countFor(e.dir)}</span>
              </span>
            )
          })}
          {g !== groups[groups.length - 1] && <span style={{ width: 1, height: 16, background: BORDER, margin: '0 4px' }} />}
        </span>
      ))}
    </div>
  )
}

function OverviewView({ tickets, efforts, defects, ledgers, effortIdx, setEffortIdx, planDir, scope, ctx, sessions, onChanged, readOnly }: {
  tickets: ParsedTicket[]
  efforts: { dir: string; mapRaw: string }[]
  defects: ParsedTicket[]
  ledgers: ParsedTicket[]
  effortIdx: number
  setEffortIdx: (i: number) => void
  planDir: string
  scope: SessionScope
  ctx: any
  sessions: Map<string, SessionSummary>
  onChanged: () => void
  readOnly?: boolean
}) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  const byId = new Map(tickets.map(t => [t.id, t]))
  // 页内筛选（2026-09-21 拍板）：绑定全局 effortIdx——选中某图后，卡片与
  // 下方三个聚合区都只看该图；根层松散文档与路线页同语义保持可见。
  const selectedDir = effortIdx >= 0 ? efforts[effortIdx]?.dir : undefined
  const shownEfforts = effortIdx < 0 ? efforts : efforts.filter((_, i) => i === effortIdx)
  const visible = useMemo(
    () => (selectedDir === undefined ? tickets : tickets.filter(t => inEffort(t, selectedDir))),
    [tickets, selectedDir],
  )
  const unmetBlocker = (t: ParsedTicket) => t.blockedBy.some(r => {
    const b = resolveRef(r, byId)
    const bt = b === undefined ? undefined : byId.get(b)
    return bt !== undefined && (displayStatus(bt) === 'open' || displayStatus(bt) === 'claimed')
  })
  const oldestPending = useMemo(
    () => visible.filter(t => ticketKind(t) === 'approval' && isPending(t)).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)).slice(0, 5),
    [visible],
  )
  const longestBlocked = useMemo(
    () => visible.filter(t => ticketKind(t) === 'ticket' && (displayStatus(t) === 'open' || displayStatus(t) === 'claimed') && unmetBlocker(t))
      .sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)).slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  )
  const running = useMemo(
    () => visible.filter(t => t.session !== undefined && (displayStatus(t) === 'open' || displayStatus(t) === 'claimed')),
    [visible],
  )
  // 待推进聚合（2026-09-21 拍板）：四类「当下可动 / 需要注意」的事——
  // 可开工票（无未满足前置的 open）、待处理缺陷、可启动挂账、卡在执行中的票。
  const readyTickets = useMemo(
    () => visible.filter(t => ticketKind(t) === 'ticket' && displayStatus(t) === 'open' && !unmetBlocker(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  )
  const stuckTickets = useMemo(
    () => visible.filter(t => displayStatus(t) === 'claimed' && (() => {
      const s = t.session !== undefined ? sessions.get(t.session) : undefined
      return s === undefined || !s.running || (ageDays(t) ?? 0) >= 2
    })()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, sessions],
  )
  const openDefects = useMemo(() => defects.flatMap(f => {
    const single = parseDefectFile(f)
    if (single !== undefined) return DEFECT_CLOSED.has(defectStateWord(single.state)) ? [] : [{ ticket: f, label: `${single.id} ${single.title}`, sub: single.state }]
    return parseDefectEntries(f.body).filter(d => !DEFECT_CLOSED.has(defectStateWord(d.state))).map(d => ({ ticket: f, label: `${d.id} ${d.title}`, sub: d.state }))
  }), [defects])
  const activeLedgers = useMemo(() => ledgers.flatMap(f => {
    const e = parseLedgerEntries(f.body)[0]
    if (e === undefined || ledgerStage(e, f.effort, tickets) !== '可启动') return []
    return [{ ticket: f, label: `${e.id} ${e.title}`, sub: e.source || f.effort?.split('/').pop() || '' }]
  }), [ledgers, tickets])
  const row = (t: ParsedTicket, right?: React.ReactNode) => (
    <div key={`${t.effort}/${t.file}`} onClick={() => setFocus(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', background: 'transparent' }}
      onMouseEnter={e => { e.currentTarget.style.background = RAISED }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: TEXT_FAINT, minWidth: 28 }}>{shortId(t)}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
      {right}
    </div>
  )
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <EffortChips efforts={efforts} all={tickets} effortIdx={effortIdx} setEffortIdx={setEffortIdx}
        countFor={dir => tickets.filter(t => inEffort(t, dir) && ticketKind(t) === 'ticket').length}
        totalCount={tickets.filter(t => ticketKind(t) === 'ticket').length} />
      {/* 阶段指示 — one card per effort, 推演图/实施图分两组（2026-09-20 拍板） */}
      {(['speculation', 'impl', undefined] as const)
        .map(kind => ({ kind, items: shownEfforts.map((e, i) => ({ e, i })).filter(({ e }) => mapKind(e.dir, tickets) === kind) }))
        .filter(g => g.items.length > 0)
        .map(g => (
          <div key={String(g.kind)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: TEXT_DIM }}>
              {g.kind ? `${MAP_KIND_META[g.kind].icon} ${MAP_KIND_META[g.kind].label}` : '📄 其他地图'}
              <span style={{ fontWeight: 400, color: TEXT_FAINT, marginLeft: 6 }}>{g.items.length} 张</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {g.items.map(({ e }) => {
                const own = tickets.filter(t => t.effort === e.dir || t.effort === ROOT_GROUP)
                const work = own.filter(t => ticketKind(t) === 'ticket' && !t.outOfScope)
                const done = work.filter(t => t.resolved).length
                const pct = work.length > 0 ? Math.round((done / work.length) * 100) : 0
                const { stage, color } = effortStage(own)
                return (
                  <div key={e.dir} style={{ flex: '1 1 220px', minWidth: 220, padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}` }}>
                    <div style={{ fontSize: 11, color: TEXT_FAINT, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.dir.split('/').pop()}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color, margin: '3px 0 6px' }}>{stage}</div>
                    <div style={{ height: 5, borderRadius: 3, background: CHIP_BG, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, #4ed17e, ${ACCENT})` }} />
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_FAINT, marginTop: 5 }}>
                      {pct}% · {work.length - done} 张在途 · {own.filter(t => ticketKind(t) === 'approval' && isPending(t)).length} 待拍板
                      {(() => {
                        const dn = defects.filter(t => t.effort === e.dir).length
                        if (dn === 0) return null
                        return <span style={{ color: '#f2555a', marginLeft: 6 }}>🐞 {dn}</span>
                      })()}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      {/* 待推进（2026-09-21 拍板）：当下可动 / 需要注意的事，一屏聚合 */}
      {(() => {
        const groups: { title: string; color: string; rows: { ticket: ParsedTicket; label: string; sub: string }[] }[] = [
          { title: '🚀 可开工（前置已满足）', color: ACCENT_SOFT, rows: readyTickets.map(t => ({ ticket: t, label: t.title, sub: `#${shortId(t)} · ${t.effort?.split('/').pop() ?? ''}` })) },
          { title: '🐞 待处理缺陷', color: '#f2555a', rows: openDefects },
          { title: '📒 可启动挂账', color: '#f7ad31', rows: activeLedgers },
          {
            title: '⏱ 卡在执行中（session 未运行 / 丢失 / 超 2 天）', color: '#e8894a',
            rows: stuckTickets.map(t => {
              const s = t.session !== undefined ? sessions.get(t.session) : undefined
              const ext = t.session !== undefined && !isDshSession(t.session)
              return { ticket: t, label: t.title, sub: ext ? `📎 zcode session：${t.session}` : s === undefined ? 'session 已丢失' : !s.running ? 'session 空闲中' : `已 ${ageLabel(t) ?? '多日'}` }
            }),
          },
        ]
        const total = groups.reduce((n, g) => n + g.rows.length, 0)
        return (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 8 }}>🚀 待推进 <span style={{ fontWeight: 400, color: TEXT_FAINT }}>{total} 项</span></div>
            {total === 0 ? (
              <div style={{ fontSize: 12, color: TEXT_FAINT }}>当前没有待推进项——开工的都在轨，挂账无活债，缺陷无未关闭。</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
                {groups.map(g => g.rows.length === 0 ? null : (
                  <div key={g.title} style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: g.color, marginBottom: 4 }}>{g.title} <span style={{ fontWeight: 400, color: TEXT_FAINT }}>{g.rows.length}</span></div>
                    {g.rows.map(r => row(r.ticket,
                      <span style={{ fontSize: 10, color: TEXT_FAINT, flexShrink: 0 }}>{r.sub}</span>,
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
      {/* 卡点聚合 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 300, padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#f7ad31', marginBottom: 6 }}>⏳ 最久待拍板</div>
          {oldestPending.length === 0 ? <div style={{ fontSize: 12, color: TEXT_FAINT }}>没有挂起的拍板。</div> : oldestPending.map(t => row(t,
            <span style={{ fontSize: 11, color: '#f7ad31', flexShrink: 0 }}>{ageLabel(t) ?? 'pending'}</span>,
          ))}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 300, padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#f2555a', marginBottom: 6 }}>⛔ 最长等待 blocker</div>
          {longestBlocked.length === 0 ? <div style={{ fontSize: 12, color: TEXT_FAINT }}>没有等依赖的票。</div> : longestBlocked.map(t => row(t,
            <span style={{ fontSize: 11, color: '#f2555a', fontFamily: 'monospace', flexShrink: 0 }}>{t.blockedBy.map(n => `#${n}`).join(' ')}</span>,
          ))}
        </div>
      </div>
      {/* 后台任务（C1）：绑了 session 的在途票 + 运行状态 */}
      <div style={{ padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT_SOFT, marginBottom: 6 }}>🔗 后台任务（绑 session 的在途票）</div>
        {running.length === 0 ? <div style={{ fontSize: 12, color: TEXT_FAINT }}>没有。从工单详情里「开始推演 / 推进」会在这里出现。</div> : running.map(t => {
          const ext = t.session !== undefined && !isDshSession(t.session)
          const s = t.session !== undefined ? sessions.get(t.session) : undefined
          return row(t, (
            <span style={{ fontSize: 11, fontFamily: 'monospace', flexShrink: 0, color: ext ? '#609bfa' : s === undefined ? '#666' : s.running ? '#4ed17e' : TEXT_FAINT }}>
              {ext ? `📎 zcode：${t.session}` : s === undefined ? '⚪ 已回收' : s.running ? '🟢 运行中' : '⚪ 空闲'} {t.session !== undefined && isDshSession(t.session) && shortSession(t.session)}
            </span>
          ))
        })}
      </div>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

// ─── Main PlanView ───────────────────────────────────────────────────────────

type TopView = 'overview' | 'map' | 'qa' | 'ledger' | 'guide'
// 地图页第二层子页签：一张图的各种切面（2026-09-21 拍板 IA：第一层只留
// 总览/地图/台账/说明，图相关内容全部收进地图页，顶部 chips 切图）。
type MapSub = 'route' | 'tickets' | 'approvals' | 'ledger' | 'defects' | 'chain' | 'cases'

export function PlanView(props: { ctx: any; store: any; scope: any; tab: any; visible: boolean }) {
  const { ctx, scope } = props as { ctx: any; scope: SessionScope; tab: any; visible: boolean }
  const [data, setData] = useState<PlanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [top, setTop] = useState<TopView>('map')
  const [mapSub, setMapSub] = useState<MapSub>('route')
  const [effortIdx, setEffortIdx] = useState(0)
  // The route view keeps its three renderings of the same map.
  const [variant, setVariant] = useState<'A' | 'C' | 'D'>('A')
  // Session snapshot for the C1 status chips; refetched alongside the plan so
  // post-dispatch refreshes see the new running flags too.
  const [sessions, setSessions] = useState<Map<string, SessionSummary>>(() => new Map())
  // 历史轮次：round === null 看现行 `.plan/`；选中轮 id 后数据源切到
  // `.archive/rounds/<id>/`（plan-archive 的轮目录就是当时 `.plan/` 的快照，
  // 加载逻辑原样复用），整页进入只读。
  const [rounds, setRounds] = useState<RoundInfo[]>([])
  const [round, setRound] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const base = scope.cwd ? `${scope.cwd}/` : ''
    const dir = round === null ? `${base}.plan` : `${base}.archive/rounds/${round}`
    try {
      const r = await loadPlan(scope, dir)
      if (!r) { setError('empty'); setLoading(false); return }
      setData(r)
    } catch { setError('failed') } finally { setLoading(false) }
  }, [scope.sessionId, scope.cwd, round])
  const loadSessions = useCallback(() => {
    sessionList()
      .then(items => setSessions(new Map(items.map(s => [s.sessionId, s]))))
      .catch(() => setSessions(new Map()))
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { loadSessions() }, [loadSessions])
  // 轮次清单不随派发变化，只在进入（或换仓库）时读一次；换仓库时复位轮选中。
  useEffect(() => {
    setRound(null)
    if (!scope.cwd) { setRounds([]); return }
    loadRounds(scope, scope.cwd).then(setRounds).catch(() => setRounds([]))
  }, [scope.sessionId, scope.cwd])
  // 换轮后旧 effort 下标可能越界，回到「全部地图」。
  useEffect(() => { setEffortIdx(-1) }, [round])
  // Post-dispatch refresh: the plan files may have a new `session:` binding and
  // the session map may have a new entry — both reread together.
  const onChanged = useCallback(() => { void load(); loadSessions() }, [load, loadSessions])

  const all = data?.tickets ?? []
  const routeTickets = useMemo(() => all.filter(t => classify(t) === 'ticket'), [all])
  const approvals = useMemo(() => all.filter(t => classify(t) === 'approval'), [all])
  const ledgers = useMemo(() => all.filter(t => classify(t) === 'ledger'), [all])
  const defects = useMemo(() => all.filter(t => classify(t) === 'defect'), [all])
  // 测例设计文档（qa/cases.md，一图一份）：单列在地图「🧪 测例」子页，
  // 并作为测例节点进入串联画布（按「票 NN」引用挂到被测票下）。
  const cases = useMemo(() => all.filter(t => ticketKind(t) === 'cases'), [all])
  // 根层 qa/（无图归属）：SOP 回测、整页回测等测例 + 独立缺陷，进第一层「测例&缺陷」tab
  const rootCases = useMemo(() => cases.filter(t => t.effort === ROOT_GROUP), [cases])
  const rootDefects = useMemo(() => defects.filter(t => t.effort === ROOT_GROUP), [defects])
  // Legacy `impl/` / `impl-fe/` directories are being retired; they no longer get
  // their own board — their tickets show in the normal ticket view until removed.
  const mapOwnTickets = routeTickets

  // Route view: one map at a time, showing only that map's tickets. `effortIdx`
  // of -1 means "all maps". Files read from .plan's own top level stay visible
  // under any map, since a ticket loose there belongs to the plan, not a map.
  // ⚠️ 声明顺序契约：所有引用 selectedDir 的派生状态（mapTickets/mapDefects/
  // mapApprovals/mapLedgers/mapCases…）必须声明在本行之后——useMemo 依赖数组
  // 会在渲染时立即求值，提前引用就是 TDZ 崩溃（已两次踩坑）。
  const selectedDir = effortIdx >= 0 ? data?.efforts[effortIdx]?.dir : undefined
  const mapTickets = useMemo(
    () => (effortIdx < 0 ? mapOwnTickets : mapOwnTickets.filter(t => t.effort === selectedDir || t.effort === ROOT_GROUP)),
    [mapOwnTickets, effortIdx, selectedDir],
  )
  // 缺陷挂在具体图下（.plan/<effort>/qa/），按当前选中的图过滤——与路线页共用
  // effortIdx/selectedDir，切图时缺陷跟着切。根层全局缺陷（.plan/qa/DEF-*.md，
  // 无图归属）不进地图页——2026-09-25 拍板：地图页只看图归属缺陷，全局缺陷
  // 只进第一层「测例&缺陷」tab。
  const mapDefects = useMemo(
    () => defects.filter(t => t.effort !== ROOT_GROUP && (effortIdx < 0 || t.effort === selectedDir)),
    [defects, effortIdx, selectedDir],
  )
  // 待拍板同语义随图切换（2026-09-21 拍板：筛选后看到的都是同一张图）；
  // 根层松散待拍板（.plan 根层待拍板-*.md）与路线页松散票同语义保持可见。
  const mapApprovals = useMemo(
    () => (effortIdx < 0 ? approvals : approvals.filter(t => selectedDir !== undefined && inEffort(t, selectedDir))),
    [approvals, effortIdx, selectedDir],
  )
  // 台账两级（2026-09-21 拍板拆分）：根层全局台账（.plan/ledger/*.md，一账一文件，
  // t.effort = ROOT_GROUP）是项目全局正本；`.plan/<effort>/ledger/` 是图内台账
  // （t.effort = 图目录）。第一层「台账」页只看全局；地图页的台账子页只看图内
  // 台账——2026-09-25 拍板：全部地图态聚合各图图内台账，全局台账不进地图页。
  const globalLedgers = useMemo(() => ledgers.filter(t => t.effort === ROOT_GROUP), [ledgers])
  const mapLedgers = useMemo(
    () => ledgers.filter(t => t.effort !== ROOT_GROUP && (effortIdx < 0 || t.effort === selectedDir)),
    [ledgers, effortIdx, selectedDir],
  )
  const mapCases = useMemo(
    () => (effortIdx < 0 ? cases : cases.filter(t => t.effort === selectedDir)),
    [cases, effortIdx, selectedDir],
  )

  const destination = useMemo(() => {
    const mapRaw = effortIdx >= 0 ? data?.efforts[effortIdx]?.mapRaw : data?.mapRaw
    if (!mapRaw) return null
    const m = mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/)
    return m?.[1]?.trim().split('\n')[0]?.trim() ?? null
  }, [data?.efforts, data?.mapRaw, effortIdx])

  // Both early returns keep the refresh control: "no .plan found" is exactly the
  // state where re-reading is the thing you want, and a modal dead-end with no
  // way out is worse than the error itself.
  const refreshBtn = (label = '⟳ 刷新') => (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      title="重新读取 .plan（别处改了文件时用）"
      style={{ padding: '5px 10px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent', color: loading ? '#555' : '#aaa', cursor: loading ? 'default' : 'pointer', fontSize: 12 }}
    >
      {loading ? '读取中…' : label}
    </button>
  )

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: BG, color: '#888' }}>Loading…</div>
  }
  if (error || !data) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: BG, color: '#888' }}>
        <span>{round === null ? 'No .plan found in current directory.' : `轮次 ${round} 读取失败（目录可能已被移动或删除）。`}</span>
        {refreshBtn('⟳ 重新读取')}
      </div>
    )
  }

  const planDir = data.effortDir
  const readOnly = round !== null
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '8px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', background: active ? CARD : 'transparent', color: active ? TEXT : '#888', fontSize: 12, fontWeight: active ? 700 : 400 })
  // 子页签用下划线 tab 语言（导航），与 chips 的 pill 语言（筛选）分层。
  const mapTab = (active: boolean): React.CSSProperties => ({ padding: '8px 14px 9px', border: 'none', borderRadius: 0, cursor: 'pointer', background: 'transparent', color: active ? TEXT : '#888', fontSize: 12, fontWeight: active ? 700 : 400, borderBottom: active ? `2px solid ${ACCENT_SOFT}` : '2px solid transparent' })
  const subBtn = (active: boolean): React.CSSProperties => ({ padding: '6px 14px', border: `1px solid ${active ? BORDER : 'transparent'}`, borderRadius: 7, cursor: 'pointer', background: active ? HEADER_BG : 'transparent', color: active ? TEXT : '#888', fontSize: 11.5, fontWeight: active ? 700 : 400 })

  // tab 计数语义（2026-09-21 拍板）：数字 = 未关单数量，不是总量——
  // 票=open/claimed、待拍板=pending、挂账=在挂、缺陷=未关闭。
  const openTickets = (list: ParsedTicket[]) => list.filter(t => ticketKind(t) === 'ticket' && (displayStatus(t) === 'open' || displayStatus(t) === 'claimed')).length
  const openLedgerCount = (list: ParsedTicket[]) => list.filter(t => {
    const e = parseLedgerEntries(t.body)[0]
    if (e === undefined) return false
    const stage = ledgerStage(e, t.effort, mapTickets)
    return stage === '可启动' || stage === '阻塞中'
  }).length
  const openDefectCount = (list: ParsedTicket[]) => list.reduce((n, f) => {
    const single = parseDefectFile(f)
    if (single !== undefined) return n + (DEFECT_CLOSED.has(defectStateWord(single.state)) ? 0 : 1)
    return n + parseDefectEntries(f.body).filter(d => !DEFECT_CLOSED.has(defectStateWord(d.state))).length
  }, 0)
  const pendingApprovals = (list: ParsedTicket[]) => list.filter(t => ticketKind(t) === 'approval' && isPending(t)).length

  const tabs: { id: TopView; label: string; count: number }[] = [
    { id: 'overview', label: '🧭 总览', count: pendingApprovals(approvals) },
    { id: 'map', label: '🗺️ 地图', count: openTickets(mapTickets) },
    { id: 'qa', label: '🧪 测例&缺陷', count: openDefectCount(rootDefects) + rootCases.length },
    { id: 'ledger', label: '📒 台账', count: openLedgerCount(globalLedgers) },
    { id: 'guide', label: '📖 说明', count: 0 },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT, fontFamily: 'sans-serif', fontSize: 14 }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, alignItems: 'center' }}>
        {tabs.map(t => (
          <button key={t.id} type="button" style={tabBtn(top === t.id)} onClick={() => setTop(t.id)}>
            {t.label}
            {t.id !== 'guide' && <span style={{ marginLeft: 5, fontSize: 11, color: (t.id === 'approvals' || t.id === 'overview') && t.count > 0 ? '#f7ad31' : '#777' }}>{t.count}</span>}
          </button>
        ))}
        {/* The files change outside this view — another session writes them, or
            this one does. Re-reading is the only way to see that. */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {rounds.length > 0 && (
            <select
              value={round ?? ''}
              onChange={e => setRound(e.target.value === '' ? null : e.target.value)}
              title="按轮查看历史归档（.archive/rounds，只读）"
              style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${round !== null ? '#7a4a15' : BORDER}`, background: HEADER_BG, color: round !== null ? '#f7ad31' : TEXT_DIM, fontSize: 12, outline: 'none', maxWidth: 280, cursor: 'pointer' }}
            >
              <option value="">📍 现行（.plan）</option>
              {rounds.map(r => (
                <option key={r.id} value={r.id}>🗄️ {r.id}{r.topic ? ` · ${r.topic}` : ''}</option>
              ))}
            </select>
          )}
          {refreshBtn()}
        </div>
      </div>
      {round !== null && (
        <div style={{ padding: '6px 12px', background: '#241d10', borderBottom: '1px solid #7a4a1566', fontSize: 12, color: '#e8c9a0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            🗄️ 历史轮次快照（只读）：<strong style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{round}</strong>
            {rounds.find(r => r.id === round)?.topic ? ` · ${rounds.find(r => r.id === round)?.topic}` : ''}
          </span>
          <span style={{ color: '#a98d5f' }}>归档内容勿据以实现；派活 / 拍板动作已停用。</span>
        </div>
      )}
      {top === 'map' && (
        <>
          {data.efforts.length > 0 && (
            <EffortChips efforts={data.efforts} all={all} effortIdx={effortIdx} setEffortIdx={setEffortIdx}
              countFor={dir => mapOwnTickets.filter(t => inEffort(t, dir)).length}
              totalCount={mapOwnTickets.length} />
          )}
          {/* 第二层子页签：当前选中图（或全部）的各类切面 */}
          <div style={{ display: 'flex', gap: 2, padding: '4px 14px 0', borderBottom: `1px solid ${BORDER}`, background: BG, alignItems: 'center' }}>
            {([
              ['route', '🗺️ 路线', openTickets(mapTickets)],
              ['tickets', '🎫 工单', openTickets(mapTickets)],
              ['approvals', '⏳ 待拍板', pendingApprovals(mapApprovals)],
              ['ledger', '📒 台账', openLedgerCount(mapLedgers)],
              ['defects', '🐞 缺陷', openDefectCount(mapDefects)],
              ['cases', '🧪 测例', mapCases.reduce((n, f) => n + (f.body.match(/^\|\s*[A-Z]-?\d+/gm)?.length ?? 0), 0)],
              // 串联计数 = 实际入画的连通节点数（孤岛被折叠，不计入），与画布一致
              ['chain', '🧪 串联', buildChain(mapTickets, mapDefects, mapLedgers, mapCases).nodes.length],
            ] as [MapSub, string, number][]).map(([id, label, n]) => (
              <button key={id} type="button" style={{ ...mapTab(mapSub === id) }} onClick={() => setMapSub(id)}>
                {label}<span style={{ marginLeft: 5, fontSize: 11, color: mapSub === id ? ACCENT_SOFT : '#777' }}>{n}</span>
              </button>
            ))}
          </div>
          {mapSub === 'route' && (
            <>
              <div style={{ display: 'flex', gap: 4, padding: '9px 14px', background: BG }}>
                <button type="button" style={subBtn(variant === 'A')} onClick={() => setVariant('A')}>📋 Kanban</button>
                <button type="button" style={subBtn(variant === 'D')} onClick={() => setVariant('D')}>📊 Relation</button>
                <button type="button" style={subBtn(variant === 'C')} onClick={() => setVariant('C')}>Table</button>
              </div>
              {variant === 'A' && <ViewA tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} destination={destination} readOnly={readOnly} />}
              {variant === 'D' && <ViewD tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
              {variant === 'C' && <ViewC tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
            </>
          )}
          {mapSub === 'tickets' && <ViewC tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'approvals' && <ApprovalsView approvals={mapApprovals} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'ledger' && <LedgerView ledgers={mapLedgers} mapTickets={mapTickets} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'defects' && <DefectView defects={mapDefects} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'chain' && <ChainView tickets={mapTickets} defects={mapDefects} ledgers={mapLedgers} cases={mapCases} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'cases' && <CasesView cases={mapCases} scope={scope} readOnly={readOnly} />}
        </>
      )}
      {top === 'qa' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT }}>
            无图归属的测例与缺陷（SOP 回测 / 整页回测等，落 `.plan/qa/cases-*.md` 与 `.plan/qa/DEF-*.md`）——能挂到具体工单/图的测例与缺陷放图内 `qa/`，不进本页。
          </div>
          {rootDefects.length > 0 && (
            <div style={{ flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#f2555a' }}>🐞 缺陷</div>
              <DefectView defects={rootDefects} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />
            </div>
          )}
          {rootCases.length > 0 && (
            <div style={{ flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#609bfa' }}>🧪 测例</div>
              <CasesView cases={rootCases} scope={scope} readOnly={readOnly} />
            </div>
          )}
          {rootDefects.length === 0 && rootCases.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT }}>
              `.plan/qa/` 下暂无无图归属的测例 / 缺陷文档。
            </div>
          )}
        </div>
      )}
      {top === 'guide' && <GuideView scope={scope} />}
      {top === 'ledger' && <LedgerView ledgers={globalLedgers} mapTickets={mapTickets} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
      {top === 'overview' && <OverviewView tickets={all} efforts={data.efforts} defects={defects} ledgers={ledgers} effortIdx={effortIdx} setEffortIdx={setEffortIdx} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
    </div>
  )
}

// ─── Approvals view ──────────────────────────────────────────────────────────
//
// One row per document — a decision document holds several items inside it, but
// the file is the unit that gets settled, so the file is the unit shown.

// Approval documents have a lifecycle, so the view shows it and lets you filter
// by it. `pending` is what needs you; the settled ones stay visible so you can
// confirm a decision landed rather than wondering where the document went.

type ApprovalFilter = 'pending' | 'settled' | 'all'

// ─── Guide view ──────────────────────────────────────────────────────────────
//
// The tab that explains the machinery. The other tabs show state; this one says
// where that state comes from and which step maintains it.

function GuideView({ scope }: { scope: SessionScope }) {
  const H = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, margin: '20px 0 8px' }}>{children}</div>
  )
  const P = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ fontSize: 12.5, lineHeight: 1.8, color: TEXT_DIM, margin: '6px 0', ...style }}>{children}</div>
  )
  const Code = ({ children }: { children: React.ReactNode }) => (
    <code style={{ background: 'rgba(255,255,255,.08)', padding: '1px 5px', borderRadius: 4, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11.5, color: ACCENT_SOFT }}>{children}</code>
  )
  const Box = ({ title, who, tone, children }: { title: string; who: string; tone: 'ok' | 'decide' | 'read'; children?: React.ReactNode }) => {
    const c = tone === 'decide' ? '#f7ad31' : tone === 'ok' ? '#4ed17e' : '#609bfa'
    return (
      <div style={{ flex: '1 1 140px', minWidth: 140, padding: '9px 11px', borderRadius: 8, background: CARD, border: `1px solid ${c}55`, borderTop: `3px solid ${c}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{title}</div>
        <div style={{ fontSize: 10.5, color: TEXT_FAINT, marginTop: 3, fontFamily: 'ui-monospace,Menlo,monospace', wordBreak: 'break-all' }}>{who}</div>
        {children && <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 5, lineHeight: 1.6 }}>{children}</div>}
      </div>
    )
  }
  const Arrow = () => <div style={{ alignSelf: 'center', color: TEXT_FAINT, fontSize: 15, padding: '0 1px' }}>→</div>

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 28px' }}>
      <div style={{ maxWidth: 900 }}>

        <H>这个页面是什么</H>
        <P>
          总览 / 路线 / 工单 / 待拍板 / 台账 / 缺陷 各页显示的都是在 <Code>.plan/</Code> 下的 markdown。
          本页说明这些文件怎么产生、谁维护、怎么流转。完整的流程协议（每环节的位置与交接契约）记在同仓
          <Code>skills/plan-protocol/SKILL.md</Code>，本页是它的可视化速览。
        </P>

        <H>主流程：先决策，再落地</H>
        <P>「<strong style={{ color: TEXT }}>已知要做</strong>」时走这条链——把需求写成 spec，再拆票实现。</P>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '10px 0', alignItems: 'center' }}>
          <Box title="① 决策循环" who="grill / wayfinder → to-approval → plan-approve" tone="decide">
            一轮轮收敛：把模糊决策拷问清楚、落待拍板、逐项拍板
          </Box>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0 4px', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: TEXT_FAINT, marginRight: 2 }}>决策定案（结论是「要做 X」）↓</span>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '4px 0' }}>
          <Box title="② 定需求" who="to-spec" tone="ok">
            产出 <Code>spec.md</Code>；写前读架构正本、写完更新
          </Box>
          <Arrow />
          <Box title="③ 拆票" who="to-tickets" tone="ok">
            一票一文件、每票切穿各层、写明谁阻塞谁
          </Box>
          <Arrow />
          <Box title="④ 执行" who="implement / implement-spec" tone="ok">
            按票派 subagent，并行实现、逐个合并
          </Box>
          <Arrow />
          <Box title="⑤ 回写" who="plan-sync（执行时同步）" tone="ok">
            勾验收项、置 <Code>status</Code>、补落地注
          </Box>
        </div>
        <P style={{ marginTop: 2 }}>
          <strong style={{ color: TEXT }}>回写发生在两处，是同一件事的两种时机</strong>：执行类 skill 在每张票合并落地时<strong style={{ color: TEXT }}>当场</strong>翻状态；
          <Code>plan-sync</Code> 事后对账，把「看起来已完成、票面没翻」的条目找回补齐。两者不是两套流程。
        </P>

        <H>补充流程：需要拍板的问题 / 缺口</H>
        <P>「<strong style={{ color: TEXT }}>发现一个 bug / 缺口</strong>」时走这条链——先拍板定论，依据就是拍板文档本身。</P>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '10px 0' }}>
          <Box title="问题发现" who="用户反馈 / code review / 走查 / QA 缺陷升级" tone="decide">
            需要拍板定论的问题 / 缺口
          </Box>
          <Arrow />
          <Box title="待拍板文档" who="to-approval → plan-approve" tone="decide">
            落文档、拍板；<strong style={{ color: TEXT }}>依据 = 这份文档本身</strong>
          </Box>
          <Arrow />
          <Box title="依据" who="（不追加、不新建 spec）" tone="read">
            拍板文档自带原话 + 争议 + 结论，天然当上游
          </Box>
          <Arrow />
          <Box title="接回落地链" who="to-tickets → implement → plan-sync" tone="ok">
            同上 ③ ④ ⑤
          </Box>
        </div>
        <P>
          两条流在「<strong style={{ color: TEXT }}>结论 = 要做某件事</strong>」处汇合：拍板结论若要求干活，<strong style={{ color: TEXT }}>同一轮就该落成标准票</strong>
          （<Code>plan-approve</Code> 调 <Code>to-tickets</Code>），而不是把结论留在文档里等人再拆一次。
        </P>

        <H>票的形态约定</H>
        <P>一个 effort 目录下，票按<strong style={{ color: TEXT }}>一票一文件</strong>放：</P>
        <div style={{ fontSize: 12, lineHeight: 1.9, color: TEXT_DIM, background: '#141416', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 8, padding: '10px 14px', margin: '8px 0', fontFamily: 'ui-monospace,Menlo,monospace' }}>
          .plan/&lt;effort&gt;/<br />
          &nbsp;&nbsp;map.md &nbsp;<span style={{ color: TEXT_FAINT }}>← effort 标志：没有它，整个目录不被加载</span><br />
          &nbsp;&nbsp;tickets/<br />
          &nbsp;&nbsp;&nbsp;&nbsp;01-&lt;slug&gt;.md &nbsp;<span style={{ color: TEXT_FAINT }}>← frontmatter: type / blocked_by / status</span><br />
          &nbsp;&nbsp;&nbsp;&nbsp;02-&lt;slug&gt;.md
        </div>
        <P>
          <strong style={{ color: TEXT }}>为什么必须一票一文件</strong>：把多张票写进同一个文件（如 <Code>tickets.md</Code>），
          按文件读取的一方会把它当成<strong style={{ color: TEXT }}>一张票</strong>，里面的票全部丢失——
          本插件就是按文件读的。合并文件看起来整齐，代价是内容不可见。
        </P>

        <H>几个常见疑问</H>
        <div style={{ fontSize: 12.5, lineHeight: 1.85, color: TEXT_DIM }}>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>票和待拍板有什么区别？</strong><br />
            票是<strong style={{ color: TEXT }}>等被做</strong>的活（<Code>status: open/done</Code>）；
            待拍板是<strong style={{ color: TEXT }}>等你做决定</strong>的文档（<Code>status: pending</Code>）。
            拍板结论若要干活，就该当场生成票——两者不是同一个东西，但会接力。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>看到状态不对怎么办？</strong><br />
            结构漂移先用只读脚本查：<Code>bash ~/.zcode/skills/mp-plan-approve/scripts/plan-lint.sh 仓库根/.plan</Code>
            （同票双档、缺 map.md、缺状态头/非法 status）；
            再跑 <Code>plan-sync</Code> 对账票面与实际进度（对照 git 提交判定，先报告差异再改）。
            两者都只报告、不擅自改。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>归档在哪？</strong><br />
            已完成内容由 <Code>plan-archive</Code>（手动触发）迁到 <Code>.archive/</Code>，
            并 sweep 全仓引用（含归档区自身）、标过时/废弃。归档区的「现行权威」表是引用断链的高发地，每次归档都要维护它。
            右上角「轮次」选择器可切进某一轮的快照（<Code>.archive/rounds/&lt;round-id&gt;/</Code>），
            按轮只读查看当时的路线 / 工单 / 拍板。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>历史遗留的 impl/ 、impl-fe/ 目录？</strong><br />
            那是早期形态的实施工单，正在逐步废弃。它们的票现在也出现在「🗺️ 地图 → 🎫 工单」子页，不再单独成页；
            收尾时会清理并入 <Code>tickets/</Code>。
          </div>
        </div>

        <div style={{ marginTop: 22, paddingTop: 12, borderTop: `1px solid ${BORDER_LIGHT}`, fontSize: 11, color: TEXT_FAINT }}>
          本页内容随约定演进；若与 <Code>skills/</Code> 下的 skill 正文或 <Code>plan-protocol</Code> 冲突，以 skill 为准。
        </div>
      </div>
    </div>
  )
}
function approvalState(t: ParsedTicket): ApprovalFilter {
  const w = statusWord(t)
  if (w === 'pending') return 'pending'
  return 'settled'
}

function ApprovalsView({ approvals, scope, ctx, sessions, onChanged, readOnly }: { approvals: ParsedTicket[]; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; readOnly?: boolean }) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  // 历史轮次的拍板都该已结案，默认「全部」而不是「待拍板」，否则开进来就是一句空态。
  const [filter, setFilter] = useState<ApprovalFilter>(readOnly ? 'all' : 'pending')

  const counts = useMemo(() => ({
    pending: approvals.filter(t => approvalState(t) === 'pending').length,
    settled: approvals.filter(t => approvalState(t) === 'settled').length,
    all: approvals.length,
  }), [approvals])

  const shown = useMemo(() => {
    const list = filter === 'all' ? approvals : approvals.filter(t => approvalState(t) === filter)
    // Oldest first within a group: the longest-waiting decision is the one at risk.
    return [...list].sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1))
  }, [approvals, filter])

  if (approvals.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, padding: 24, textAlign: 'center' }}>
        {readOnly ? '该轮次没有拍板文档。' : '没有待你拍板的文档。'}
        <br />
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>审批文档写 `status: pending` 后会出现在这里。</span>
      </div>
    )
  }

  const chip = (id: ApprovalFilter, label: string) => {
    const on = filter === id
    return (
      <span key={id} onClick={() => setFilter(id)} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? '#f7ad31' : BORDER}`, color: on ? '#f7ad31' : '#888', background: on ? '#ffa94d1a' : 'transparent' }}>
        {label} {counts[id]}
      </span>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {chip('pending', '⏳ 待拍板')}
        {chip('settled', '✓ 已结案')}
        {chip('all', '全部')}
      </div>
      {shown.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, fontSize: 13 }}>
          {filter === 'pending' ? '没有等你拍板的文档。' : '该筛选下没有文档。'}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(t => {
            const age = ageDays(t)
            const hot = approvalState(t) === 'pending' && age !== undefined && age >= 7
            const settled = approvalState(t) === 'settled'
            return (
              <div key={t.file} onClick={() => setFocus(t)} style={{ padding: 12, borderRadius: 10, background: settled ? CARD_DARK : CARD, border: `1px solid ${hot ? '#7a4a15' : BORDER}`, cursor: 'pointer', opacity: settled ? 0.75 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: settled ? TEXT_FAINT : '#f7ad31' }}>{settled ? '✓' : '⏳'}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: settled ? TEXT_FAINT : TEXT, lineHeight: 1.4 }}>{t.title}</span>
                  {!settled && age !== undefined && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: hot ? '#7a4a1533' : CHIP_BG, color: hot ? '#f7ad31' : '#888', flexShrink: 0 }}>{ageLabel(t)}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: settled ? '#2ecc7122' : '#ffa94d22', color: settled ? '#4ed17e' : '#f7ad31' }}>{t.status ?? 'pending'}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{t.file}</span>
                  {t.origin && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>origin: {t.origin}</span>}
                  {t.date && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{t.date}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {focus && <DetailModal ticket={focus} planDir="" scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

// ─── LedgerView（挂账台账）───────────────────────────────────────────────────
//
// 台账是 plan 级的跨图债务账本（type: ledger，.plan 根层）。它不属于任何一张
// map，所以单列一页，不再随每张 map 重复出现。agent 扫描启动的入口也在
// 这里：每笔条目带「卡点 / 启动条件」，条件满足即可开工销账。

interface LedgerEntry {
  id: string          // 挂账-NN
  title: string
  state: string       // 核心状态词（阻塞中 / 可启动 / 在挂[旧] / 已销 / 已转票）
  stateNote: string   // 状态附注（括号内的补充说明，如「卡点已解除，2026-09-21」）
  blocker: string     // 卡点：为什么现在做不了
  blocked: string[]   // 阻塞依赖的本图票号（`- 阻塞: 07, 14`；图内挂账专用）
  startWhen: string   // 启动条件：什么情况可以开展
  source: string      // 来源（何时谁挂的）
}

const LEDGER_STATES = ['阻塞中', '可启动', '在挂', '已销', '已转票']

/** 挂账阶段实时计算（2026-09-21 拍板）：带 `- 阻塞:` 的条目按依赖票的当前状态
 *  即时判定「阻塞中 / 可启动」——即使文件状态词还没被 implement 写回，页面
 *  也永远显示正确阶段。销账态原样保留。 */
function ledgerStage(e: LedgerEntry, mapTickets: ParsedTicket[]): string {
  if (e.state === '已销' || e.state === '已转票') return e.state
  const unmet = e.blocked.filter(n => {
    const t = mapTickets.find(x => { const m = x.file.match(/^(\d+)-/); return m !== null && m !== undefined && parseInt(m[1], 10) === parseInt(n, 10) })
    return t === undefined || (displayStatus(t) !== 'resolved' && !t.outOfScope)
  })
  if (e.state === '阻塞中') return unmet.length > 0 ? '阻塞中' : '可启动'
  return unmet.length > 0 ? '阻塞中' : (e.state === '可启动' ? '可启动' : '可启动')
}

/** 解析台账条目：`### 挂账-NN 标题` 小节 + `- 状态/卡点/启动条件/来源:` 固定字段。 */
function parseLedgerEntries(body: string): LedgerEntry[] {
  const out: LedgerEntry[] = []
  // 一账一文件（2026-09-21 拍板）：`# 挂账-NN 标题` 单条；旧单文件多小节
  // （`### 挂账-NN`，如归档轮快照）保持兼容。
  const sections = /(^|\n)### 挂账-/.test(body)
    ? body.split(/^### /m).slice(1)
    : body.split(/^# /m).slice(1)
  for (const sec of sections) {
    const head = sec.split('\n')[0]?.trim() ?? ''
    const m = head.match(/^(挂账-[\w.-]+)\s+(.+)$/)
    if (!m?.[1] || !m[2]) continue
    const field = (name: string) => sec.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
    // 状态词与附注拆离：「在挂（卡点已解除）」→ core=在挂, note=卡点已解除。
    // 徽标只显示核心词（颜色判断才不会被附注带偏），附注单独小字呈现。
    const rawState = field('状态') || '在挂'
    const core = LEDGER_STATES.find(s => rawState.startsWith(s)) ?? rawState
    const note = core === rawState ? '' : rawState.slice(core.length).replace(/^[（(]\s*/, '').replace(/[)）]\s*$/, '')
    const blocked: string[] = []
    for (const bm of field('阻塞').matchAll(/#?(\d+)/g)) blocked.push(bm[1] ?? '')
    out.push({
      id: m[1], title: m[2],
      state: core, stateNote: note,
      blocker: field('卡点'),
      blocked: blocked.filter(Boolean),
      startWhen: field('启动条件'),
      source: field('来源'),
    })
  }
  return out
}

function LedgerView({ ledgers, mapTickets, scope, ctx, sessions, onChanged, readOnly }: { ledgers: ParsedTicket[]; mapTickets: ParsedTicket[]; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; readOnly?: boolean }) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  // 台账筛选（2026-09-21 拍板）：默认只显未销（可启动 + 阻塞中）的活债；
  // 已转票/已销是留痕态，按需查看。阶段由 ledgerStage 依赖票实时计算。
  const [filter, setFilter] = useState<'unsold' | 'ready' | 'blocked' | 'spawned' | 'closed' | 'all'>('unsold')
  const stageOf = (t: ParsedTicket): string => {
    const e = parseLedgerEntries(t.body)[0]
    return e === undefined ? '可启动' : ledgerStage(e, t.effort, mapTickets)
  }
  const shown = filter === 'all' ? ledgers : ledgers.filter(t => {
    const s = stageOf(t)
    if (filter === 'unsold') return s === '可启动' || s === '阻塞中'
    return s === filter
  })
  const stageCount = (s: string) => ledgers.filter(t => stageOf(t) === s).length
  const counts = {
    ready: stageCount('可启动'),
    blocked: stageCount('阻塞中'),
    spawned: ledgers.filter(t => (parseLedgerEntries(t.body)[0]?.state ?? '').startsWith('已转票')).length,
    closed: ledgers.filter(t => (parseLedgerEntries(t.body)[0]?.state ?? '').startsWith('已销')).length,
  }
  const chip = (active: boolean): React.CSSProperties => ({ fontSize: 11, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${active ? ACCENT : BORDER}`, color: active ? ACCENT : TEXT_FAINT, background: active ? `${ACCENT}22` : 'transparent' })

  if (ledgers.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, padding: 24, textAlign: 'center' }}>
        没有台账条目。
        <br />
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>一账一文件：全局放 `.plan/ledger/挂账-NN-slug.md`，图内放 `.plan/&lt;effort&gt;/ledger/`，frontmatter 带 `type: ledger`。</span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ paddingBottom: 8 }}>挂账 = 发现但当下不做/做不了的项；带 `- 阻塞: 票NN` 的条目由 implement 落地后自动重算阶段。一账一文件。</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
          <span style={chip(filter === 'unsold')} onClick={() => setFilter('unsold')}>未销 {counts.ready + counts.blocked}</span>
          <span style={chip(filter === 'ready')} onClick={() => setFilter('ready')}>🚀 可启动 {counts.ready}</span>
          <span style={chip(filter === 'blocked')} onClick={() => setFilter('blocked')}>⛔ 阻塞中 {counts.blocked}</span>
          <span style={chip(filter === 'spawned')} onClick={() => setFilter('spawned')}>已转票 {counts.spawned}</span>
          <span style={chip(filter === 'closed')} onClick={() => setFilter('closed')}>已销 {counts.closed}</span>
          <span style={chip(filter === 'all')} onClick={() => setFilter('all')}>全部 {ledgers.length}</span>
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: TEXT_FAINT, fontSize: 12 }}>
            {filter === 'unsold' ? '没有未销的挂账——该销的都销了。' : '没有符合筛选的条目。'}
          </div>
        )}
        {shown.map(t => {
          const entries = parseLedgerEntries(t.body)
          const single = entries.length === 1 ? entries[0] : undefined
          if (single !== undefined) {
            // 一账一文件：整个文件就是一笔，直接渲染卡片，不要组头。
            return (
              <div key={t.file} onClick={() => setFocus(t)} style={{ padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
                <LedgerCard entry={single} />
              </div>
            )
          }
          return (
            <div key={t.file} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{t.title}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{t.file}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{entries.length} 笔在账</span>
              </div>
              {entries.length === 0 && (
                <div onClick={() => setFocus(t)} style={{ padding: 12, borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer', fontSize: 12, color: TEXT_FAINT }}>
                  未解析出台账条目（需要 `# 挂账-NN` 标题或 `### 挂账-NN` 小节格式），点开看全文。
                </div>
              )}
              {entries.map(e => (
                <div key={e.id} onClick={() => setFocus(t)} style={{ padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
                  <LedgerCard entry={e} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {focus && <DetailModal ticket={focus} planDir="" scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

const LEDGER_STATE_COLOR: Record<string, { bg: string; fg: string }> = {
  '阻塞中': { bg: '#ff6b6b22', fg: '#f2555a' },
  '可启动': { bg: '#ffa94d22', fg: '#f7ad31' },
  '在挂': { bg: '#ffa94d22', fg: '#f7ad31' },
  '已销': { bg: '#2ecc7122', fg: '#4ed17e' },
  '已转票': { bg: '#609bfa22', fg: '#609bfa' },
}

function LedgerCard({ entry: e }: { entry: LedgerEntry }) {
  const tone = LEDGER_STATE_COLOR[e.state] ?? { bg: CHIP_BG, fg: TEXT_FAINT }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: tone.bg, color: tone.fg, flexShrink: 0 }}>{e.state}</span>
        {/* 挂账-NN 编号与文件名/H1 同源（挂账带号纪律）：页面可见，口头引用才对得上。 */}
        <span style={{ fontSize: 11.5, fontFamily: 'ui-monospace,Menlo,monospace', color: TEXT_DIM, flexShrink: 0 }}>{e.id}</span>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 700, color: TEXT }}>{e.title}</span>
        {e.source && <span style={{ fontSize: 10, color: TEXT_FAINT, flexShrink: 0 }}>{e.source}</span>}
      </div>
      {e.stateNote && <div style={{ fontSize: 11, color: tone.fg, marginTop: 4, lineHeight: 1.5 }}>状态注记：{e.stateNote}</div>}
      {e.blocker && <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 6, lineHeight: 1.5 }}>卡点：{e.blocker}</div>}
      {e.startWhen && <div style={{ fontSize: 12, color: '#4ed17e', marginTop: 3, lineHeight: 1.5 }}>启动条件：{e.startWhen}</div>}
    </>
  )
}

// ─── DefectView（缺陷台账）──────────────────────────────────────────────────
//
// 缺陷挂在具体图下的 `.plan/<effort>/qa/`（type: qa-defect，一图一份台账），
// 作用域细到 map——由调用方按当前选中的图过滤后传入，与挂账台账（plan 级
// 跨图）有意不同。条目解析走文档里的「清单总览」markdown 表格。

interface DefectEntry {
  id: string       // 缺陷号
  title: string
  severity: string // 严重度（S1~S4 / 严重~建议，原样展示）
  kind: string     // 类型（rd/fe/arch/docs）
  state: string    // 状态原文，允许带附注（如「已关闭（复测 PASS）」）
  source: string   // 发现源（QA 轮 / 用户）
}

// 按表头「包含」匹配取列，不按列序号——加减列不错位，且老文档表头不统一
// （「严重程度/优先级」vs「严重度」、「domain（rd/fe/docs）」vs「类型」）
// 也不至于立刻失效。取首个表头含「缺陷号」的表格。
function parseDefectEntries(body: string): DefectEntry[] {
  const lines = body.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i] ?? ''
    if (!head.includes('缺陷号') || !isDivider(lines[i + 1] ?? '')) continue
    const cols = splitRow(head)
    const col = (...names: string[]) => cols.findIndex(c => names.some(n => c.includes(n)))
    const ix = {
      id: col('缺陷号'), title: col('标题'),
      severity: col('严重度', '严重程度'),
      kind: col('类型', 'domain'),
      state: col('状态'), source: col('发现源'),
    }
    const cell = (row: string[], k: number) => (k >= 0 ? row[k] ?? '' : '')
    const out: DefectEntry[] = []
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j] ?? ''
      if (!line.includes('|') || /^\s*$/.test(line)) break
      const cells = splitRow(line)
      const id = cell(cells, ix.id)
      if (!id) continue
      out.push({
        id, title: cell(cells, ix.title), severity: cell(cells, ix.severity),
        kind: cell(cells, ix.kind), state: cell(cells, ix.state), source: cell(cells, ix.source),
      })
    }
    return out
  }
  return []
}

// 状态取首词匹配：骨架允许「已关闭（复测 PASS）」这类带附注的写法。
const DEFECT_CLOSED = new Set(['已关闭', '关闭', '挂起'])
const defectStateWord = (s: string) => s.trim().split(/[\s(（#:：—-]/)[0] ?? ''

/** 一缺陷一文件形态（2026-09-21 拍板）：`# DEF-NN 标题` + 字段行；旧单文件「清单总览」多条目形态返回 undefined。 */
function parseDefectFile(t: ParsedTicket): (DefectEntry & { assignee: string; cases: string; gap: string }) | undefined {
  if (/^## 清单总览/m.test(t.body) || /\|\s*缺陷号/.test(t.body)) return undefined
  const m = t.body.match(/^# (DEF-[\w.-]+)\s*(.*)$/m)
  if (m === null) return undefined
  const field = (name: string) => t.body.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
  return {
    id: m[1] ?? '',
    title: (m[2] ?? '').trim() || field('标题'),
    severity: field('严重度'),
    kind: field('类型'),
    state: field('状态') || '待修复',
    source: field('发现源'),
    assignee: field('Assignee'),
    cases: field('关联用例'),
    gap: field('测试设计缺口'),
  }
}

function DefectView({ defects, scope, ctx, sessions, onChanged, readOnly }: { defects: ParsedTicket[]; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; readOnly?: boolean }) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)

  if (defects.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, padding: 24, textAlign: 'center' }}>
        当前图没有缺陷台账。
        <br />
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>{'`.plan/<effort>/qa/` 下带 `type: qa-defect` 头的缺陷台账会按图列在这里。'}</span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT }}>
        缺陷挂在具体图下（按当前选中的图过滤，切图联动）；一缺陷一文件（`qa/DEF-NN-*.md`），点卡片看全文。
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {defects.map(t => {
          const single = parseDefectFile(t)
          if (single !== undefined) {
            const closed = DEFECT_CLOSED.has(defectStateWord(single.state))
            return (
              <div key={`${t.effort}/${t.file}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{t.effort?.split('/').pop()}/{t.file}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>一缺陷一文件</span>
                </div>
                <div onClick={() => setFocus(t)} style={{ padding: '10px 12px', borderRadius: 10, background: closed ? CARD_DARK : CARD, border: `1px solid ${BORDER}`, cursor: 'pointer', opacity: closed ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: closed ? '#2ecc7122' : '#ffa94d22', color: closed ? '#4ed17e' : '#f7ad31', flexShrink: 0 }}>{single.state}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: TEXT }}>{single.title}</span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: TEXT_FAINT, flexShrink: 0 }}>{single.id}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {single.severity && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>严重度 {single.severity}</span>}
                    {single.kind && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>类型 {single.kind}</span>}
                    {single.source && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>发现源 {single.source}</span>}
                  </div>
                </div>
              </div>
            )
          }
          const entries = parseDefectEntries(t.body)
          return (
            <div key={`${t.effort}/${t.file}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{t.title}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{t.effort?.split('/').pop()}/{t.file}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{entries.length} 条</span>
              </div>
              {entries.length === 0 && (
                <div onClick={() => setFocus(t)} style={{ padding: 12, borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer', fontSize: 12, color: TEXT_FAINT }}>
                  未解析出缺陷条目（需要「清单总览」表格，表头含缺陷号/标题/严重度等列），点开看全文。
                </div>
              )}
              {entries.map(e => {
                const closed = DEFECT_CLOSED.has(defectStateWord(e.state))
                return (
                  <div key={e.id} onClick={() => setFocus(t)} style={{ padding: '10px 12px', borderRadius: 10, background: closed ? CARD_DARK : CARD, border: `1px solid ${BORDER}`, cursor: 'pointer', opacity: closed ? 0.75 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: closed ? '#2ecc7122' : '#ffa94d22', color: closed ? '#4ed17e' : '#f7ad31', flexShrink: 0 }}>{e.state || '待修复'}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: TEXT }}>{e.title}</span>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: TEXT_FAINT, flexShrink: 0 }}>{e.id}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {e.severity && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>严重度 {e.severity}</span>}
                      {e.kind && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>类型 {e.kind}</span>}
                      {e.source && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>发现源 {e.source}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {focus && <DetailModal ticket={focus} planDir="" scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

// ─── ChainView（实验）：票 · 挂账 · 缺陷 串联画布 ────────────────────────────
//
// 实验性视图（2026-09-21 拍板）：把一张图下的工单、挂账、缺陷在画布上串联——
// 挂账出自哪张票、转票落到哪张新票、缺陷提到了哪笔挂账，连线可见。
// 关系全部从文档文本抽取（挂账来源「票 NN」、转票 tickets/NN- 链接、缺陷正文
// 「挂账-NN」提及、票面 blockedBy 依赖），没有人工维护的映射表；数据侧契约
// 升级（如缺陷清单加「关联工单」列）后连线自动变稠密。画布为分列泳道：
// 票 | 挂账 | 缺陷 三列竖排，SVG 贝塞尔连线，hover/点击高亮相关边。

interface ChainNode {
  key: string
  kind: 'ticket' | 'ledger' | 'defect' | 'cases'
  title: string
  badge: string
  badgeColor: string
  sub?: string
  ticket: ParsedTicket
}

interface ChainEdge { from: string; to: string; kind: 'source' | 'spawn' | 'mention' | 'dep' | 'cover' }

const CHAIN_EDGE_STYLE: Record<ChainEdge['kind'], { color: string; dashed?: boolean; label: string }> = {
  source: { color: '#f7ad31', label: '出自票' },
  spawn: { color: '#609bfa', label: '转票落地' },
  mention: { color: '#f2555a', label: '提及关联' },
  cover: { color: '#4ed17e', label: '测例覆盖' },
  dep: { color: 'rgba(255,255,255,.30)', dashed: true, label: 'blocked' },
}

const chainTicketByNum = (list: ParsedTicket[], n: number): ParsedTicket | undefined =>
  list.find(t => { const m = t.file.match(/^(\d+)-/); return m !== null && m !== undefined && parseInt(m[1], 10) === n })

function buildChain(tickets: ParsedTicket[], defects: ParsedTicket[], ledgers: ParsedTicket[], cases: ParsedTicket[]): {
  nodes: { node: ChainNode; x: number; y: number }[]
  treeEdges: ChainEdge[]
  crossEdges: ChainEdge[]
  pos: Map<string, { x: number; y: number }>
  W: number
  H: number
  orphans: { ticket: number; ledger: number; defect: number }
} {
  const NODE_W = 250, NODE_H = 56, INDENT = 64, GAP_Y = 12, TOP = 20
  const nodes: { node: ChainNode; x: number; y: number }[] = []
  const pos = new Map<string, { x: number; y: number }>()
  const edges: ChainEdge[] = []

  const ticketNodes: ChainNode[] = tickets.map(t => ({
    key: `t:${t.id}`, kind: 'ticket' as const, ticket: t, title: t.title,
    badge: STATUS_LABELS[displayStatus(t)],
    badgeColor: DOT[displayStatus(t)],
    sub: `#${shortId(t)} · ${ticketKind(t) === 'approval' ? '待拍板' : '工单'}`,
  }))
  const ledgerNodes: ChainNode[] = ledgers.map(t => {
    const e = parseLedgerEntries(t.body)[0]
    return {
      key: `l:${e?.id ?? t.id}`, kind: 'ledger' as const, ticket: t,
      // 标题带挂账-NN 编号（挂账带号纪律）：节点上可见，超长截尾不截号。
      title: e ? `${e.id} ${e.title}` : t.title, badge: e?.state ?? '在挂',
      badgeColor: (e?.state ?? '在挂').startsWith('阻塞中') ? '#f2555a' : (e?.state ?? '在挂').startsWith('可启动') || (e?.state ?? '').startsWith('在挂') ? '#f7ad31' : '#4ed17e',
      sub: e ? `挂账 · ${e.source || '无来源'}` : '挂账',
    }
  })
  const defectNodes: ChainNode[] = []
  const defectSections: { key: string; text: string; node: ChainNode }[] = []
  for (const f of defects) {
    // 一缺陷一文件：整文件一条；旧单文件「清单总览 + ## DEF-」多小节仍兼容。
    const single = parseDefectFile(f)
    if (single !== undefined) {
      const closed = DEFECT_CLOSED.has(defectStateWord(single.state))
      const node: ChainNode = {
        key: `d:${f.id}/${single.id}`, kind: 'defect', ticket: f,
        title: single.title, badge: single.id,
        badgeColor: closed ? '#4ed17e' : '#f2555a',
        sub: `${f.effort?.split('/').pop() ?? ''} · ${single.state}`,
      }
      defectNodes.push(node)
      defectSections.push({ key: node.key, text: f.body, node })
      continue
    }
    const sections = f.body.split(/^## (DEF-[\w.-]+)/m)
    for (let i = 1; i < sections.length; i += 2) {
      const id = sections[i] ?? ''
      const text = sections[i + 1] ?? ''
      const table = parseDefectEntries(f.body).find(d => d.id === id)
      const closed = (table?.state ?? '').startsWith('已关闭')
      const node: ChainNode = {
        key: `d:${f.id}/${id}`, kind: 'defect', ticket: f,
        title: table?.title ?? id, badge: id,
        badgeColor: closed ? '#4ed17e' : '#f2555a',
        sub: `${f.effort?.split('/').pop() ?? ''} · ${table?.state ?? ''}`,
      }
      defectNodes.push(node)
      defectSections.push({ key: node.key, text, node })
    }
  }

  const casesNodes: ChainNode[] = cases.map(f => ({
    key: `c:${f.id}`, kind: 'cases' as const, ticket: f,
    title: f.title, badge: '🧪 测例', badgeColor: '#4ed17e',
    sub: `${f.effort?.split('/').pop() ?? ''} · 覆盖被测票`,
  }))

  const all: ChainNode[] = [...ticketNodes, ...ledgerNodes, ...defectNodes, ...casesNodes]
  const byKey = new Map(all.map(n => [n.key, n]))

  // 关系统一为「父 → 子」树方向（用户示例：ticket1→ticket2→挂账1→ticket3，
  // 挂账1 分叉 → 缺陷1）：票 →(出自) 挂账 →(转票) 新票；挂账 →(被提及) 缺陷。
  for (const l of ledgerNodes) {
    const body = l.ticket.body
    const src = parseLedgerEntries(body)[0]?.source ?? ''
    for (const m of src.matchAll(/票\s*(\d+)/g)) {
      const t = chainTicketByNum(tickets, parseInt(m[1] ?? '0', 10))
      if (t !== undefined) edges.push({ from: `t:${t.id}`, to: l.key, kind: 'source' })
    }
    for (const m of body.matchAll(/tickets\/(\d+)-/g)) {
      const t = chainTicketByNum(tickets, parseInt(m[1] ?? '0', 10))
      if (t !== undefined && !edges.some(e => e.from === l.key && e.to === `t:${t.id}`)) edges.push({ from: l.key, to: `t:${t.id}`, kind: 'spawn' })
    }
  }
  for (const ds of defectSections) {
    for (const m of ds.text.matchAll(/挂账-(\d+)/g)) {
      const target = `l:挂账-${m[1]}`
      if (byKey.has(target) && !edges.some(e => e.from === target && e.to === ds.key)) edges.push({ from: target, to: ds.key, kind: 'mention' })
    }
    // 缺陷详情提及票号 / tickets/NN- 引用 → 挂到对应票下（写法即关联，免拆文件）
    for (const m of ds.text.matchAll(/(?:^|[^\w-])票\s*(\d+)/g)) {
      const t = chainTicketByNum(tickets, parseInt(m[1] ?? '0', 10))
      if (t !== undefined && !edges.some(e => e.to === ds.key && e.from === `t:${t.id}`)) edges.push({ from: `t:${t.id}`, to: ds.key, kind: 'mention' })
    }
    for (const m of ds.text.matchAll(/tickets\/(\d+)-/g)) {
      const t = chainTicketByNum(tickets, parseInt(m[1] ?? '0', 10))
      if (t !== undefined && !edges.some(e => e.to === ds.key && e.from === `t:${t.id}`)) edges.push({ from: `t:${t.id}`, to: ds.key, kind: 'mention' })
    }
  }
  for (const c of casesNodes) {
    for (const m of c.ticket.body.matchAll(/票\s*(\d+)/g)) {
      const t = chainTicketByNum(tickets, parseInt(m[1] ?? '0', 10))
      if (t !== undefined && !edges.some(e => e.to === c.key && e.from === `t:${t.id}`)) edges.push({ from: `t:${t.id}`, to: c.key, kind: 'cover' })
    }
  }
  const depById = new Map(tickets.map(t => [t.id, t]))
  for (const t of tickets) {
    for (const r of t.blockedBy) {
      const b = resolveRef(r, depById)
      if (b !== undefined && depById.has(b)) edges.push({ from: `t:${b}`, to: `t:${t.id}`, kind: 'dep' })
    }
  }

  // 过滤孤岛：只画与其他条目有关系（出现在任一边中）的节点——「串联」的
  // 主体是链，无关条目折叠成计数行，否则满屏卡片稀释关系。
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  // 孤岛折叠只作用于工单票（无关联票是噪音）；缺陷/挂账是账本条目，
  // 永远入画——折叠它们等于把账藏起来（2026-09-21 修正）。
  const connected = all.filter(n => (degree.get(n.key) ?? 0) > 0 || n.kind !== 'ticket')
  const orphanOfKind = { ticket: 0, ledger: 0, defect: 0 }
  for (const n of all) if ((degree.get(n.key) ?? 0) === 0 && n.kind === 'ticket') orphanOfKind.ticket++

  // 树布局：每节点只认第一个父（其余边作交叉连线淡画），无父者为根；
  // DFS 先序占行——子节点缩进一档排在父下方，兄弟竖排。
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  const treeEdges: ChainEdge[] = []
  const crossEdges: ChainEdge[] = []
  for (const e of edges) {
    if (!byKey.has(e.from) || !byKey.has(e.to)) { crossEdges.push(e); continue }
    if (!parentOf.has(e.to)) {
      parentOf.set(e.to, e.from)
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, [])
      childrenOf.get(e.from)!.push(e.to)
      treeEdges.push(e)
    } else crossEdges.push(e)
  }
  const kindOrder: Record<ChainNode['kind'], number> = { ticket: 0, ledger: 1, defect: 2 }
  const roots = connected.filter(n => !parentOf.has(n.key))
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.key.localeCompare(b.key))
  let row = 0
  const walk = (key: string, depth: number): void => {
    const node = byKey.get(key)!
    const x = depth * INDENT
    const y = TOP + row * (NODE_H + GAP_Y)
    row++
    nodes.push({ node, x, y })
    pos.set(key, { x, y })
    for (const c of childrenOf.get(key) ?? []) walk(c, depth + 1)
  }
  for (const r of roots) walk(r.key, 0)

  const maxRight = Math.max(...nodes.map(n => n.x + NODE_W), NODE_W)
  const H = Math.max(TOP + row * (NODE_H + GAP_Y), 120) + 30
  return { nodes, treeEdges, crossEdges, pos, W: maxRight + 40, H, orphans: orphanOfKind }
}

function ChainView({ tickets, defects, ledgers, cases, planDir, scope, ctx, sessions, onChanged, readOnly }: {
  tickets: ParsedTicket[]
  defects: ParsedTicket[]
  ledgers: ParsedTicket[]
  cases: ParsedTicket[]
  planDir: string
  scope: SessionScope
  ctx: any
  sessions: Map<string, SessionSummary>
  onChanged: () => void
  readOnly?: boolean
}) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const { nodes, treeEdges, crossEdges, pos, W, H, orphans } = useMemo(() => buildChain(tickets, defects, ledgers, cases), [tickets, defects, ledgers, cases])
  const NODE_W = 250
  const connectedEdges = useMemo(() => {
    const m = new Map<string, Set<string>>()
    if (active === null) return m
    for (const e of [...treeEdges, ...crossEdges]) {
      if (e.from === active || e.to === active) {
        if (!m.has(active)) m.set(active, new Set())
        m.get(active)!.add(`${e.from}->${e.to}`)
      }
    }
    return m
  }, [treeEdges, crossEdges, active])
  const isConnected = (e: ChainEdge) => active === null || (connectedEdges.get(active)?.has(`${e.from}->${e.to}`) ?? false)
  const mk = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`
  const NODE_H = 56
  const KIND_COLOR: Record<ChainNode['kind'], string> = { ticket: '#609bfa', ledger: '#f7ad31', defect: '#f2555a', cases: '#4ed17e' }
  const KIND_LABEL: Record<ChainNode['kind'], string> = { ticket: '工单/拍板', ledger: '挂账', defect: '缺陷', cases: '测例' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px 6px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>🧪 串联（实验）</span>
        {Object.entries(KIND_COLOR).map(([kind, c]) => (
          <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: TEXT_FAINT }}>
            <span style={{ width: 3, height: 12, background: c, display: 'inline-block', borderRadius: 2 }} /> {KIND_LABEL[kind as ChainNode['kind']]}
          </span>
        ))}
        {Object.entries(CHAIN_EDGE_STYLE).map(([kind, s]) => (
          <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: TEXT_FAINT }}>
            <span style={{ width: 16, height: 2, background: s.color, display: 'inline-block' }} /> {s.label}
          </span>
        ))}
        <span style={{ fontSize: 11, color: TEXT_FAINT, marginLeft: 'auto' }}>{nodes.length} 节点 · {treeEdges.length + crossEdges.length} 条连线 · 关系自文档文本抽取</span>
      </div>
      {orphans.ticket + orphans.ledger + orphans.defect > 0 && (
        <div style={{ padding: '2px 16px 4px', fontSize: 10.5, color: TEXT_FAINT }}>
          另有 {orphans.ticket} 张工单与其他条目无关联、未画入——在票面对应文档里写上「票 NN」「挂账-NN」即可入链。
        </div>
      )}
      {nodes.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT }}>当前图没有可串联的票 / 挂账 / 缺陷。</div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }} onClick={() => setActive(null)}>
          <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }}>
            <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 1 }}>
              {/* 树边走肘线：父右缘 → 竖槽 → 子左缘，避免斜穿其他节点 */}
              {treeEdges.map((e, i) => {
                const a = pos.get(e.from), b = pos.get(e.to)
                if (a === undefined || b === undefined) return null
                const st = CHAIN_EDGE_STYLE[e.kind]
                const on = isConnected(e)
                const sx = a.x + NODE_W, sy = a.y + NODE_H / 2
                const ex = b.x, ey = b.y + NODE_H / 2
                const slotX = ex - 18
                const d = ey === sy
                  ? `M ${sx} ${sy} L ${ex} ${ey}`
                  : `M ${sx} ${sy} L ${slotX} ${sy} L ${slotX} ${ey} L ${ex} ${ey}`
                return (
                  <path key={`t${i}`} d={d} fill="none"
                    stroke={on ? st.color : 'rgba(255,255,255,.16)'} strokeWidth={on ? 2.2 : 1.4}
                    opacity={active !== null && !on ? 0.3 : 1} />
                )
              })}
              {/* 交叉边（多父等非树关系）：贝塞尔淡画 */}
              {crossEdges.map((e, i) => {
                const a = pos.get(e.from), b = pos.get(e.to)
                if (a === undefined || b === undefined) return null
                const on = isConnected(e)
                return (
                  <path key={`x${i}`} d={mk(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2)} fill="none"
                    stroke={on ? '#609bfa' : 'rgba(255,255,255,.14)'} strokeWidth={on ? 2 : 1.3}
                    strokeDasharray='5 4' opacity={active !== null && !on ? 0.3 : 1} />
                )
              })}
            </svg>
            {nodes.map(({ node, x, y }) => {
              const on = active === node.key || edgesRelated(node.key, active, treeEdges, crossEdges)
              return (
                <div key={node.key} onClick={ev => { ev.stopPropagation(); setActive(node.key); setFocus(node.ticket) }}
                  onMouseEnter={() => setActive(node.key)} onMouseLeave={() => setActive(null)}
                  style={{ position: 'absolute', left: x, top: y, width: NODE_W, height: NODE_H, zIndex: 3, display: 'flex', background: CARD, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${active === node.key ? TEXT : BORDER}`, boxShadow: active === node.key ? '0 4px 18px rgba(0,0,0,.5)' : '0 2px 8px rgba(0,0,0,.3)', opacity: active !== null && !on ? 0.4 : 1, transition: 'opacity .15s' }}>
                  <span style={{ width: 4, flexShrink: 0, background: KIND_COLOR[node.kind] }} />
                  <div style={{ padding: '7px 9px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 14 }}>
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999, flexShrink: 0, background: CHIP_BG, color: '#999' }}>{node.badge}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{node.title}</span>
                    </div>
                    {node.sub && <div style={{ fontSize: 9, color: TEXT_FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.sub}</div>}
                  </div>
                  <span title={node.badge} style={{ position: 'absolute', right: 7, top: 7, width: 8, height: 8, borderRadius: 999, background: node.badgeColor, boxShadow: '0 0 0 2px rgba(0,0,0,.25)' }} />
                </div>
              )
            })}
          </div>
        </div>
      )}
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

function edgesRelated(key: string, active: string | null, treeEdges: ChainEdge[], crossEdges: ChainEdge[]): boolean {
  if (active === null) return true
  for (const e of [...treeEdges, ...crossEdges]) {
    if ((e.from === key && e.to === active) || (e.from === active && e.to === key)) return true
  }
  return false
}

// ─── CasesView（测例）────────────────────────────────────────────────────────
//
// 一图一份 `qa/cases.md`（to-qa-testcases 产出），单列在地图「🧪 测例」子页。
// 不拆文件：测例是批量设计文档，§0-§2 的被测对象/七源盘点/覆盖矩阵是共享
// 上下文；单用例需要独立跟踪时它已升级为缺陷（拆出去的是缺陷不是测例）。

function CasesView({ cases, scope, readOnly }: { cases: ParsedTicket[]; scope: SessionScope; readOnly?: boolean }) {
  if (cases.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, padding: 24, textAlign: 'center' }}>
        当前图没有测例文档。
        <br />
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>{'`to-qa-testcases` 产出的 `.plan/<effort>/qa/cases.md` 会按图列在这里（一图一份，不拆文件）。'}</span>
      </div>
    )
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{MD_CSS}</style>
      {cases.map(c => (
        <div key={`${c.effort}/${c.file}`} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, background: HEADER_BG }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>🧪 {c.title}</span>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{c.effort?.split('/').pop()}/{c.file}</span>
          </div>
          <div style={{ padding: '10px 14px 14px', fontSize: 13, color: TEXT_DIM }} dangerouslySetInnerHTML={{ __html: md(c.body) }} />
        </div>
      ))}
    </div>
  )
}
