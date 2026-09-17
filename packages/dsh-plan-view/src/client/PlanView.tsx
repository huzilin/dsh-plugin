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
import { fsTree, fsRead, type SessionScope, type FsEntry } from './api'

// ─── Types ──────────────────────────────────────────────────────────────────

type TicketStatus = 'resolved' | 'out_of_scope' | 'claimed' | 'open'

interface ParsedTicket {
  id: string; file: string; title: string; type: string | undefined
  blockedBy: string[]; resolved: boolean; outOfScope: boolean; claimedBy: string | undefined
  status: string | undefined  // frontmatter `status` — the portable state field
  date: string | undefined    // frontmatter `date` — used for "how long has this been pending"
  origin: string | undefined  // frontmatter `origin` — why an approval doc exists
  path?: string               // resolved fs path, since tickets are not always under tickets/
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
    status: fm.status, date: fm.date, origin: fm.origin, body,
  }
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

function md(text: string): string {
  let html = text
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>')
  return '<p>' + html + '</p>'
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_THEME: Record<string, { icon: string; color: string }> = {
  research: { icon: '🔍', color: '#7c6bff' }, grilling: { icon: '🔥', color: '#ff6b6b' },
  prototype: { icon: '🛠️', color: '#ffa94d' }, task: { icon: '⚡', color: '#4dabf7' },
}
// Types a repo actually writes that are not in the table above. Kept separate so
// an unknown type shows a neutral bullet rather than a bare "?" — a question
// mark reads as "something is broken", which it never is.
const TYPE_FALLBACK = { icon: '•', color: '#888' }
// Sentinel for "this file declares no type" — a real bucket, never a hidden one.
const NO_TYPE = '\u0000no-type'
const typeTheme = (t: string | undefined) => TYPE_THEME[t ?? ''] ?? TYPE_FALLBACK
const DOT: Record<string, string> = { open: '#6b6b8a', claimed: '#f0a500', resolved: '#2ecc71', out_of_scope: '#555577' }
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

type TicketKind = 'ticket' | 'approval' | 'note'

/** Approval documents are `type: approval`, or any doc carrying a pending-style status. */
function ticketKind(t: ParsedTicket): TicketKind {
  const ty = (t.type ?? '').trim().toLowerCase()
  if (ty === 'approval') return 'approval'
  if (isPending(t)) return 'approval'
  // map/spec/index documents describe the effort rather than asking for work.
  if (ty === 'spec' || ty === 'design' || /^(map|readme|index)$/i.test(t.id)) return 'note'
  // A document declaring neither a type nor a status is not claiming to be a
  // ticket — it is a note (a research record, a ledger, a handoff). Counting it
  // as a ticket invented work that did not exist, so it is classified neutral.
  // Both fields are read because either one is a claim of intent; a real ticket
  // states at least one.
  if (!ty && !t.status) return 'note'
  return 'ticket'
}

const KIND_META: Record<TicketKind, { label: string; icon: string; color: string }> = {
  ticket: { label: '工单', icon: '🎫', color: '#4dabf7' },
  approval: { label: '待拍板', icon: '⏳', color: '#ffa94d' },
  note: { label: '说明', icon: '📄', color: '#7a7a9a' },
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

// ─── Theme (softer deep purple alternative) ────────────────────────────────

const BG = '#0d0d1a', CARD = '#2d2d52', CARD_DARK = '#1a1a36', TEXT = '#e0e0f0'
const BORDER = '#2a2a4e', BORDER_LIGHT = '#26264a', HEADER_BG = '#161628'

// ─── Data loading ────────────────────────────────────────────────────────────

const mdEntries = (tree: { entries: FsEntry[] }) => tree.entries.filter((e: FsEntry) => e.name.endsWith('.md') && !e.isDir)

// Ticket files live in different shapes across repos:
//   wayfinder : <effort>/tickets/*.md      (its own directory, the original contract)
//   novel     : <effort>/*.md              (beside map.md)
//               <effort>/impl-fe/*.md      (one level down, grouped by workstream)
// Read all that exist rather than assuming one, so a repo only has to match
// *a* convention instead of this view's.
async function collectTicketFiles(scope: SessionScope, effortDir: string): Promise<FsEntry[]> {
  const tree = await fsTree(scope, effortDir)
  const inTickets = tree.entries.find((e: FsEntry) => e.isDir && e.name === 'tickets')
  if (inTickets) {
    const sub = await fsTree(scope, inTickets.path)
    const found = mdEntries(sub)
    if (found.length > 0) return found
  }
  // Skip map/spec/readme companions: they describe the effort, they are not tickets.
  const NON_TICKET = /^(map|spec|tech-spec|fe-v1-spec|readme)\.md$/i
  const here = mdEntries(tree).filter((e: FsEntry) => !NON_TICKET.test(e.name))
  const subs = await Promise.all(
    tree.entries.filter((e: FsEntry) => e.isDir && !e.hidden && e.name !== 'tickets' && e.name !== 'node_modules')
      .map(async (d: FsEntry) => mdEntries(await fsTree(scope, d.path)).filter((e: FsEntry) => !NON_TICKET.test(e.name))),
  )
  return [...here, ...subs.flat()]
}

// ─── Three views, one collection pass ────────────────────────────────────────
//
// The tab shows three different things that happen to share a directory:
//   路线 (route)     — the wayfinder map: an effort's destination and its DAG
//   工单 (tickets)   — work waiting to be done
//   待拍板 (approvals) — decisions waiting on the human
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
  const [mapRaws, ...fileGroups] = await Promise.all([
    Promise.all(allEfforts.map((d: string) => fsRead(scope, `${d}/map.md`))),
    Promise.resolve(mdEntries(rootTree)),
    ...effortDirs.map((d: string) => collectTicketFiles(scope, d)),
  ])
  const efforts = allEfforts.map((dir: string, i: number) => ({
    dir, mapRaw: mapRaws[i]?.kind === 'text' ? mapRaws[i].content : '',
  }))
  const seen = new Set<string>()
  const mdFiles: FsEntry[] = []
  for (const e of fileGroups.flat()) {
    if (seen.has(e.path)) continue
    seen.add(e.path)
    mdFiles.push(e)
  }
  const raws = await Promise.all(mdFiles.map((e: FsEntry) => fsRead(scope, e.path).then(r => r.kind === 'text' ? r.content : '')))
  const tickets = mdFiles.map((e: FsEntry, i: number) => ({ ...deriveTicketStatus(e.name, raws[i] ?? ''), path: e.path }))
  // The route view's banner shows the first effort that actually has a map body.
  const primary = efforts.find(e => e.mapRaw !== '') ?? efforts[0]
  return { tickets, effortDir: primary?.dir ?? planDir, mapRaw: primary?.mapRaw ?? null, efforts }
}

// ─── Shared detail modal ─────────────────────────────────────────────────────

function DetailModal({ ticket, planDir, scope, onClose }: { ticket: ParsedTicket; planDir: string; scope: SessionScope; onClose: () => void }) {
  const [fullBody, setFullBody] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    // `path` is known when the file was discovered; fall back to the wayfinder
    // layout for callers that only carry a file name.
    const target = ticket.path ?? `${planDir}/tickets/${ticket.file}`
    fsRead(scope, target).then(r => {
      if (alive && r.kind === 'text') setFullBody(r.content)
    })
    return () => { alive = false }
  }, [ticket.file, ticket.path, planDir, scope])
  const body = fullBody ?? ticket.body
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,15,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ width: 'min(560px, 90vw)', maxHeight: '78vh', overflow: 'auto', background: HEADER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: DOT[displayStatus(ticket)] }}>{typeTheme(ticket.type).icon}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, lineHeight: 1.4, flex: 1 }}>{ticket.title}</span>
          <button style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' }} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#1e1e3a', color: '#888', border: `1px solid ${BORDER}` }}>#{shortId(ticket)}</span>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: `${KIND_META[ticketKind(ticket)].color}22`, color: KIND_META[ticketKind(ticket)].color }}>{KIND_META[ticketKind(ticket)].icon} {KIND_META[ticketKind(ticket)].label}</span>
          {ticket.type && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: `${typeTheme(ticket.type).color}22`, color: typeTheme(ticket.type).color }}>{ticket.type}</span>}
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#1e1e3a', color: DOT[displayStatus(ticket)], border: `1px solid ${BORDER}` }}>{STATUS_LABELS[displayStatus(ticket)]}</span>
          {ticket.claimedBy && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#f0a50022', color: '#f0a500' }}>👤 {ticket.claimedBy}</span>}
          {ticket.status && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#1e1e3a', color: '#aaa', border: `1px solid ${BORDER}` }}>status: {ticket.status}</span>}
          {ageLabel(ticket) && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#ffa94d22', color: '#ffa94d' }}>{ageLabel(ticket)}</span>}
          {ticket.origin && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#1e1e3a', color: '#888', border: `1px solid ${BORDER}` }}>origin: {ticket.origin}</span>}
          {ticket.blockedBy.length > 0 && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#ff6b6b22', color: '#ff6b6b' }}>blocked_by: {ticket.blockedBy.map(n => `#${n}`).join(', ')}</span>}
        </div>
        <div style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.75, color: '#c8c8e8', background: '#1e1e3a', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }} dangerouslySetInnerHTML={{ __html: md(body) }} />
      </div>
    </div>
  )
}

// ─── Variant A: Kanban ───────────────────────────────────────────────────────

function ViewA({ tickets, planDir, scope, destination }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope; destination: string | null }) {
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
      {waiting.length > 0 && (
        <div style={{ margin: '8px 16px 0', padding: '8px 12px', borderRadius: 8, background: '#3a2410', border: '1px solid #7a4a15', fontSize: 13 }}>
          <div style={{ fontWeight: 700, color: '#ffa94d', marginBottom: 4 }}>⏳ 等你拍板（{waiting.length}）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {waiting.map(t => (
              <div key={t.id} onClick={() => setFocus(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e8c9a0' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#ffa94d' }}>{shortId(t)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                {ageLabel(t) && <span style={{ fontSize: 11, color: '#ffa94d', flexShrink: 0 }}>{ageLabel(t)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {destination && <div style={{ margin: '8px 16px 0', padding: '8px 12px', borderRadius: 8, background: HEADER_BG, border: `1px solid ${BORDER}`, color: '#aaa', fontSize: 13 }}>{destination}</div>}
      <div style={{ margin: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#1e1e3a', border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: 'linear-gradient(90deg, #2ecc71, #7c6bff)' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#2ecc71', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 10, padding: '12px 16px', overflowX: 'auto' }}>
        {STATUS_ORDER.filter(s => groups[s].length > 0).map(s => (
          <div key={s} style={{ flex: '1 1 0', minWidth: 200, display: 'flex', flexDirection: 'column', background: '#080814', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: `1px solid ${BORDER_LIGHT}`, background: '#121224' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[s] }} />
              <span style={{ fontWeight: 700, fontSize: 12 }}>{STATUS_LABELS[s]}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{groups[s].length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groups[s].map(t => (
                <div key={t.file} style={{ padding: 8, borderRadius: 8, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer' }} onClick={() => setFocus(t)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#888', background: '#1e1e3a', borderRadius: 999, minWidth: 20, height: 20, padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{shortId(t)}</span>
                    <span style={{ fontSize: 12 }}>{KIND_META[ticketKind(t)].icon}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: `${KIND_META[ticketKind(t)].color}22`, color: KIND_META[ticketKind(t)].color }}>{KIND_META[ticketKind(t)].icon} {KIND_META[ticketKind(t)].label}</span>
                    {t.type && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: `${typeTheme(t.type).color}22`, color: typeTheme(t.type).color }}>{t.type}</span>}
                    {isPending(t) && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#ffa94d33', color: '#ffa94d' }}>{ageLabel(t) ?? '待拍板'}</span>}
                    {t.claimedBy && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#f0a50022', color: '#f0a500' }}>👤 {t.claimedBy}</span>}
                    {t.blockedBy.length > 0 && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: '#ff6b6b22', color: '#ff6b6b' }}> {t.blockedBy.map(n => `#${n}`).join(',')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} onClose={() => setFocus(null)} />}
    </div>
  )
}

// ─── Variant C: Table ────────────────────────────────────────────────────────

function ViewC({ tickets, planDir, scope }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope }) {
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
        <div style={{ width: 200, flexShrink: 0, background: '#121224', borderRight: `1px solid ${BORDER}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Search</div>
            <input style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDER}`, background: HEADER_BG, color: TEXT, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} placeholder="title / body / owner…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
            {STATUS_ORDER.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c8c8e8', cursor: 'pointer', padding: '1px 0' }}>
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
                const theme = t === NO_TYPE ? { icon: '∅', color: '#8a8ab0' } : typeTheme(t)
                const on = typeSet.has(t)
                const label = t === NO_TYPE ? '（无 type）' : t
                return <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${theme.color}`, color: on ? '#fff' : theme.color, background: on ? theme.color : 'transparent' }} onClick={() => setTypeSet(toggle(typeSet, t))}>{theme.icon} {label}</span>
              })}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c8c8e8', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyBlocked} onChange={e => setOnlyBlocked(e.target.checked)} /> Only blocked
          </label>
          <button style={{ marginTop: 'auto', padding: '6px 0', borderRadius: 6, border: `1px solid ${BORDER}`, background: HEADER_BG, color: '#888', cursor: 'pointer', fontSize: 11 }} onClick={() => { setQuery(''); setStatusSet(new Set(OUTSTANDING)); setTypeSet(new Set(allTypes)); setKindSet(new Set(['ticket', 'approval', 'note'] as TicketKind[])); setOnlyBlocked(false) }}>Reset</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#55557a' }}>No matching tickets</div>
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
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a`, fontFamily: 'monospace', color: '#8a8ab0', fontSize: 11 }}>{shortId(t)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a`, fontWeight: 600, color: TEXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${KIND_META[ticketKind(t)].color}1e`, color: KIND_META[ticketKind(t)].color, border: `1px solid ${KIND_META[ticketKind(t)].color}44`, fontSize: 11 }}>{KIND_META[ticketKind(t)].icon} {KIND_META[ticketKind(t)].label}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${th.color}1e`, color: th.color, border: `1px solid ${th.color}44`, fontSize: 11 }}>{th.icon} {t.type ?? '（无 type）'}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a` }}><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[displayStatus(t)] }} />{STATUS_LABELS[displayStatus(t)]}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a`, color: t.claimedBy ? '#f0a500' : '#55557a' }}>{t.claimedBy ?? '—'}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a`, color: t.blockedBy.length > 0 ? '#ff6b6b' : '#55557a', fontFamily: 'monospace', fontSize: 11 }}>{t.blockedBy.length > 0 ? t.blockedBy.map(n => `#${n}`).join(' ') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {detail && <DetailModal ticket={detail} planDir={planDir} scope={scope} onClose={() => setDetail(null)} />}
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

function ViewD({ tickets, planDir, scope }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope }) {
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
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', background: '#1e1e3a', borderRadius: 999, minWidth: 18, height: 18, padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{shortId(t)}</span>
                    <span style={{ fontSize: 12 }}>{KIND_META[ticketKind(t)].icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: '#8a8ab0', display: 'flex', gap: 6 }}>{STATUS_LABELS[displayStatus(t)]}{t.claimedBy && <> 👤 {t.claimedBy}</>}</div>
                </div>
              </div>
            )
          })}
          {[...sidePos.entries()].map(([n, p]) => {
            const t = tickets.find(x => x.id === n)!
            return (
              <div key={n} style={{ position: 'absolute', display: 'flex', background: CARD_DARK, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', zIndex: 3, boxShadow: '0 2px 8px rgba(0,0,0,.3)', border: '2px dashed #383860', width: NODE_W, height: NODE_H, left: p.x, top: p.y }} onClick={e => { e.stopPropagation(); setSel(n) }} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
                <span style={{ width: 4, flexShrink: 0, background: '#383860' }} />
                <div style={{ padding: '7px 8px 7px 8px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', background: '#1e1e3a', borderRadius: 999, minWidth: 18, height: 18, padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{shortId(t)}</span>
                    <span style={{ fontSize: 12 }}>⛔</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: '#8a8ab0' }}>ruled out</div>
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
              const sc = e.dashed ? '#666688' : connected ? TEXT : '#454570'
              return <path key={e.key} d={mk(sx, sy, ex, ey)} fill="none" stroke={sc} strokeWidth={sw} strokeDasharray={e.dashed ? '5 4' : undefined} opacity={active !== null && !connected ? 0.45 : 1} markerEnd={connected && !e.dashed ? 'url(#da2)' : e.dashed ? undefined : 'url(#da)'} style={{ transition: 'stroke-width .18s, opacity .18s' }} />
            })}
          </svg>
        </div>
      </div>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} onClose={() => setSel(null)} />}
    </div>
  )
}

// ─── Main PlanView ───────────────────────────────────────────────────────────

type TopView = 'route' | 'tickets' | 'approvals'

export function PlanView(props: { ctx: any; store: any; scope: any; tab: any; visible: boolean }) {
  const { scope } = props as { scope: SessionScope; tab: any; visible: boolean }
  const [data, setData] = useState<PlanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [top, setTop] = useState<TopView>('route')
  const [effortIdx, setEffortIdx] = useState(0)
  // The route view keeps its three renderings of the same map.
  const [variant, setVariant] = useState<'A' | 'C' | 'D'>('A')
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const dir = scope.cwd ? `${scope.cwd}/.plan` : '.plan'
    try {
      const r = await loadPlan(scope, dir)
      if (!r) { setError('empty'); setLoading(false); return }
      setData(r)
    } catch { setError('failed') } finally { setLoading(false) }
  }, [scope.sessionId, scope.cwd])
  useEffect(() => { void load() }, [load])

  const all = data?.tickets ?? []
  const routeTickets = useMemo(() => all.filter(t => classify(t) === 'ticket'), [all])
  const approvals = useMemo(() => all.filter(t => classify(t) === 'approval'), [all])
  const destination = useMemo(() => {
    const mapRaw = data?.efforts[effortIdx]?.mapRaw
    if (!mapRaw) return null
    const m = mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/)
    return m?.[1]?.trim().split('\n')[0]?.trim() ?? null
  }, [data?.efforts, effortIdx])

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, color: '#888' }}>Loading…</div>
  if (error || !data) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, color: '#888' }}>No .plan found in current directory.</div>

  const planDir = data.effortDir
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '6px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', background: active ? CARD : 'transparent', color: active ? TEXT : '#888', fontSize: 12, fontWeight: active ? 700 : 400 })
  const subBtn = (active: boolean): React.CSSProperties => ({ flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, cursor: 'pointer', background: active ? HEADER_BG : 'transparent', color: active ? TEXT : '#888', fontSize: 11 })

  const tabs: { id: TopView; label: string; count: number }[] = [
    { id: 'route', label: '🗺️ 路线', count: routeTickets.length },
    { id: 'tickets', label: '🎫 工单', count: routeTickets.length },
    { id: 'approvals', label: '⏳ 待拍板', count: approvals.length },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT, fontFamily: 'sans-serif', fontSize: 14 }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>
        {tabs.map(t => (
          <button key={t.id} type="button" style={tabBtn(top === t.id)} onClick={() => setTop(t.id)}>
            {t.label}
            <span style={{ marginLeft: 5, fontSize: 11, color: t.id === 'approvals' && t.count > 0 ? '#ffa94d' : '#777' }}>{t.count}</span>
          </button>
        ))}
      </div>
      {top === 'route' && (
        <>
          {data.efforts.length > 1 && (
            <div style={{ display: 'flex', gap: 6, padding: '6px 10px 0', flexWrap: 'wrap' }}>
              {data.efforts.map(e => (
                <span key={e.dir} onClick={() => setEffortIdx(data.efforts.indexOf(e))} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${effortIdx === data.efforts.indexOf(e) ? '#7c6bff' : BORDER}`, color: effortIdx === data.efforts.indexOf(e) ? '#7c6bff' : '#888' }}>{e.dir.split('/').pop()}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 2, padding: '4px 8px', borderBottom: `1px solid ${BORDER}`, background: BG }}>
            <button type="button" style={subBtn(variant === 'A')} onClick={() => setVariant('A')}>📋 Kanban</button>
            <button type="button" style={subBtn(variant === 'D')} onClick={() => setVariant('D')}>📊 Relation</button>
            <button type="button" style={subBtn(variant === 'C')} onClick={() => setVariant('C')}>Table</button>
          </div>
          {variant === 'A' && <ViewA tickets={routeTickets} planDir={planDir} scope={scope} destination={destination} />}
          {variant === 'D' && <ViewD tickets={routeTickets} planDir={planDir} scope={scope} />}
          {variant === 'C' && <ViewC tickets={routeTickets} planDir={planDir} scope={scope} />}
        </>
      )}
      {top === 'tickets' && <ViewC tickets={routeTickets} planDir={planDir} scope={scope} />}
      {top === 'approvals' && <ApprovalsView approvals={approvals} scope={scope} />}
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

function approvalState(t: ParsedTicket): ApprovalFilter {
  const w = statusWord(t)
  if (w === 'pending') return 'pending'
  return 'settled'
}

function ApprovalsView({ approvals, scope }: { approvals: ParsedTicket[]; scope: SessionScope }) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  const [filter, setFilter] = useState<ApprovalFilter>('pending')

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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#55557a', padding: 24, textAlign: 'center' }}>
        没有待你拍板的文档。<br />
        <span style={{ fontSize: 12, color: '#44445e' }}>审批文档写 `status: pending` 后会出现在这里。</span>
      </div>
    )
  }

  const chip = (id: ApprovalFilter, label: string) => {
    const on = filter === id
    return (
      <span key={id} onClick={() => setFilter(id)} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? '#ffa94d' : BORDER}`, color: on ? '#ffa94d' : '#888', background: on ? '#ffa94d1a' : 'transparent' }}>
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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#55557a', fontSize: 13 }}>
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
                  <span style={{ fontSize: 13, color: settled ? '#555577' : '#ffa94d' }}>{settled ? '✓' : '⏳'}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: settled ? '#9a9ac0' : TEXT, lineHeight: 1.4 }}>{t.title}</span>
                  {!settled && age !== undefined && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: hot ? '#7a4a1533' : '#1e1e3a', color: hot ? '#ffa94d' : '#888', flexShrink: 0 }}>{ageLabel(t)}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: settled ? '#2ecc7122' : '#ffa94d22', color: settled ? '#2ecc71' : '#ffa94d' }}>{t.status ?? 'pending'}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: '#1e1e3a', color: '#888' }}>{t.file}</span>
                  {t.origin && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: '#1e1e3a', color: '#888' }}>origin: {t.origin}</span>}
                  {t.date && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: '#1e1e3a', color: '#888' }}>{t.date}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {focus && <DetailModal ticket={focus} planDir="" scope={scope} onClose={() => setFocus(null)} />}
    </div>
  )
}
