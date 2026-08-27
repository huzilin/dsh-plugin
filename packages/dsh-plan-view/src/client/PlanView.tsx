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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fsTree, fsRead, type SessionScope, type FsEntry } from './api'

// ─── Types ──────────────────────────────────────────────────────────────────

type TicketStatus = 'resolved' | 'out_of_scope' | 'claimed' | 'open'

interface ParsedTicket {
  file: string; title: string; type: string | undefined
  blockedBy: number[]; resolved: boolean; outOfScope: boolean; claimedBy: string | undefined
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
    file, title: titleMatch?.[1]?.replace(/`[^`]*`/g, '')?.trim() ?? file,
    type: fm.type,
    blockedBy: (fm.blocked_by ?? '').replace(/[\[\]]/g, '').split(/[,\s]+/).map(Number).filter(Boolean),
    resolved: hasAnswer, outOfScope: hasRuledOut, claimedBy: fm.claimed_by, body,
  }
}

function displayStatus(t: ParsedTicket): TicketStatus {
  if (t.outOfScope) return 'out_of_scope'; if (t.resolved) return 'resolved'
  if (t.claimedBy) return 'claimed'; return 'open'
}

function ticketNum(file: string): number { const m = file.match(/^(\d+)/); return m ? Number(m[1]) : 0 }

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
const DOT: Record<string, string> = { open: '#6b6b8a', claimed: '#f0a500', resolved: '#2ecc71', out_of_scope: '#555577' }
const STATUS_LABELS: Record<TicketStatus, string> = { open: 'Open', claimed: 'Claimed', resolved: 'Resolved', out_of_scope: 'Out of scope' }
const STATUS_ORDER: TicketStatus[] = ['open', 'claimed', 'resolved', 'out_of_scope']

// ─── Theme (softer deep purple alternative) ────────────────────────────────

const BG = '#0d0d1a', CARD = '#2d2d52', CARD_DARK = '#1a1a36', TEXT = '#e0e0f0'
const BORDER = '#2a2a4e', BORDER_LIGHT = '#26264a', HEADER_BG = '#161628'

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadPlan(scope: SessionScope, planDir: string): Promise<{ mapRaw: string; tickets: ParsedTicket[]; effortDir: string } | null> {
  let effortDir = planDir
  const rootTree = await fsTree(scope, planDir)
  if (!rootTree.entries.some((e: FsEntry) => e.name === 'map.md' && !e.isDir)) {
    for (const d of rootTree.entries.filter((e: FsEntry) => e.isDir)) {
      const sub = await fsTree(scope, d.path)
      if (sub.entries.some((e: FsEntry) => e.name === 'map.md' && !e.isDir)) { effortDir = d.path; break }
    }
  }
  const [mapRes, treeRes] = await Promise.all([
    fsRead(scope, `${effortDir}/map.md`), fsTree(scope, `${effortDir}/tickets`),
  ])
  const mapRaw = mapRes.kind === 'text' ? mapRes.content : ''
  const mdFiles = treeRes.entries.filter((e: FsEntry) => e.name.endsWith('.md') && !e.isDir)
  const raws = await Promise.all(mdFiles.map((e: FsEntry) => fsRead(scope, e.path).then(r => r.kind === 'text' ? r.content : '')))
  const tickets = mdFiles.map((e: FsEntry, i: number) => deriveTicketStatus(e.name, raws[i] ?? ''))
  return { mapRaw, tickets, effortDir }
}

// ─── Shared detail modal ─────────────────────────────────────────────────────

function DetailModal({ ticket, planDir, scope, onClose }: { ticket: ParsedTicket; planDir: string; scope: SessionScope; onClose: () => void }) {
  const [fullBody, setFullBody] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fsRead(scope, `${planDir}/tickets/${ticket.file}`).then(r => {
      if (alive && r.kind === 'text') setFullBody(r.content)
    })
    return () => { alive = false }
  }, [ticket.file, planDir, scope])
  const body = fullBody ?? ticket.body
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,15,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ width: 'min(560px, 90vw)', maxHeight: '78vh', overflow: 'auto', background: HEADER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: DOT[displayStatus(ticket)] }}>{TYPE_THEME[ticket.type ?? '']?.icon ?? '…'}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, lineHeight: 1.4, flex: 1 }}>{ticket.title}</span>
          <button style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' }} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#1e1e3a', color: '#888', border: `1px solid ${BORDER}` }}>#{ticketNum(ticket.file)}</span>
          {ticket.type && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: `${TYPE_THEME[ticket.type]?.color ?? '#888'}22`, color: TYPE_THEME[ticket.type]?.color ?? '#888' }}>{ticket.type}</span>}
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#1e1e3a', color: DOT[displayStatus(ticket)], border: `1px solid ${BORDER}` }}>{STATUS_LABELS[displayStatus(ticket)]}</span>
          {ticket.claimedBy && <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: '#f0a50022', color: '#f0a500' }}>👤 {ticket.claimedBy}</span>}
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
  const active = tickets.filter(t => !t.outOfScope)
  const done = tickets.filter(t => t.resolved).length
  const pct = active.length > 0 ? Math.round((done / active.length) * 100) : 0
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT }}>
      <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Kanban</span>
        <span style={{ fontSize: 12, color: '#888' }}>{tickets.length} tickets · {done} resolved</span>
      </div>
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
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#888', background: '#1e1e3a', borderRadius: 999, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{String(ticketNum(t.file)).padStart(2, '0')}</span>
                    <span style={{ fontSize: 12 }}>{TYPE_THEME[t.type ?? '']?.icon ?? '?'}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {t.type && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: `${TYPE_THEME[t.type]?.color ?? '#888'}22`, color: TYPE_THEME[t.type]?.color ?? '#888' }}>{t.type}</span>}
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
  const [statusSet, setStatusSet] = useState<Set<TicketStatus>>(() => new Set(STATUS_ORDER))
  const [typeSet, setTypeSet] = useState<Set<string>>(() => new Set(Object.keys(TYPE_THEME)))
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'num', dir: 1 })
  const [detail, setDetail] = useState<ParsedTicket | null>(null)
  const rows = useMemo(() => {
    let out = tickets.filter(t => {
      if (onlyBlocked && t.blockedBy.length === 0) return false
      if (!statusSet.has(displayStatus(t))) return false
      if (!typeSet.has(t.type ?? '')) return false
      if (query && !`${t.title} ${t.body} ${t.claimedBy ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    out = [...out].sort((a, b) => {
      let v = 0
      if (sort.key === 'num') v = ticketNum(a.file) - ticketNum(b.file)
      else if (sort.key === 'status') v = STATUS_ORDER.indexOf(displayStatus(a)) - STATUS_ORDER.indexOf(displayStatus(b))
      else v = (a.type ?? '').localeCompare(b.type ?? '')
      return v * sort.dir
    })
    return out
  }, [tickets, query, statusSet, typeSet, onlyBlocked, sort])
  const toggle = <T,>(set: Set<T>, v: T): Set<T> => { const nx = new Set(set); if (nx.has(v)) nx.delete(v); else nx.add(v); return nx }
  const sortBy = (key: string) => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  const arrow = (key: string) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '')
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT }}>
      <div style={{ padding: '10px 16px', background: HEADER_BG, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Table</span>
        <span style={{ fontSize: 12, color: '#888' }}>{rows.length}/{tickets.length} tickets</span>
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
            <div style={{ fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', marginBottom: 4 }}>Type</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {Object.keys(TYPE_THEME).map(t => {
                const on = typeSet.has(t)
                return <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${TYPE_THEME[t].color}`, color: TYPE_THEME[t].color, background: on ? TYPE_THEME[t].color : 'transparent' }} onClick={() => setTypeSet(toggle(typeSet, t))}>{TYPE_THEME[t].icon} {t}</span>
              })}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c8c8e8', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyBlocked} onChange={e => setOnlyBlocked(e.target.checked)} /> Only blocked
          </label>
          <button style={{ marginTop: 'auto', padding: '6px 0', borderRadius: 6, border: `1px solid ${BORDER}`, background: HEADER_BG, color: '#888', cursor: 'pointer', fontSize: 11 }} onClick={() => { setQuery(''); setStatusSet(new Set(STATUS_ORDER)); setTypeSet(new Set(Object.keys(TYPE_THEME))); setOnlyBlocked(false) }}>Reset</button>
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
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, cursor: 'pointer' }} onClick={() => sortBy('type')}>Type {arrow('type')}</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, cursor: 'pointer' }} onClick={() => sortBy('status')}>Status {arrow('status')}</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>Owner</th>
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const th = TYPE_THEME[t.type ?? ''] ?? { icon: '?', color: '#888' }
                  return (
                    <tr key={t.file} style={{ cursor: 'pointer' }} onClick={() => setDetail(t)}>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a`, fontFamily: 'monospace', color: '#8a8ab0', fontSize: 11 }}>{String(ticketNum(t.file)).padStart(2, '0')}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a`, fontWeight: 600, color: TEXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid #1e1e3a` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${th.color}1e`, color: th.color, border: `1px solid ${th.color}44`, fontSize: 11 }}>{th.icon} {t.type}</span></td>
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
interface GraphEdge { from: number; to: number; dashed?: boolean; key: string }

function layoutGraph(tickets: ParsedTicket[]) {
  const byNum = new Map(tickets.map(t => [ticketNum(t.file), t]))
  const grid = tickets.filter(t => !t.outOfScope)
  const side = tickets.filter(t => t.outOfScope)
  const depth = new Map<number, number>()
  const visit = (n: number): number => {
    if (depth.has(n)) return depth.get(n)!
    const t = byNum.get(n); if (!t) return 0
    const d = t.blockedBy.filter(b => byNum.has(b) && !byNum.get(b)!.outOfScope).reduce((m, b) => Math.max(m, visit(b)), 0) + 1
    depth.set(n, d); return d
  }
  for (const t of grid) visit(ticketNum(t.file))
  const maxL = Math.max(1, ...grid.map(t => depth.get(ticketNum(t.file))!))
  const layers: ParsedTicket[][] = Array.from({ length: maxL }, () => [])
  for (const t of grid) layers[depth.get(ticketNum(t.file))! - 1].push(t)
  layers[0].sort((a, b) => ticketNum(a.file) - ticketNum(b.file))
  for (let l = 1; l < maxL; l++) {
    const upIdx = new Map<number, number>()
    layers[l - 1].forEach((t, i) => upIdx.set(ticketNum(t.file), i))
    layers[l].sort((a, b) => {
      const ba = a.blockedBy.filter(p => upIdx.has(p)).reduce((s, p) => s + upIdx.get(p)!, 0) / Math.max(1, a.blockedBy.filter(p => upIdx.has(p)).length)
      const bb = b.blockedBy.filter(p => upIdx.has(p)).reduce((s, p) => s + upIdx.get(p)!, 0) / Math.max(1, b.blockedBy.filter(p => upIdx.has(p)).length)
      return ba - bb || ticketNum(a.file) - ticketNum(b.file)
    })
  }
  const maxCount = Math.max(...layers.map(o => o.length), 1)
  const W = Math.max(600, maxCount * STEP_X + 40)
  const pos = new Map<number, Pos>()
  layers.forEach((o, li) => {
    const lw = o.length * STEP_X - 24; const left = (W - lw) / 2
    o.forEach((t, i) => { const x = left + i * STEP_X; pos.set(ticketNum(t.file), { x, cx: x + NODE_W / 2, y: RUNG_TOP + li * RUNG_STEP }) })
  })
  const sidePos = new Map<number, Pos>()
  for (const t of side) {
    const n = ticketNum(t.file); const p = t.blockedBy.find(b => byNum.has(b) && !byNum.get(b)!.outOfScope)
    const pp = p !== undefined ? pos.get(p) : undefined
    if (pp) {
      const parentTier = layers.findIndex(l => l.some(tk => ticketNum(tk.file) === p))
      const sideTier = parentTier + 1; const sideY = RUNG_TOP + sideTier * RUNG_STEP
      const tierTk = layers[sideTier] ?? []
      const rightmost = tierTk.length > 0 ? Math.max(...tierTk.map(tk => pos.get(ticketNum(tk.file))!.x)) : (W - NODE_W) / 2
      sidePos.set(n, { x: rightmost + STEP_X, cx: rightmost + STEP_X + NODE_W / 2, y: sideY })
    } else { sidePos.set(n, { x: W / 2 - NODE_W / 2, cx: W / 2, y: RUNG_TOP }) }
  }
  const childrenOf = new Map<number, number[]>()
  const edges: GraphEdge[] = []
  for (const t of grid) {
    const n = ticketNum(t.file)
    for (const p of t.blockedBy) if (byNum.has(p) && !byNum.get(p)!.outOfScope) {
      const key = `e${p}-${n}`; edges.push({ from: p, to: n, key })
      if (!childrenOf.has(p)) childrenOf.set(p, []); childrenOf.get(p)!.push(n)
    }
  }
  const roots = layers[0].map(t => ticketNum(t.file))
  roots.forEach((r, i) => edges.push({ from: -1, to: r, key: `s${i}` }))
  const leaves = grid.filter(t => (childrenOf.get(ticketNum(t.file)) ?? []).length === 0 && t.resolved).map(t => ticketNum(t.file))
  leaves.forEach((l, i) => edges.push({ from: l, to: -2, key: `l${i}` }))
  for (const t of side) {
    const n = ticketNum(t.file); const p = t.blockedBy.find(b => byNum.has(b))
    if (p !== undefined) edges.push({ from: p, to: n, dashed: true, key: `d${p}-${n}` })
  }
  const endY = RUNG_TOP + (maxL - 1) * RUNG_STEP + END_GAP
  const H = endY + CAP_H / 2 + 40
  return { pos, sidePos, edges, W, H, endY, startCapY: START_Y - CAP_H / 2, endCapY: endY - CAP_H / 2 }
}

function ViewD({ tickets, planDir, scope }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope }) {
  const [sel, setSel] = useState<number | null>(null)
  const L = useMemo(() => layoutGraph(tickets), [tickets])
  const { pos, sidePos, edges, W, H, startCapY, endCapY, endY } = L
  const focus = tickets.find(t => ticketNum(t.file) === sel) ?? null
  const conn = (n: number) => {
    const keys = new Set<string>()
    for (const e of edges) { if (e.from === n || e.to === n) keys.add(e.key) }
    return keys
  }
  const mk = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Relation</span>
        <span style={{ fontSize: 12, color: '#888' }}>{tickets.length} tickets · click node to highlight edges</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', cursor: 'default' }} onClick={() => setSel(null)}>
        <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }}>
          <div style={{ position: 'absolute', left: W / 2 - CAP_W / 2, top: startCapY, display: 'flex', alignItems: 'center', justifyContent: 'center', width: CAP_W, height: CAP_H, borderRadius: 999, background: CARD, border: `2px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: TEXT, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }}>Start</div>
          {[...pos.entries()].map(([n, p]) => {
            const t = tickets.find(x => ticketNum(x.file) === n)!
            return (
              <div key={n} style={{ position: 'absolute', display: 'flex', background: CARD, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', zIndex: 3, boxShadow: sel === n ? '0 4px 20px rgba(0,0,0,.5), 0 0 0 2px #fff3' : '0 3px 12px rgba(0,0,0,.3)', border: `1px solid ${BORDER}`, width: NODE_W, height: NODE_H, left: p.x, top: p.y }} onClick={e => { e.stopPropagation(); setSel(n) }}>
                <span style={{ width: 4, flexShrink: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10, background: DOT[displayStatus(t)] }} />
                <div style={{ padding: '7px 8px 7px 8px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', background: '#1e1e3a', borderRadius: 999, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{String(n).padStart(2, '0')}</span>
                    <span style={{ fontSize: 12 }}>{TYPE_THEME[t.type ?? '']?.icon ?? '?'}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: '#8a8ab0', display: 'flex', gap: 6 }}>{STATUS_LABELS[displayStatus(t)]}{t.claimedBy && <> 👤 {t.claimedBy}</>}</div>
                </div>
              </div>
            )
          })}
          {[...sidePos.entries()].map(([n, p]) => {
            const t = tickets.find(x => ticketNum(x.file) === n)!
            return (
              <div key={n} style={{ position: 'absolute', display: 'flex', background: CARD_DARK, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', zIndex: 3, boxShadow: '0 2px 8px rgba(0,0,0,.3)', border: '2px dashed #383860', width: NODE_W, height: NODE_H, left: p.x, top: p.y }} onClick={e => { e.stopPropagation(); setSel(n) }}>
                <span style={{ width: 4, flexShrink: 0, background: '#383860' }} />
                <div style={{ padding: '7px 8px 7px 8px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', background: '#1e1e3a', borderRadius: 999, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{String(n).padStart(2, '0')}</span>
                    <span style={{ fontSize: 12 }}>⛔</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: '#8a8ab0' }}>ruled out</div>
                </div>
              </div>
            )
          })}
          <div style={{ position: 'absolute', left: W / 2 - CAP_W / 2, top: endCapY, display: 'flex', alignItems: 'center', justifyContent: 'center', width: CAP_W, height: CAP_H, borderRadius: 999, background: CARD, border: `2px solid ${BORDER}`, fontSize: 12, fontWeight: 800, color: TEXT, boxShadow: '0 2px 10px rgba(0,0,0,.4)' }}>End</div>
          <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 1 }}>
            <defs>
              <marker id="da" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#666688" /></marker>
              <marker id="da2" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={TEXT} /></marker>
            </defs>
            {edges.map(e => {
              const aPos = e.from === -1 ? { cx: W / 2, y: startCapY } : pos.get(e.from)
              const bPos = e.to === -2 ? { cx: W / 2, y: endY } : (pos.get(e.to) ?? sidePos.get(e.to))
              if (!aPos || !bPos) return null
              const connected = sel === null || conn(sel).has(e.key)
              const sx = aPos.cx, sy = e.from === -1 ? startCapY + CAP_H : aPos.y + NODE_H
              const ex = e.to === -2 ? W / 2 : bPos.cx
              const ey = e.to === -2 ? endY : (e.dashed ? bPos.y : bPos.y + NODE_H / 2)
              const sw = e.dashed ? 1.4 : connected ? 3 : 1.6
              const sc = e.dashed ? '#888' : connected ? TEXT : '#666688'
              return <path key={e.key} d={mk(sx, sy, ex, ey)} fill="none" stroke={sc} strokeWidth={sw} strokeDasharray={e.dashed ? '5 4' : undefined} opacity={sel !== null && !connected ? 0.5 : 1} markerEnd={connected && !e.dashed ? 'url(#da2)' : e.dashed ? undefined : 'url(#da)'} style={{ transition: 'stroke-width .18s, opacity .18s' }} />
            })}
          </svg>
        </div>
      </div>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} onClose={() => setSel(null)} />}
    </div>
  )
}

// ─── Main PlanView ───────────────────────────────────────────────────────────

export function PlanView(props: { ctx: any; store: any; scope: any; tab: any; visible: boolean }) {
  const { scope } = props as { scope: SessionScope; tab: any; visible: boolean }
  const [mapRaw, setMapRaw] = useState<string | null>(null)
  const [tickets, setTickets] = useState<ParsedTicket[]>([])
  const [effortDir, setEffortDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [variant, setVariant] = useState<'A' | 'C' | 'D'>('A')
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const dir = scope.cwd ? `${scope.cwd}/.plan` : '.plan'
    try {
      const r = await loadPlan(scope, dir)
      if (!r) { setError('empty'); setLoading(false); return }
      setMapRaw(r.mapRaw); setTickets(r.tickets); setEffortDir(r.effortDir)
    } catch { setError('failed') } finally { setLoading(false) }
  }, [scope.sessionId, scope.cwd])
  useEffect(() => { void load() }, [load])
  const destination = useMemo(() => { if (!mapRaw) return null; const m = mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/); return m?.[1]?.trim().split('\n')[0]?.trim() ?? null }, [mapRaw])
  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, color: '#888' }}>Loading…</div>
  if (error) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, color: '#888' }}>No .plan found in current directory.</div>
  const toggleBtn = (active: boolean): React.CSSProperties => ({ flex: 1, padding: '6px 0', border: 'none', borderRadius: 6, cursor: 'pointer', background: active ? HEADER_BG : 'transparent', color: active ? TEXT : '#888', fontSize: 12 })
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: BG, color: TEXT, fontFamily: 'sans-serif', fontSize: 14 }}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 8px', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>
        <button type="button" style={toggleBtn(variant === 'A')} onClick={() => setVariant('A')}>📋 Kanban</button>
        <button type="button" style={toggleBtn(variant === 'D')} onClick={() => setVariant('D')}>📊 Relation</button>
        <button type="button" style={toggleBtn(variant === 'C')} onClick={() => setVariant('C')}> Table</button>
      </div>
      {variant === 'A' && <ViewA tickets={tickets} planDir={effortDir} scope={scope} destination={destination} />}
      {variant === 'D' && <ViewD tickets={tickets} planDir={effortDir} scope={scope} />}
      {variant === 'C' && <ViewC tickets={tickets} planDir={effortDir} scope={scope} />}
    </div>
  )
}
