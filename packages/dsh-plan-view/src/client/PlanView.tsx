/**
 * Plan view v2: reads the governance roots (.scratch/ — all efforts, tracker
 * layout + .plan/ — global only: approval/ & global qa/ledger, never an
 * effort), derives ticket status per the TRACKER-MARKDOWN
 * contract, and renders the tabbed surface:
 *   总览 · 地图（Kanban / Table / Relation DAG ＋ map/spec/原型 正文子页）·
 *   待拍板 · 台账 · 缺陷 · 测例 · ADR · CONTEXT · 说明（2026-09-30 读取契约
 *   拍版；2026-10-04 拍板补待拍板并按 effort 子页序对齐两层顺序）
 *
 * All views share a unified dark theme and markdown-rendered detail panels.
 * Self-contained: uses its own api module, inline styles, zero CSS deps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  snapshot, bindTicket, sessionAlive, sessionList, prototypeUrl,
  type SessionScope, type SessionSummary, type Snapshot,
} from './api'
import { deliverDraft, isBridged } from './input-bridge'
import { fileAddress, displayPath, sameAssetRef } from './file-path'

// ─── Types ──────────────────────────────────────────────────────────────────

type TicketStatus = 'done' | 'out_of_scope' | 'claimed' | 'open'

interface ParsedTicket {
  id: string; file: string; title: string; type: string | undefined
  blockedBy: string[]; done: boolean; outOfScope: boolean; claimedBy: string | undefined
  assets: string[]           // frontmatter `assets: [path]` — 推演产物链接（三视图归组，票 21）
  // `status` / `blockedByRaw` come from the **body** since 2026-10-02 (plan-protocol
  // Q10=乙: 状态写正文行). Frontmatter still carries `type`; a legacy frontmatter
  // `status:`/`blocked_by:` is still read as a fallback so pre-migration docs render.
  status: string | undefined  // body `**Status:**` (fallback: frontmatter `status`)
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

/** Read a `**Label:** value` line from the document body (2026-10-02 carrier move).
 *  Fence-aware: a ticket quoting the format must not thereby declare a status.
 *  Returns undefined when the line is absent, so callers can fall back to
 *  frontmatter for documents written before the migration. */
function bodyField(body: string, label: string): string | undefined {
  const re = new RegExp(`^\\s*(?:[-*>]\\s*)?\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, 'im')
  for (const seg of stripFences(body).split(/\n\s*\n/)) {
    const m = seg.match(re)
    if (m?.[1] !== undefined) return m[1].replace(/[*`]/g, '').trim()
  }
  return undefined
}

function deriveTicketStatus(file: string, raw: string): ParsedTicket {
  const { fm, body } = parseFrontmatter(raw)
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const t: ParsedTicket = {
    id: ticketId(file),
    file, title: titleMatch?.[1]?.replace(/`[^`]*`/g, '')?.trim() ?? file,
    type: fm.type,
    blockedBy: parseBlockedBy(bodyField(body, 'Blocked by') ?? fm.blocked_by),
    assets: parseAssetRefs(fm.assets),
    done: false, outOfScope: false, claimedBy: fm.claimed_by,
    status: bodyField(body, 'Status') ?? fm.status, date: fm.date, origin: fm.origin,
    session: fm.session, originSession: fm['origin_session'], body,
    qaCases: fm.qa_cases === 'true', qaTested: fm.qa_tested === 'true', qaAccepted: fm.qa_accepted === 'true',
  }
  // done/outOfScope 唯一真相源 = displayStatus（下方派生函数，含正文 **Status:**
  // 行路径）。两份判据漂移过两次：进度条/布局读 t.done、状态徽标读 displayStatus，
  // 同一张票能同时显示「✅ 收口」和「0%」——2026-10-02 qa-skill-merge 首次实测
  // （当时修法是都走 hasSection）；2026-10-03 novel outline-prototype-consolidation
  // 二次复发：10-02 载体迁移给 displayStatus 加了第三条 done 路径（正文 Status 行）
  // 而 t.done 没跟上，11 张 to-tickets 执行票（无 Answer 节）10 张 resolved，
  // Kanban 头部仍 0%。故不再各写一份判据，构造完直接取 displayStatus 的结论。
  const st = displayStatus(t)
  t.done = st === 'done'
  t.outOfScope = st === 'out_of_scope'
  return t
}

// ─── 票态推导（唯一真相源 = plan-protocol §三「票面 status 词表」）──────────────
//
// 协议只定义**一种**票态载体（2026-10-02 用户拍板：去掉 frontmatter 兼容识别，
// 统一按标准协议）：status 写正文 `**Status:**` 行，收口节派生并行、优先读——
//   `## Answer` 带正文 = done；`## Ruled out` 带正文 = out_of_scope；
//   claimed_by 在位 = claimed；无收口节时按正文行值取态（见 displayStatus）。
// 格式契约正本 = wayfinder `TRACKER-MARKDOWN.md`（推演票原文：「A ticket's
// status is not among them — … derived rather than stored」——不设 status 字段，
// 收口写进票面正文；字段会是正文的第二次抄写，两处必然各自过期、互相说谎）。
//
// 本次删除的旧兼容层：DONE_STATUS/OUT_STATUS/CLAIMED_STATUS 三张宽容词表
// （done/closed/complete/shipped/abandoned/wontfix/doing/wip…）。它们是为
// 「非 wayfinder 仓写 frontmatter status」那一代数据加的别名映射，与协议冲突：
// 同一张票在词表里可以是 done、在正文里却没有任何收束节，读出来的是两种事实。
//
// ⚠️ 注意 `statusWord` 保留——它服务于 **approval 的独立词表**（pending/closed/
// superseded-by/active/abandoned），那套词表协议明确规定「不得与票态统一」（四套
// 状态机互不套用）。删掉的只是「票」这一坐标系里的别名映射。

// 剥掉围栏代码块内容（wayfinder 明文：「Every scan for structure — headings,
// titles, bullets, links — ignores whatever sits inside a fenced code block」）。
// 一张讨论票格式的票会在正文里**引用** `## Answer` 这一行；不剥围栏就会让那张票
// 自己把自己判成 done——本仓正是「关于协议的地图」，这是最可能踩的一票。
// 围栏内每个字符替换成空行，保留行数（对外层无影响，只为让区间计算不串位）。
function stripFences(body: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(```+|~~~+)/)
    if (fence === null) {
      if (m) { fence = m[1][0] ?? '`'; out.push('') } // 开围栏：连同标记行一起吞掉
      else out.push(line)
    } else {
      if (m && m[1][0] === fence) fence = null // 闭围栏
      out.push('')
    }
  }
  return out.join('\n')
}

// 收束节判据（wayfinder 格式契约正本逐条对应）：
//   ① 节标题须存在且带**正文**——「It is the prose, not the heading, that closes
//      the ticket.」；只有 `## Answer` 一行 = 没结论，票不算收口。
//   ② 结构扫描忽略围栏内容——「A ticket that quotes the ticket format in its
//      Question contains the line `## Answer`, and must not thereby resolve itself.」
//   ③ 单向豁免——「a closing section whose entire body is a code fence is still
//      written, and still closes the ticket」。
// 三者合一：在**剥围栏后**的正文上找节与正文；找不到时回头看是不是「整节即围栏」
// （③ 的合法收口），用原文该节区间里有没有围栏标记判定。
function hasSection(body: string, name: string): boolean {
  const heading = `## ${name}`
  const re = new RegExp(`^${heading}\\b`, 'm')
  const segOf = (text: string): string | null => {
    const m = re.exec(text)
    if (!m || m.index === undefined) return null
    const after = text.slice(m.index + m[0].length)
    const stop = after.search(/^## /m)
    return stop >= 0 ? after.slice(0, stop) : after
  }
  // ② 主判据：剥围栏后，节内仍有非空行。
  const stripped = stripFences(body)
  const seg = segOf(stripped)
  if (seg !== null && /\n\S/.test(seg)) return true
  // ③ 豁免：原文该节内整块是围栏 → 仍算写过。仅在「剥后找不到该节」时适用，
  //    以免把「引用格式的票」误判收口（那类票的 `## Answer` 本身就在围栏里）。
  const rawSeg = segOf(body)
  if (seg !== null && rawSeg !== null && /^\s*\n\s*(```|~~~)/.test(rawSeg)) return true
  return false
}

// 取 frontmatter `status:` 的首词。**只服务非票词表**——approval（pending/closed/
// superseded-by/active/abandoned）与 ADR 状态，它们的词表由各自协议定义，和票态
// 分属不同坐标系、不得互相套用。票态一律走上面的 displayStatus。
// 一个 status 串可能带附注（`done # 2026-09-12 交付`）或 `superseded-by:<path>`，
// 故只比首词。
function statusWord(t: ParsedTicket): string {
  // `t.status` is already body-first (fallback frontmatter) — see deriveTicketStatus.
  const raw = (t.status ?? '').trim().toLowerCase()
  if (raw.startsWith('superseded-by')) return 'superseded'
  return raw.split(/[\s(#:—-]/)[0] ?? ''
}

function displayStatus(t: ParsedTicket): TicketStatus {
  // Closure is read FIRST, so a `Status:` line (or a stale `claimed_by`) on a
  // closed ticket is inert litter — it can never hold the frontier. Never let a
  // ticket's own `**Status:** resolved` outrank an absent closing section: the
  // closing section IS the act of closing (plan-protocol / TRACKER-MARKDOWN).
  if (hasSection(t.body, 'Answer')) return 'done'
  if (hasSection(t.body, 'Ruled out')) return 'out_of_scope'
  // The body `**Status:**` line is the carrier since 2026-10-02. `resolved` is
  // only reachable without a closing section when a document says so while
  // carrying neither — treat that as done, since the writer's intent is explicit.
  const w = (t.status ?? '').trim().toLowerCase().split(/[\s(#:—-]/)[0]
  if (w === 'resolved' || w === 'done' || w === 'closed') return 'done'
  if (w === 'claimed' || t.claimedBy) return 'claimed'
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

// 工单排序（2026-10-03 用户需求：展示按文件名前面数字序号）。此前票序 = 服务端
// fs 枚举序，APFS/Ext4 上都不是字母序——Kanban 列内卡片实为目录随机序。
// 序号形状与 shortId 徽标同款（字母前缀+数字），键 = (字母前缀, 数字值, 文件名)：
// 数字按值比（`2` < `10`），纯数字票（前缀空）最先，无数字票垫底按文件名兜底。
function ticketSeqKey(t: ParsedTicket): [string, number, string] {
  const m = t.id.match(/^([A-Za-z]*)(\d+)/)
  return [m?.[1] ?? '', m ? parseInt(m[2], 10) : Number.MAX_SAFE_INTEGER, t.id]
}
function compareTicketSeq(a: ParsedTicket, b: ParsedTicket): number {
  const ka = ticketSeqKey(a), kb = ticketSeqKey(b)
  return ka[0].localeCompare(kb[0]) || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0)
}

// `blocked_by` is written several ways across repos: `[02]`, `["W3-大纲版本化"]`,
// `["R2"]`, even `["../state-machine/改造工单/R12-….md"]`. Normalise each entry to
// the same space as ticketId so the dependency graph can actually resolve them.
function normalizeRef(raw: string): string {
  const s = raw.trim().replace(/^["']|["']$/g, '').split('/').pop() ?? ''
  return ticketId(s)
}

function parseBlockedBy(value: string | undefined): string[] {
  // `**Blocked by:** None — can start immediately` is the prose form for "no
  // blockers" (to-tickets §5). Only that exact leading word counts as empty —
  // a title fragment like "Nonexistent ticket" must not be swallowed.
  const v = (value ?? '').trim()
  // "None" alone, or the full prose form — but never a word merely starting with it.
  if (/^none\b/i.test(v) && !/^none[a-z]/i.test(v)) return []
  return v.replace(/[\[\]]/g, '').split(',').map(normalizeRef).filter(Boolean)
}

// 票面 `assets:` 字段（TRACKER-MARKDOWN:41 可选 `[<repo-relative path>]`）：
// 官方获取契约 = 资产存仓、经此字段链接、不贴进正文。解析**保留路径原形**
//（与 blocked_by 的票 id 归一不同——资产是文件路径不是票 id），匹配交给
// file-path 的 sameAssetRef（票 21 三视图归组）。
function parseAssetRefs(value: string | undefined): string[] {
  return (value ?? '').replace(/[\[\]]/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
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
// 「锁死/够不到」标识色（2026-10-02 用户需求①：深黄色）。刻意区别于警示用的
// 橙黄 #f7ad31（在途/待拍板）——深黄读作「此路不通」，橙黄读作「注意」。
const LOCKED = '#b8860b'      // darkgoldenrod — 无法达到的上限
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
/* 表格宽度（2026-10-02 用户反馈：最小格宽 + 横向滚动）：
   width:max-content 让表按内容定宽、不再被压缩；min-width:100% 让窄表仍铺满容器
   （缺它则短表缩成一小坨，右栏留白突兀）。两者缺一不可——只有 min-width 到格子
   上时表格依旧会压缩以适配容器，永远不溢出、也就永远不出现横向滚动。
   th/td 的 min-width 是「最小格宽」本体：列窄到这个下限即止，不再压缩到只剩表头
   文字宽（旧样式下短列被压到 45px，读作挤压变形）。td 的 max-width + break-word
   给超长单元格封顶并允许折行，避免单列无限伸长把表推成一条长带。

   下限取 150px（2026-10-05 用户反馈：两列表格的两列都被压到两三个字、完全
   不可读）。12.5px 字号下 1 汉字约 12.5px 宽，150px 扣掉左右各 10px 内边距
   ≈ 10 个汉字一行——即「至少 10 个字宽」的换算结果。压过这条线就读不出内容，
   宁可让宽表在 .pvm-tw 里横向滚动。 */
.pvm-table{border-collapse:collapse;width:max-content;min-width:100%;font-size:12.5px}
.pvm-table th{background:${RAISED};color:${TEXT};font-weight:700;text-align:left;padding:7px 10px;border-bottom:1px solid ${BORDER};white-space:nowrap;min-width:150px}
.pvm-table td{padding:7px 10px;border-bottom:1px solid ${BORDER_LIGHT};color:${TEXT_DIM};vertical-align:top;min-width:150px;max-width:320px;word-break:break-word}
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
const DOT: Record<string, string> = { open: '#81858c', claimed: '#f7ad31', done: '#4ed17e', out_of_scope: '#61666b' }
const STATUS_LABELS: Record<TicketStatus, string> = { open: 'Open', claimed: 'Claimed', done: 'Resolved', out_of_scope: 'Out of scope' }
const STATUS_ORDER: TicketStatus[] = ['open', 'claimed', 'done', 'out_of_scope']

// ─── 票面路径（2026-09-29 拍板）：头部显示 + 点击打开 ──────────────────────────
//
// 视图里的每一张票都来自一个真实文件，但页面此前只显示文件名——同一个 `01.md`
// 可能属于三张图，读的人无法判断手里这张是哪个。头部补一行路径解决两件事：
// ①**同一性**（这是哪个文件）；②**可达性**（点一下就打开它）。
//
// 打开走官方右栏协议 `sidebarRight.openResource`：与聊天里点 `@文件`、文件树
// 点开是同一条通道，内容留在产品内、与会话并排；`openResource` 自带展开语义
// （服务契约：「用户看不见的内容不算打开」），收起态点击也生效。
//
// 路径取自 `ParsedTicket.path`——它是 fs 树读到的真实绝对路径，所以相对化后
// 天然与仓库当前布局一致（`.scratch/<effort>/issues/14-x.md`）。拿不到 path 的
// 调用方（历史轮快照以外无此情形）退回文件名，仍可点开。

/**
 * 在右栏打开一个治理目录下的文件。
 * @param ctx - 客户端根上下文（需注入 `sidebarRight`）。
 * @param scope - 当前会话作用域：地址按会话解析路径。
 * @param path - 文件的绝对路径；缺省时退回文件名（服务端按会话 cwd 解析）。
 * @returns 是否已发起打开（服务缺失时 false，调用方据此提示）。
 */
function openFileInSidebar(ctx: any, scope: SessionScope, path: string | undefined, fallbackName: string): boolean {
  try {
    const sidebar = ctx?.get?.('sidebarRight') as { openResource?: (address: string) => void } | undefined
    if (sidebar?.openResource === undefined) return false
    sidebar.openResource(fileAddress(scope.sessionId, path ?? fallbackName))
    return true
  } catch {
    // 无会话面挂载等宿主异常：返回 false，由 chip 的 title 提示点击无效。
    return false
  }
}

/**
 * 票面的文件路径行：一行等宽小字，点击在右栏打开该文件。
 *
 * 显示的是**相对工作区**的路径（`.scratch/doc-authority/issues/05-….md`），仓外
 * 文件显示绝对路径——相对化只为好读。整行是按钮（键盘可达、有 hover 反馈），
 * 并 `stopPropagation`：卡片本身点击是「打开详情弹窗」，两件事不能互相吞掉。
 * @param props.ticket - 该行所属的票（取 `path` / `file`）。
 * @param props.scope - 会话作用域，决定地址解析与相对化基准。
 * @param props.ctx - 客户端根上下文。
 * @param props.size - 字号，默认 10.5；详情弹窗用 11.5。
 * @returns 路径按钮。
 */
function FilePath({ ticket, scope, ctx, size = 10.5 }: { ticket: ParsedTicket; scope: SessionScope; ctx: any; size?: number }) {
  const full = ticket.path
  const shown = full === undefined ? ticket.file : displayPath(full, scope.cwd)
  const open = (e: React.MouseEvent) => {
    e.stopPropagation()
    openFileInSidebar(ctx, scope, full, ticket.file)
  }
  return (
    <button
      type="button"
      onClick={open}
      title={`点击在右栏打开：${full ?? ticket.file}`}
      style={{
        display: 'block', maxWidth: '100%', padding: 0, border: 'none', background: 'transparent',
        textAlign: 'left', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: size, lineHeight: 1.5,
        color: TEXT_FAINT, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = ACCENT_SOFT; e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={e => { e.currentTarget.style.color = TEXT_FAINT; e.currentTarget.style.textDecoration = 'none' }}
    >
      {shown}
    </button>
  )
}

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
//
// `impl` 不再是票型（2026-09-27 用户拍板「不必支持 impl」）——本集合不收录它。
// 存量 15 张 `type: impl` 票（nvwa `.plan/dna-ab-full/`）已于 2026-09-29 按
// 「形态契约变更回扫」条款全部迁移为 `type: task`（plan-lint-gate 票 07），
// 全 workdir 词表外票型清零；此后再遇 `type: impl` 即真漂移，按杂项解析即可。
const TICKET_TYPES = new Set(['task', 'research', 'prototype', 'grilling'])

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

// ─── 推演票型标识（2026-09-29 票 11）────────────────────────────────────────
//
// research / prototype / grilling 属 wayfinder 推演票（HITL/AFK 分工见 wayfinder
// 票型节），ticketKind 把它们归入工单 kind——但四票型同住 issues/、类型只差
// frontmatter 一词，渲染不区分则推演票与执行票不可辨。此表给推演票自己的
// 徽标身份；普通 task 票仍走工单默认。
const SPECULATION_TICKET_META: Record<string, { label: string; icon: string; color: string }> = {
  research: { label: '调研票', icon: '🔍', color: '#b48ef7' },
  prototype: { label: '原型票', icon: '🧩', color: '#ff9f6e' },
  grilling: { label: '拷问票', icon: '🔥', color: '#5ad8cd' },
}

/** Render meta for a ticket: speculation types carry their own badge, others use the kind default. */
function ticketDisplayMeta(t: ParsedTicket): { label: string; icon: string; color: string } {
  const k = ticketKind(t)
  if (k === 'ticket') {
    const m = SPECULATION_TICKET_META[(t.type ?? '').trim().toLowerCase()]
    if (m) return m
  }
  return KIND_META[k]
}

// ─── Map kinds: 推演图 vs 实施图 ─────────────────────────────────────────────
//
// 一个 effort 是推演图（wayfinder：票型 research/grilling/prototype，终点=决策
// 清零）还是实施图（票型 task，终点=落码验收），由票型推导——不需要文档
// 自我声明。两类图工作流不同（推演靠讨论，实施靠派工），展示上分两组。
//
// 注意 `impl` 在本文件有两个身份（均与票型无关），勿与票型混淆：①**内部类型名**
// MapKind='impl'（实施图的分类标识，不应改名）；②**历史目录路径** impl/、impl-fe/
// （见 resolveEfforts 的 workstream 分支，读的是路径不是票型）。
// `type: impl` 已不是票型（2026-09-27 拍板），本文件不再对它作任何识别。
type MapKind = 'speculation' | 'impl'

const SPECULATION_TYPES = new Set(['research', 'grilling', 'prototype'])
const IMPL_TYPES = new Set(['task'])

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

// ─── 图进度（2026-10-02 用户拍板，两条口径变更）─────────────────────────────
//
// ① **四类单据全计**：分母不再只数工单（`ticket`），`approval` / `ledger` /
//    `qa-defect` 一并计入。它们各自答不同的问题（见 plan-protocol「四套状态机
//    互不套用」），故**完成判据按各自坐标系**取，不共用票态词表：
//      - ticket      → displayStatus(t) === 'done'（收口节或正文 **Status:** 行）
//      - approval    → 已结案：不是 pending（closed / superseded-by / abandoned）
//      - ledger      → 已销账：正文 `- 状态:` 为「已销」或「已转票」
//      - qa-defect   → 已关闭：正文 `- 状态:` 为「已关闭」
//    这样「图里还压着一堆待拍板/挂账/缺陷」时进度条不再显示成 100%。
//
// ② **实施图缺测例封顶 80%、有测例缺测试文档封顶 90%**（10% 档 2026-10-03 用户
//    需求追加）：实施图（有 `type: task`）若无 `qa/cases.md`，完成度上限压到
//    80%——测例是实施图的验收前提，没测例的「全做完」不算真收口；有测例但没有
//    执行验收记录（`qa/test.md`），上限压到 90%——测了没记录同样不算收口。
//    取**封顶**而非加权：语义直观（「没测例就别想满分」），且票数为 0 的空图不会
//    因分母加虚拟项而算出诡异小数。

/** 四类单据各自的「已完成」判据（跨坐标系不可共用词表）。 */
function isSettled(t: ParsedTicket, kind: TicketKind): boolean {
  if (kind === 'ticket') return displayStatus(t) === 'done'
  // approval 的终态不等于 done（协议：closed 不可改写为 done，会抹掉 superseded /
  // abandoned 的区分）。故此处判的是「不再 pending」＝已结案。
  if (kind === 'approval') return !isPending(t)
  if (kind === 'ledger') {
    const e = parseLedgerEntries(t.body)[0]
    // `state` 已被 parseLedgerEntries 归一为核心词，直接比对词表。
    return e !== undefined && (e.state === '已销' || e.state === '已转票')
  }
  if (kind === 'defect') {
    const single = parseDefectFile(t)
    if (single !== undefined) return DEFECT_CLOSED.has(defectStateWord(single.state))
    const entries = parseDefectEntries(t.body)
    return entries.length > 0 && entries.every(d => DEFECT_CLOSED.has(defectStateWord(d.state)))
  }
  return false
}

/**
 * spec.md 是否已归档（协议「取代登记」，2026-10-02 用户需求②）。
 * 正本 plan-protocol「spec 生命周期与归宿行」（2026-10-04 E' 拍板：spec 退役
 * 只发生在 effort 归档，票尽不再触发必标）——`superseded-by:` 注记即退役凭据。
 * 注记位置协议限定两种——frontmatter
 * `status: superseded-by:<归宿>`（首选），或**头部 10 行内**引用块。
 * 「埋正文深处不算」（协议明写，doc-authority 复盘实证 23% 可检索率是旧病），
 * 故此处只认这两个位置，不做全文正则——否则一份「提及」别人被取代的 spec
 * 会把自己判成已归档。
 */
export function isSpecArchived(specRaw: string | undefined): boolean {
  if (!specRaw) return false
  const fm = specRaw.match(/^---\n([\s\S]*?)\n---/)
  if (fm && /^\s*status:\s*superseded-by:/m.test(fm[1] ?? '')) return true
  const head = specRaw.split('\n').slice(0, 10).join('\n')
  return /superseded-by/i.test(head)
}

/**
 * 一张图的完成度。返回 `pct` 与锁区两个读数。
 *
 * 口径（2026-10-02 用户拍板，10% 档 2026-10-03 追加，2026-10-04 全局件剔除，
 * 2026-10-05 spec 退出进度）：
 *  - 四类单据全计（ticket/approval/ledger/qa-defect），完成判据各按自己坐标系。
 *  - **全局件（ROOT_GROUP）不计入**（2026-10-04 用户拍板 A 案）：`.plan/` 根层的
 *    全局台账/全局缺陷/根层审批档不属于任何图，协议明文「不参与 effort 判据」。
 *    调用方仍按旧写法传含全局件的集合也无妨——本函数内部统一剔除。
 *    历史误读：2026-10-03 为消除总览卡与 Kanban 的双口径而把 own 改「全量单据
 *    （含根层全局件）」，目的（两处同数）达成但顺带把全局件固定进了分母，导致
 *    图进度被与图无关的全局存量稀释（master-outline-realign 实测 44% → 剔除后
 *    45%，方向可为升可为降：全局件未结案多则压低、已结案多则抬高）。
 *  - **spec.md 不进进度**（2026-10-05 用户拍板，翻转 2026-10-02 的「占一个名额」）：
 *    进度只由票决定，实施图「票全做完」即 100%，spec 归档与否不再影响读数。
 *    被翻转的旧口径：spec.md 曾占一个名额，未归档 ⇒ 分母 +1 且该项未完成，
 *    于是票全做完也永远停在 n/(n+1)（4 票 = 80%）——用户判定「spec 不算在进度里」。
 *    注意与全局件剔除的区别：spec 是**图内文件**，2026-10-04 拍板确认它不受全局件
 *    剔除影响；本次是它自己从进度里退出，两条口径互不派生。
 *    `specCounted`/`specArchived` 仍计算，供卡片那行「📄 spec 未归档」提醒使用——
 *    提醒保留、但与百分比解耦（2026-10-05 用户选择「保留提示、不影响百分比」）。
 *  - 实施图缺 `qa/cases.md` ⇒ 完成度**封顶 80%**；有测例但缺执行验收记录
 *    （`qa/test.md`）⇒ **封顶 90%**。`lockPct`（20/10）标出「够不到的那一段」，
 *    供进度条把右端画成黄色锁区（2026-10-03 用户拍板的展示要求）。
 *
 * `locked` 为 true 表示**存在结构性缺口导致上不去 100%**（缺测例 / 缺测试文档
 * 两种），供卡片在进度右侧显示锁死标识。spec 未归档既不进分母、也不置 locked
 * ——它已完全退出进度坐标系。
 *
 * @param own     该图自有单据 + 根层松散件（与卡片其它计数同口径）
 * @param dir     图目录（判断 qa/cases.md、qa/test.md 与 spec.md 归属）
 * @param cases   全部测例文档（含 effort 归属字段）
 * @param tests   全部执行验收记录（qa/test.md / test-*.md，含 effort 归属字段）
 * @param kind    图型
 * @param specRaw 该图 spec.md 正文；无 spec 传 undefined
 */
export function effortProgress(
  own: ParsedTicket[], dir: string, cases: ParsedTicket[], tests: ParsedTicket[], kind: MapKind | undefined, specRaw: string | undefined,
): { pct: number; locked: boolean; lockPct: number; lockKind: 'cases' | 'test' | undefined; hasCases: boolean; hasTest: boolean; specCounted: boolean; specArchived: boolean } {
  const countable = own.filter(t => {
    // 全局件不进本图分母（2026-10-04 用户拍板 A 案）。ROOT_GROUP 单据住在
    // `.plan/` 根层（全局台账 / 全局缺陷 / 根层审批档），它们**不属于任何图**。
    // 收窄写在本函数内而非调用点：调用点各自拼集合正是本缺陷的成因（同屏的
    // 台账/缺陷子页列表早已按 `!== ROOT_GROUP` 剔除，只有进度条漏了过滤，两处
    // 调用点还把 `=== ROOT_GROUP` 硬编码了两遍）。协议依据=plan-protocol
    // 「全局件」条·判据归属：「全局件目录（approval/ qa/ ledger/）不参与 effort
    // 判据——它们是全局件锚点不是图」＋ 2026-09-25 拍板「全局台账不进地图页」。
    if (t.effort === ROOT_GROUP) return false
    const k = ticketKind(t)
    // note（说明/杂项）不是单据；cases/test 单独作封顶条件、不进分母。
    if (k === 'note' || k === 'cases') return false
    // 出局票从分母剔除（与旧口径一致）：整票判出局 = 这件事不做了，不是没做完。
    if (k === 'ticket' && t.outOfScope) return false
    return true
  })
  const settled = countable.filter(t => isSettled(t, ticketKind(t))).length
  // spec **不进进度**（2026-10-05 用户拍板：spec 不算在进度里）。分子分母同去：
  // 票全做完就是 100%，不再被 spec 归档与否牵住。两个字段仍要算——卡片那行
  // 「📄 spec 未归档」提醒还用它，只是提醒与百分比彻底解耦。
  const specCounted = kind === 'impl' && !!specRaw
  const specArchived = isSpecArchived(specRaw)
  const denom = countable.length
  const numer = settled
  let pct = denom > 0 ? Math.round((numer / denom) * 100) : 0
  const hasCases = cases.some(c => c.effort === dir)
  const hasTest = tests.some(t => t.effort === dir)
  // 锁区两档互斥，取「缺得最深的那个前提」：缺测例时必然也没有测试文档，
  // 但那只是同一缺口更深的一档，锁大的 20 不叠加；有测例缺测试文档锁 10。
  // 仅实施图——推演图没有 qa 通道，终点是决策清零，不参与测例口径。
  const lockPct = kind !== 'impl' ? 0 : hasCases ? (hasTest ? 0 : 10) : 20
  const lockKind = lockPct === 20 ? 'cases' as const : lockPct === 10 ? 'test' as const : undefined
  if (lockPct > 0) pct = Math.min(pct, 100 - lockPct)
  return { pct, locked: lockPct > 0, lockPct, lockKind, hasCases, hasTest, specCounted, specArchived }
}

/** 兼容旧签名：只要百分比读数时用（测试与少量调用点）。 */
export function effortPct(
  own: ParsedTicket[], dir: string, cases: ParsedTicket[], tests: ParsedTicket[], kind: MapKind | undefined, specRaw?: string,
): number {
  return effortProgress(own, dir, cases, tests, kind, specRaw).pct
}

/** 锁区的角标文案与悬停说明（总览卡片条与子页头部条共用，防两处漂移）。 */
function lockCopy(kind: 'cases' | 'test' | undefined): { chip: string; title: string } {
  return kind === 'test'
    ? { chip: '🔒 缺测试文档 10%', title: '已有测例（qa/cases.md）但没有执行验收记录（qa/test.md）：测过没记录不算收口，上限锁在 90%' }
    : { chip: '🔒 缺测例 20%', title: '缺 qa/cases.md：测例是实施图的验收前提，上限锁在 80%，补齐前到不了 100%' }
}

/** effort 全局进度条（2026-10-03 拍板②）：读数 = effortProgress（本图四类单据全计
 *  ＋ spec 名额＋锁区；**不含全局件**，2026-10-04 拍板 A 案），与总览卡同一个数；
 *  工单/待拍板/缺陷/台账四个子页头部共用。
 *  prog 为 undefined（「全部地图」聚合态，无单一 effort）时不渲染。 */
function EffortProgressBar({ prog }: {
  prog: ReturnType<typeof effortProgress>
}) {
  const lockTitle = prog.locked ? lockCopy(prog.lockKind).title : ''
  return (
    <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: CHIP_BG, border: `1px solid ${BORDER}`, overflow: 'hidden', position: 'relative' }}>
        <div style={{ height: '100%', width: `${prog.pct}%`, borderRadius: 3, background: `linear-gradient(90deg, #4ed17e, ${ACCENT})` }} />
        {prog.locked && (
          <div title={lockTitle} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `${prog.lockPct}%`, background: LOCKED, cursor: 'help' }} />
        )}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: prog.locked ? LOCKED : '#4ed17e', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{prog.pct}%</span>
      {prog.locked && (
        <span title={lockTitle} style={{ fontSize: 10.5, fontWeight: 700, color: LOCKED, background: `${LOCKED}1f`, border: `1px solid ${LOCKED}66`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap', cursor: 'help' }}>{lockCopy(prog.lockKind).chip}</span>
      )}
    </div>
  )
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

// 轮次清单（ids）随 snapshot 返回（服务端读 `.archive/rounds` 目录名，新轮在前）；
// 主题仍由客户端从 README 索引表解析（纯文本逻辑留在渲染侧）。
function roundsOf(snap: Snapshot): RoundInfo[] {
  const meta = snap.rounds.readmeRaw !== null ? parseRoundsIndex(snap.rounds.readmeRaw) : new Map<string, RoundInfo>()
  return snap.rounds.ids.map(id => meta.get(id) ?? { id })
}

// ─── Data loading ────────────────────────────────────────────────────────────

// Marks files read from a root's own top level, which belong to no effort.
// （值与 lib/server.js 的 ROOT_GROUP 字面量一致——from/group 跨端同值比较。）
const ROOT_GROUP = '\u0000root'

// ─── Four views, one collection pass ─────────────────────────────────────────
//
// The tab shows the different things that happen to share a directory:
//   工单 (route)     — an effort's tickets: destination and its DAG/Kanban/Table
//                      （2026-10-03 拍板：路线 tab 裁撤更名「工单」——09-30 工单
//                      子页已并入此页，票看板本来就是主体；内部 id 仍 route）
//   待拍板 (approvals) — decisions waiting on the human
//   台账 (ledger)    — standing debts across maps (挂账台账)
//   缺陷 (defects)   — test-found bugs, scoped to one map (缺陷台账)
//   ADR (adr)        — architecture decisions, docs/adr/ 知识层只读展示
// They are collected together, then split by kind, so each view is one filter
// over the same data rather than three loaders that can disagree.

interface PlanData {
  tickets: ParsedTicket[]      // every markdown file found, with its kind resolved
  qaTests: ParsedTicket[]      // qa/test.md（执行验收记录）：不当票（2026-09-20 拍板），只作「测过没」存在性——进度锁 10% 档判据
  adrs: ParsedTicket[]         // docs/adr knowledge layer（ADR 全局页数据源，2026-09-30 拍板）
  assetFiles: ParsedTicket[]   // assets/ 推演产物（票 21 三视图归组数据源，不当票）
  effortDir: string
  mapRaw: string | null
  efforts: { dir: string; mapRaw: string; specRaw?: string; prototypes: { name: string; path: string }[] }[]  // every effort (map.md, or spec.md as a spec-only effort)
}

function classify(t: ParsedTicket): TicketKind { return ticketKind(t) }

/**
 * snapshot（一次请求的全量数据）→ PlanData：契约解析（frontmatter/状态/kind/qa
 * 白名单过滤）留在客户端不动，只把「遍历+读取」换成了服务端一次返回。
 */
function assemblePlanData(snap: Snapshot): PlanData {
  const parsed = snap.files
    .map(f => ({ ...deriveTicketStatus(f.name, f.content), path: f.path, effort: f.from, group: f.group }))
  // ADR/资产先于票面分流（group 'adr'/'assets'）：否则无 type、有 status 的 ADR
  // 会被 ticketKind 兜底计成工单，四处工单计数全部虚高；资产同理且不该当票展示。
  const adrs = parsed.filter(t => t.group === 'adr')
  const assetFiles = parsed.filter(t => t.group === 'assets')
  const tickets = parsed
    .filter(t => t.group !== 'adr' && t.group !== 'assets')
    .filter(t => t.group !== 'qa' || ticketKind(t) === 'defect' || t.file === 'cases.md')
    // effort 首键：聚合态各图编号各自从 01 起，跨图比数字无意义——保持按图分组
    // （与收集序同构：根层票最先），组内按序号升序。Kanban/关系图/表格默认序全继承。
    .sort((a, b) => (a.effort ?? '').localeCompare(b.effort ?? '') || compareTicketSeq(a, b))
  // 执行验收记录在进票面前截走（同 cases.md 的「不当票」拍板，2026-09-20）：
  // 文件名与 cases 契约对称（test.md / test-*.md），只留存在性给进度锁判据。
  const qaTests = parsed.filter(t => t.group === 'qa' && (t.file === 'test.md' || /^test-/.test(t.file)))
  const efforts = snap.efforts.map(e => ({ dir: e.dir, mapRaw: e.mapRaw, specRaw: e.specRaw ?? undefined, prototypes: e.prototypes ?? [] }))
  // The route view's banner shows the first effort that actually has a map body.
  const primary = efforts.find(e => e.mapRaw !== '') ?? efforts[0]
  return { tickets, qaTests, adrs, assetFiles, effortDir: primary?.dir ?? snap.cwd, mapRaw: primary?.mapRaw ?? null, efforts }
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
  `继续推演这张工单：${t.path ?? t.file}\n\n先读票面原文与它引用的文档，然后继续未决项的推演；需要人拍板的结论，用 to-approval 落成待拍板文档——调用时传本图 effort slug（${effortSlugOf(t)}）作落点参数，档落该图 approval/ 并带 effort: 声明（2026-09-30 拍板 A：默认 effort，全局必须显式）。`
// effort slug：票所属目录名；根层松散票无 effort → 提示问归属（不推断全局）。
const effortSlugOf = (t: ParsedTicket): string =>
  t.effort && t.effort !== ROOT_GROUP ? t.effort.split('/').pop() ?? '' : '（本票无图归属，请先向用户确认落点 effort 或 global）'
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
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [rebind, setRebind] = useState(false) // E1: bound session died — offering recreate
  // 完整正文就在 ticket.body（snapshot 一次带回的原文去 frontmatter）——
  // 此前这里每次打开还发一次 fsRead 重读同一文件，纯浪费。
  const fullBody = ticket.body
  // Close on Escape, and lock the background from scrolling while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * 触发宿主会话切换（`sessions.open`）。实测宿主 select→通知→渲染链可能同步
   * 挂死，因此绝不留在 await 链上：宏任务里调用、吞掉一切异常，调用即视为已触发。
   */
  const openSessionDetached = (sessionId: string): boolean => {
    const open = sessionsOf(ctx)?.open
    if (open === undefined) return false
    setTimeout(() => {
      try {
        const r = open(sessionId) as unknown
        if (r !== undefined && r !== null && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {})
      } catch { /* 未知 id 等宿主异常：留给就绪轮询与看门狗兜底 */ }
    }, 0)
    return true
  }
  /**
   * 把指令草稿送进目标会话的输入框。目标会话正开着就立即（宏任务）填；否则经
   * 输入桥挂交接草稿、触发切换，并等输入区重挂消费掉草稿。每一步都即时反馈，
   * 看门狗保证 UI 永不卡在 busy 态，指令最终兜底进剪贴板——绝不静默丢失。
   */
  const deliverPrompt = async (sessionId: string | undefined, text: string, okMsg: string) => {
    if (sessionId === undefined) { setMsg(await copyFallback(text)); return }
    if (deliverDraft(sessionId, text) === 'injected') { setMsg(okMsg); return }
    if (!openSessionDetached(sessionId)) {
      setMsg(`已选好 session ${shortSession(sessionId)}，但此环境无法切换会话。${await copyFallback(text)}`)
      return
    }
    setMsg(`正在切到 session ${shortSession(sessionId)}…`)
    // 输入区重挂后输入桥才会消费交接草稿；就绪即报成功，超时也把现状说清。
    const deadline = Date.now() + 10000
    while (!isBridged(sessionId) && Date.now() < deadline) await new Promise(r => setTimeout(r, 200))
    if (isBridged(sessionId)) setMsg(okMsg)
    else setMsg(`已触发切到 session ${shortSession(sessionId)}；指令会在输入区就绪时自动填入，若一直没出现：${await copyFallback(text)}`)
  }
  /** 动作总看门狗：任何环节挂死（含宿主内部），15 秒后强制恢复 UI 并把指令兜底进剪贴板。 */
  const withWatchdog = async (key: string, work: () => Promise<void>, fallbackText?: () => string) => {
    setMsg(null); setBusy(key)
    let finished = false
    const watchdog = new Promise<void>(resolve => setTimeout(() => {
      if (finished) return
      setBusy(null)
      void (fallbackText !== undefined ? copyFallback(fallbackText()) : Promise.resolve('')).then(
        extra => setMsg(`操作超时（宿主无响应）。${extra}`),
      )
    }, 15000))
    await Promise.race([work.then(() => { finished = true }), watchdog])
    if (finished) setBusy(null)
  }
  /** Pure jump with the E1 liveness check. */
  const jump = async (sessionId: string) => {
    setMsg(null); setBusy('jump')
    try {
      const live = await sessionAlive(sessionId)
      if (live === undefined) { setMsg('该 session 已不可用（可能已被回收）。'); return }
      if (!openSessionDetached(sessionId)) { setMsg('此环境没有跳转能力（sessions 服务不可用）。'); return }
      setMsg(`正在切到 session ${shortSession(sessionId)}…`)
    } catch (e) { setMsg(`跳转失败：${(e as Error).message}`) }
    finally { setBusy(null) }
  }
  /** New session via the client runtime, write the B1 binding, prefill, jump. */
  const createAndBind = async (promptText: string) => {
    await withWatchdog('create', async () => {
      const sessions = sessionsOf(ctx)
      if (sessions?.create === undefined) {
        setMsg(`此环境没有会话创建能力（sessions 服务不可用）。${await copyFallback(promptText)}`)
        return
      }
      const sessionId = await sessions.create(scope.cwd === undefined ? {} : { cwd: scope.cwd })
      const target = ticket.path ?? `${planDir}/tickets/${ticket.file}`
      // B1 绑定：服务端 read-modify-write 原子 upsert（客户端不再读原文）。
      await bindTicket(scope.sessionId, target, 'session', sessionId)
      renameSession(sessions, sessionId, `#${shortId(ticket)} ${ticket.title}`.slice(0, 60))
      // 绑定已落盘，先刷新数据（票面 chip 立即可见），再做可能挂死的投递段。
      onChanged()
      await deliverPrompt(sessionId, promptText, `已在新 session ${shortSession(sessionId)} 预填指令（草稿，确认后发送），绑定已写回票面。`)
    }, () => promptText)
  }
  /** ①/② draft-first dispatch on a ticket: refill the bound session, else create one. */
  const dispatchTicket = async (mode: 'explore' | 'advance') => {
    const promptText = mode === 'explore' ? EXPLORE_PROMPT(ticket) : ADVANCE_PROMPT(ticket)
    if (ticket.session === undefined) { await createAndBind(promptText); return }
    await withWatchdog(mode, async () => {
      setRebind(false)
      let live: SessionSummary | undefined
      try {
        live = await sessionAlive(ticket.session!)
      } catch { live = undefined }
      if (live === undefined) { setRebind(true); setMsg('绑定的 session 已不可用。可新建 session 并重新绑定。'); return }
      await deliverPrompt(ticket.session!, promptText, `指令已填进 session ${shortSession(ticket.session!)} 的输入框，确认后发送。`)
    }, () => promptText)
  }
  /** ③ 拍板: prefill `/plan-approve <doc>` in the session the user is looking at. */
  const settle = async () => {
    const line = `/plan-approve ${ticket.file}`
    await withWatchdog('settle', async () => {
      await deliverPrompt(scope.sessionId, line, '已把 /plan-approve 预填进当前会话输入框，确认后发送。')
      onChanged()
    }, () => line)
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
        {/* 路径独占标题下一行：标题长短不一时路径起点仍对齐，扫读时是同一列。 */}
        <div style={{ padding: '2px 20px 0' }}>
          <FilePath ticket={ticket} scope={scope} ctx={ctx} size={11.5} />
        </div>
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, borderBottom: `1px solid ${BORDER_LIGHT}` }}>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: CHIP_BG, color: '#888', border: `1px solid ${BORDER}` }}>#{shortId(ticket)}</span>
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, background: `${ticketDisplayMeta(ticket).color}22`, color: ticketDisplayMeta(ticket).color }}>{ticketDisplayMeta(ticket).icon} {ticketDisplayMeta(ticket).label}</span>
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

function ViewA({ tickets, planDir, scope, ctx, sessions, onChanged, destination, readOnly, prog }: { tickets: ParsedTicket[]; planDir: string; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; destination: string | null; readOnly?: boolean; prog?: ReturnType<typeof effortProgress> }) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  const groups = useMemo(() => {
    const g: Record<TicketStatus, ParsedTicket[]> = { done: [], out_of_scope: [], claimed: [], open: [] }
    for (const t of tickets) g[displayStatus(t)].push(t)
    return g
  }, [tickets])
  // Decisions blocked on the human, oldest first — the ones that get forgotten.
  const waiting = useMemo(
    () => tickets.filter(isPending).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)),
    [tickets],
  )
  const active = tickets.filter(t => !t.outOfScope)
  const done = tickets.filter(t => t.done).length
  // 头部进度条（2026-10-03 拍板②＋用户反馈定位置）：effort 全局条渲染在子页签行
  // 下方（地图 tab 公共位置），本组件不再渲染单图态条（prog 有值即全局条已在）；
  // 此处只留「全部地图」聚合态 fallback——纯工单 done/active 口径，无锁。
  const aggPct = active.length > 0 ? Math.round((done / active.length) * 100) : 0
  // minHeight:0：Kanban 列体（下方 overflowY:auto）要在受限高度里才能滚，
  // 列方向 flex 的自动最小高度会把本根撑到内容高、被上层裁掉（同根节点）。
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: BG, color: TEXT }}>
      <div style={{ padding: '12px 16px 0', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Kanban</span>
        <span style={{ fontSize: 12, color: '#888' }}>{tickets.length} tickets · {done} done</span>
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
      {/* 「全部地图」聚合态 fallback（单图态全局条在子页签行下，见地图 tab）。 */}
      {prog === undefined && (
        <div style={{ margin: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: CHIP_BG, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${aggPct}%`, borderRadius: 3, background: `linear-gradient(90deg, #4ed17e, ${ACCENT})` }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#4ed17e', minWidth: 36, textAlign: 'right' }}>{aggPct}%</span>
        </div>
      )}
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
                    <span style={{ fontSize: 12 }}>{ticketDisplayMeta(t).icon}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  </div>
                  <FilePath ticket={t} scope={scope} ctx={ctx} />
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999, background: `${ticketDisplayMeta(t).color}22`, color: ticketDisplayMeta(t).color }}>{ticketDisplayMeta(t).icon} {ticketDisplayMeta(t).label}</span>
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
  // carrying any type value outside the current vocabulary (a historical sweep
  // mid-flight) must not start with every row filtered out.
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
  // minHeight:0 同 ViewA：表格体（下方 overflow:hidden 内 overflowY:auto）靠受限高度才滚。
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: BG, color: TEXT }}>
      <div style={{ padding: '10px 16px', background: HEADER_BG, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Table</span>
        <span style={{ fontSize: 12, color: '#888' }}>
          {rows.length}/{tickets.length} tickets
          {statusSet.size < STATUS_ORDER.length && <span style={{ color: '#666' }}>（默认隐藏已完成；勾 Status 里的 Done 可看）</span>}
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
                  <th style={{ textAlign: 'left', padding: '7px 10px', fontSize: 10, fontWeight: 700, color: '#777', textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG }}>Path</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const th = typeTheme(t.type)
                  return (
                    <tr key={t.file} style={{ cursor: 'pointer' }} onClick={() => setDetail(t)}>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, fontFamily: 'monospace', color: TEXT_FAINT, fontSize: 11 }}>{shortId(t)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, fontWeight: 600, color: TEXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${ticketDisplayMeta(t).color}1e`, color: ticketDisplayMeta(t).color, border: `1px solid ${ticketDisplayMeta(t).color}44`, fontSize: 11 }}>{ticketDisplayMeta(t).icon} {ticketDisplayMeta(t).label}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}` }}><span style={{ padding: '1px 6px', borderRadius: 999, background: `${th.color}1e`, color: th.color, border: `1px solid ${th.color}44`, fontSize: 11 }}>{th.icon} {t.type ?? '（无 type）'}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}` }}><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[displayStatus(t)] }} />{STATUS_LABELS[displayStatus(t)]}</span></td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, color: t.claimedBy ? '#f7ad31' : TEXT_FAINT }}>{t.claimedBy ?? '—'}</td>
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, color: t.blockedBy.length > 0 ? '#f2555a' : TEXT_FAINT, fontFamily: 'monospace', fontSize: 11 }}>{t.blockedBy.length > 0 ? t.blockedBy.map(n => `#${n}`).join(' ') : '—'}</td>
                      {/* 路径列：宽度交给内容（表格自适应），过长由 FilePath 省略号截断，title 里有全路径。 */}
                      <td style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDER_LIGHT}`, maxWidth: 260 }}><FilePath ticket={t} scope={scope} ctx={ctx} /></td>
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

const NODE_W = 176, STEP_X = 200, NODE_H = 66
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
  const leaves = grid.filter(t => (childrenOf.get(t.id) ?? []).length === 0 && t.done).map(t => t.id)
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
                    <span style={{ fontSize: 12 }}>{ticketDisplayMeta(t).icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TEXT, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                  </div>
                  <div style={{ fontSize: 9, color: TEXT_FAINT, display: 'flex', gap: 6 }}>{STATUS_LABELS[displayStatus(t)]}{t.claimedBy && <> 👤 {t.claimedBy}</>}</div>
                  {/* 节点高度 44→66 就是为这行路径让位（NODE_H 常量同步改）。 */}
                  <FilePath ticket={t} scope={scope} ctx={ctx} size={9} />
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
                  <FilePath ticket={t} scope={scope} ctx={ctx} size={9} />
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

// ─── 推演产物三视图（2026-09-30 拍板③，取代票 12 的「🔍 推演票」聚合页）──────
//
// 每个票型一个视图，仅选中推演图（mapKind==='speculation'）显示：该型推演票
// 全量列出（含已收口——工单页 Table 变体默认只显 open/claimed），行内展示其
// frontmatter `assets:` 字段命中的产物文件。归组走官方获取契约（资产存仓、
// 经字段链接、不贴正文）；未被任何票引用的资产文件是契约外孤岛，不进视图。
function SpeculationTypeView({ kind, tickets, assetFiles, cwd, planDir, scope, ctx, sessions, onChanged, readOnly }: {
  kind: string; tickets: ParsedTicket[]; assetFiles: ParsedTicket[]; cwd: string | undefined; planDir: string; scope: SessionScope; ctx: any; sessions: Map<string, SessionSummary>; onChanged: () => void; readOnly?: boolean
}) {
  const [focus, setFocus] = useState<ParsedTicket | null>(null)
  const rows = useMemo(() => tickets.filter(t => (t.type ?? '').trim().toLowerCase() === kind), [tickets, kind])
  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, fontSize: 12.5, color: TEXT_FAINT }}>
        当前范围没有 {SPECULATION_TICKET_META[kind]?.label ?? kind}——它们由 wayfinder 推演产出，票 frontmatter <code style={{ fontSize: 11, background: HEADER_BG, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '1px 5px' }}>type</code> 区分，产物经 <code style={{ fontSize: 11, background: HEADER_BG, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '1px 5px' }}>assets:</code> 字段链接。
      </div>
    )
  }
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
      <div style={{ fontSize: 11, color: TEXT_FAINT, marginBottom: 8 }}>
        {SPECULATION_TICKET_META[kind]?.icon} {SPECULATION_TICKET_META[kind]?.label} 全量清单（含已收口）；「产物」列 = 票 frontmatter assets: 字段命中的资产文件（存仓、经字段链接、不贴正文）。
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <tbody>
          {rows.map(t => {
            const linked = t.assets.length === 0 ? [] : assetFiles.filter(a => a.path !== undefined && t.assets.some(ref => sameAssetRef(a.path as string, ref, cwd)))
            return (
              <tr key={t.path} style={{ cursor: 'pointer', borderBottom: `1px solid ${BORDER_LIGHT}` }} onClick={() => setFocus(t)}>
                <td style={{ padding: '7px 10px', width: 1, whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: `${ticketDisplayMeta(t).color}1e`, color: ticketDisplayMeta(t).color, border: `1px solid ${ticketDisplayMeta(t).color}44` }}>{ticketDisplayMeta(t).icon} {ticketDisplayMeta(t).label}</span>
                </td>
                <td style={{ padding: '7px 10px', color: TEXT }}>{t.title}</td>
                <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: TEXT_FAINT }}>{displayStatus(t)}</td>
                <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: TEXT_FAINT, fontSize: 11 }}>{t.effort && t.effort !== ROOT_GROUP ? t.effort.split('/').pop() : ''}</td>
                <td style={{ padding: '7px 10px', maxWidth: 300 }}>
                  {linked.length === 0
                    ? <span style={{ color: TEXT_FAINT }}>—</span>
                    : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{linked.map(a => <FilePath key={a.path} ticket={a} scope={scope} ctx={ctx} />)}</div>}
                </td>
                <td style={{ padding: '7px 10px', maxWidth: 260 }}><FilePath ticket={t} scope={scope} ctx={ctx} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {focus && <DetailModal ticket={focus} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} onClose={() => setFocus(null)} readOnly={readOnly} />}
    </div>
  )
}

function EffortChips({ efforts, all, effortIdx, setEffortIdx, countFor, totalCount, right }: {
  efforts: { dir: string; mapRaw: string; specRaw?: string }[]
  all: ParsedTicket[]
  effortIdx: number
  setEffortIdx: (i: number) => void
  countFor: (dir: string) => number
  totalCount: number
  right?: React.ReactNode   // 行右端槽位（2026-10-03 拍板①：轮次选择器挂这里）
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
            const specOnly = e.mapRaw === ''
            return (
              <span key={e.dir} onClick={() => setEffortIdx(i)} title={`${e.dir}${specOnly ? '（spec-only 实施图：无 map.md，凭 spec.md 加载，工单页无 Destination）' : ''}${done ? '（全部工单已验收）' : ''}`} style={{ fontSize: 11.5, padding: '4px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? accent : done ? '#4ed17e55' : BORDER}`, color: on || done ? accent : TEXT_FAINT, background: on ? `${accent}22` : 'transparent' }}>
                {kind ? MAP_KIND_META[kind].icon : '🗺️'} {e.dir.split('/').pop()}{specOnly ? ' 📄' : ''} <span style={{ opacity: .7 }}>{countFor(e.dir)}</span>
              </span>
            )
          })}
          {g !== groups[groups.length - 1] && <span style={{ width: 1, height: 16, background: BORDER, margin: '0 4px' }} />}
        </span>
      ))}
      {right && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>{right}</span>}
    </div>
  )
}

function OverviewView({ tickets, efforts, cases, tests, defects, ledgers, effortIdx, setEffortIdx, planDir, scope, ctx, sessions, onChanged, readOnly }: {
  tickets: ParsedTicket[]
  efforts: { dir: string; mapRaw: string; specRaw?: string }[]
  cases: ParsedTicket[]
  tests: ParsedTicket[]
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
  // 下方三个聚合区都只看该图；根层松散文档与工单页同语义保持可见。
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
      {/* 标题与路径成列：路径换行显示而不是被挤到行尾，`minWidth: 0` 让省略号生效。 */}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12.5, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
        <FilePath ticket={t} scope={scope} ctx={ctx} size={10} />
      </span>
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
                // 本图自有单据——**不含全局件**（2026-10-04 拍板 A 案）：三段读数
                // （进度条 / 在途数 / 阶段词）同源同集合，剔除口径一次生效，
                // 不会出现「进度条剔了、在途数没剔」的新一轮双口径。
                const own = tickets.filter(t => t.effort === e.dir)
                const kind = mapKind(e.dir, tickets)
                const prog = effortProgress(own, e.dir, cases, tests, kind, e.specRaw)
                const { pct, locked, lockPct, lockKind } = prog
                // 「在途」与新口径同源：四类单据中尚未结案的项数（不与 pct 各算一套，
                // 否则又会出现「100% · 3 项在途」这种自相矛盾的卡片）。
                const unsettled = own.filter(t => {
                  const k = ticketKind(t)
                  if (k === 'note' || k === 'cases') return false
                  if (k === 'ticket' && t.outOfScope) return false
                  return !isSettled(t, k)
                }).length
                const { stage, color } = effortStage(own)
                return (
                  <div key={e.dir} style={{ flex: '1 1 220px', minWidth: 220, padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}` }}>
                    <div style={{ fontSize: 11, color: TEXT_FAINT, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.dir.split('/').pop()}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color, margin: '3px 0 6px' }}>{stage}</div>
                    {/* 进度条 + 右侧读数（2026-10-02 用户需求①；展示形态 2026-10-03
                        用户拍板）：锁死时①条内右端画黄色锁区（宽 = lockPct%，深黄
                        #b8860b，区别于「在途」的橙黄）——锁定是**条上的可见区段**，
                        不是只有小字；②右边显示 🔒 角标与「缺测例 20% / 缺测试文档
                        10%」。放在条右侧而非下方文案里，是为了让「上限被锁」在扫视
                        进度条时立刻可见，不用去读小字。 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: CHIP_BG, overflow: 'hidden', position: 'relative' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, #4ed17e, ${ACCENT})` }} />
                        {/* 锁区叠在填充之上（绝对定位靠右）：填充已被封顶、原则上进不来，
                            叠放保证即使条宽取整溢出也不视觉越界。 */}
                        {locked && (
                          <div title={lockCopy(lockKind).title} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `${lockPct}%`, background: LOCKED, cursor: 'help' }} />
                        )}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: locked ? LOCKED : '#4ed17e', minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                      {locked && (
                        <span
                          title={lockCopy(lockKind).title}
                          style={{ fontSize: 10.5, fontWeight: 700, color: LOCKED, background: `${LOCKED}1f`, border: `1px solid ${LOCKED}66`, borderRadius: 4, padding: '1px 4px', whiteSpace: 'nowrap', cursor: 'help' }}
                        >{lockCopy(lockKind).chip}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_FAINT, marginTop: 5 }}>
                      {unsettled} 项在途 · {own.filter(t => ticketKind(t) === 'approval' && isPending(t)).length} 待拍板
                      {/* spec 不进进度（2026-10-05 拍板），这行只是提醒：spec.md 该归档
                          了。提醒与百分比彻底解耦——票全做完时进度就是 100%，本行不改变
                          任何数字，故不动用「还差这一项」的措辞。 */}
                      {prog.specCounted && !prog.specArchived && (
                        <span title="提醒：spec.md 是 effort 的一次性实施文档，随 effort 关闭作废归档（带 superseded-by: 注记或随轮归档）。它不参与进度计算——百分比只由票决定。" style={{ color: '#f7ad31', marginLeft: 6 }}>
                          📄 spec 未归档
                        </span>
                      )}
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

type TopView = 'overview' | 'map' | 'approvals' | 'cases' | 'defects' | 'ledger' | 'adr' | 'context' | 'guide'
// 地图页第二层子页签：一张图的各种切面（2026-09-21 拍板 IA：第一层只留
// 总览/地图/台账/说明，图相关内容全部收进地图页，顶部 chips 切图）。
// mapdoc/specdoc（2026-09-30 拍板）：推演图第 2 子页 = map.md 正文、实施图
//（spec-only）第 2 子页 = spec.md 正文——按选中 effort 的文件有无互斥显示。
	type MapSub = 'route' | 'mapdoc' | 'specdoc' | 'protodoc' | 'approvals' | 'ledger' | 'defects' | 'chain' | 'cases' | 'research' | 'prototype' | 'grilling'

/**
 * 字号缩放（2026-10-02 用户需求：右上角可调字号）。
 *
 * 步进式档位而非连续滑块：档位可枚举、可记忆、点击即到位，读的人知道自己在哪一档。
 * 范围 0.8–1.4 兼顾「小屏塞得下」与「字太小看不清」，超出范围两端都没有实际用途。
 */
const FONT_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4] as const
const FONT_SCALE_KEY = 'dsh-plan-view:font-scale'

/** 读上次选择；无记录/损坏/越界一律回 1（默认），绝不让坏值把页面缩没了。 */
function loadFontScale(): number {
  try {
    const raw = globalThis.localStorage?.getItem(FONT_SCALE_KEY)
    if (raw === null || raw === undefined) return 1
    const n = Number(raw)
    return FONT_SCALES.includes(n as typeof FONT_SCALES[number]) ? n : 1
  } catch { return 1 } // localStorage 可能被禁用（隐私模式/沙箱），读失败不算错
}

function saveFontScale(n: number): void {
  try { globalThis.localStorage?.setItem(FONT_SCALE_KEY, String(n)) } catch { /* 存不下就只在本次会话生效 */ }
}

/**
 * 初始/换轮后应选中的图下标。`-1` = 「全部地图」聚合态。
 *
 * 单图仓（efforts.length === 1）直接选中第 0 张：此时「全部地图」与「这张图」的
 * 正文完全等价，但 mapdoc/specdoc 两个子页只在选中态才插入（`selEffort` 判空），
 * 于是单图用户永远要多点一次芯片才能看到「🗺️ map / 📄 spec」（2026-10-02 用户反馈）。
 *
 * 多图仓（≥2）保持 `-1`：聚合视角是有信息量的默认；「优先选第一张」会静默藏起
 * 其余图的票，属于无依据的推断。零图仓同样是 `-1`（无芯片可选）。
 */
export function defaultEffortIdx(effortCount: number): number {
  return effortCount === 1 ? 0 : -1
}

export function PlanView(props: { ctx: any; sessionId?: string }) {
  // cwd 不由外层预解析（sessionCwd 链随票 19 退役）：首帧 snapshot 的响应自带
  // 服务端解析好的 cwd。scope 是只读快照对象，每渲染重建（字段少，无谓开销）。
  // （ctx 必须在此解构——动作层 14 处 JSX 引用 `ctx={ctx}`，漏解构即重渲染
  //  ReferenceError，且被 slot 错误边界吞成空白 pane。票 19 实证。）
  const { ctx } = props as { ctx: any }
  const sessionId = props.sessionId as string
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const scope: SessionScope = { sessionId, cwd }
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
  // 历史轮次：round === null 看现行治理目录（`.scratch/` + `.plan/` 双面合并，
  // 2026-09-29 目录迁移）；选中轮 id 后数据源切到 `.archive/rounds/<id>/`
  //（plan-archive 的轮目录就是当时源目录的快照——tracker 成员与随轮审批档平铺，
  // 单目录加载原样复用），整页进入只读。
  const [rounds, setRounds] = useState<RoundInfo[]>([])
  const [round, setRound] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // 一次请求全量：现行双根（round=null）或历史轮快照（round=id）。
      // 数据面 = 本插件服务端 /plan-view/snapshot（票 19 起与 better-sidebar 解耦）。
      const snap = await snapshot(sessionId, round ?? undefined)
      setCwd(prev => (prev === snap.cwd ? prev : snap.cwd))
      const r = assemblePlanData(snap)
      if (r.efforts.length === 0 && r.tickets.length === 0 && r.adrs.length === 0 && r.assetFiles.length === 0) { setError('empty'); setLoading(false); return }
      setRounds(roundsOf(snap))
      setContextRaw(snap.contextRaw)
      setData(r)
    } catch { setError('failed') } finally { setLoading(false) }
  }, [sessionId, round])
  const loadSessions = useCallback(() => {
    sessionList()
      .then(items => setSessions(new Map(items.map(s => [s.sessionId, s]))))
      .catch(() => setSessions(new Map()))
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { loadSessions() }, [loadSessions])
  // 换轮后旧 effort 下标可能越界，回到「全部地图」。
  useEffect(() => { setEffortIdx(-1) }, [round])
  // 单图自动进入（2026-10-02 用户反馈）：全仓只有一张图时，「全部地图」与「这张图」
  // 的正文完全等价，但 mapdoc/specdoc 两个子页只在选中态才插入（见下方 selEffort
  // 判空）——于是单图仓看到的永远缺「🗺️ map / 📄 spec」两页，必须手动点一次芯片
  // 才出现。单图没有筛选余地，默认选中第 0 张，省掉这次点击。
  // 与上面「换轮重置」合为一个 effect、同一批 setState，避免两处写同一状态而依赖
  // effect 声明顺序取胜（React 按声明顺序执行，reorder 即静默失效）。
  // 依赖不含 effortIdx：故用户手动点「全部地图」后不会被回弹覆盖。
  const effortCount = data?.efforts.length ?? 0
  useEffect(() => { setEffortIdx(defaultEffortIdx(effortCount)) }, [effortCount, round])
  // CONTEXT.md 正文随 snapshot 一次带回（2026-09-30 拍板：全局第一行末位 tab；
  // 缺档/非文本统一空态，tab 常驻不隐藏）。
  const [contextRaw, setContextRaw] = useState<string | null>(null) // null=未定（加载中），''=缺失
  // 字号缩放（2026-10-02 用户需求：右上角可调字号）。
  // 用 CSS `zoom` 作用于视图根：本视图有 190+ 处硬编码 fontSize，逐个改成 calc
  // 派生既invasive又易漏；zoom 一处生效、等比缩放整个子树（字号/行高/间距/卡头
  // 一起变），实测布局与滚动均不受损（.docCard 的 clientHeight/scrollHeight 关系
  // 保持不变、canScrollY 仍为 true）。代价是它也缩放了间距——这是「整页等比」
  // 的预期语义，与浏览器 Ctrl+加号一致。
  // 初值只读一次 localStorage（惰性初始化）：每渲染读会与用户拖动打架。
  const [fontScale, setFontScale] = useState<number>(() => loadFontScale())
  // Post-dispatch refresh: the plan files may have a new `session:` binding and
  // the session map may have a new entry — both reread together.
  const onChanged = useCallback(() => { void load(); loadSessions() }, [load, loadSessions])

  const all = data?.tickets ?? []
  // ADR 全局页 / 推演产物三视图数据源（各自分流，均已不进票面）。
  const adrs = data?.adrs ?? []
  const assetFiles = data?.assetFiles ?? []
  const routeTickets = useMemo(() => all.filter(t => classify(t) === 'ticket'), [all])
  const approvals = useMemo(() => all.filter(t => classify(t) === 'approval'), [all])
  const ledgers = useMemo(() => all.filter(t => classify(t) === 'ledger'), [all])
  const defects = useMemo(() => all.filter(t => classify(t) === 'defect'), [all])
  // 测例设计文档（qa/cases.md，一图一份）：单列在地图「🧪 测例」子页，
  // 并作为测例节点进入串联画布（按「票 NN」引用挂到被测票下）。
  const cases = useMemo(() => all.filter(t => ticketKind(t) === 'cases'), [all])
  // 执行验收记录（qa/test.md）：不进票面，只作进度锁 10% 档的存在性判据（2026-10-03）。
  const qaTests = useMemo(() => data?.qaTests ?? [], [data?.qaTests])
  // 根层 qa/（无图归属）：SOP 回测、整页回测等测例 + 独立缺陷，进第一层「测例&缺陷」tab
  // 全局层测例/缺陷（.plan/qa/）自 2026-09-30 拍板起并入第一行【测例】【缺陷】
  // 两个 tab 的聚合数据源（cases/defects 全量），不再单独过滤成页。
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
  // 缺陷挂在具体图下（.scratch/<effort>/qa/），按当前选中的图过滤——与工单页共用
  // effortIdx/selectedDir，切图时缺陷跟着切。根层全局缺陷（.plan/qa/DEF-*.md，
  // 无图归属）不进地图页——2026-09-25 拍板：地图页只看图归属缺陷，全局缺陷
  // 只进第一层「测例&缺陷」tab。
  const mapDefects = useMemo(
    () => defects.filter(t => t.effort !== ROOT_GROUP && (effortIdx < 0 || t.effort === selectedDir)),
    [defects, effortIdx, selectedDir],
  )
  // 待拍板同语义随图切换（2026-09-21 拍板：筛选后看到的都是同一张图）；
  // 全局审批档（.plan/approval/，2026-09-30 收拢拍板起为正本落点，inEffort 对
  // ROOT_GROUP 恒真）与工单页松散票同语义保持可见。
  const mapApprovals = useMemo(
    () => (effortIdx < 0 ? approvals : approvals.filter(t => selectedDir !== undefined && inEffort(t, selectedDir))),
    [approvals, effortIdx, selectedDir],
  )
  // 台账两级（2026-09-21 拍板拆分）：根层全局台账（.plan/ledger/*.md，一账一文件，
  // t.effort = ROOT_GROUP）是项目全局正本；`.scratch/<effort>/ledger/` 是图内台账
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
  // 主头部用纯符号（2026-10-02 用户需求：刷新只用刷新符号）；错误页那处保留文字，
  // 因为「重新读取」是那里唯一的出路，纯符号在空白页里读不出是什么。
  const refreshBtn = (label = '⟳') => (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      title="重新读取治理目录 .scratch/.plan（别处改了文件时用）"
      aria-label="刷新"
      style={{ padding: '5px 10px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent', color: loading ? '#555' : '#aaa', cursor: loading ? 'default' : 'pointer', fontSize: 12 }}
    >
      {/* ⟳ 字形在 12px 下几乎不可读（2026-10-03 用户反馈）：纯符号档放大——18px 仍嫌小，
          同日再放大一圈到 22px；loading 的 … 与错误页的文字档维持 12px，按钮不因符号变胖。 */}
      {loading ? '…' : label === '⟳' ? <span style={{ fontSize: 22, lineHeight: 1 }}>⟳</span> : label}
    </button>
  )

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: BG, color: '#888' }}>Loading…</div>
  }
  if (error || !data) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: BG, color: '#888' }}>
        <span>{round === null ? 'No .scratch/.plan found in current directory.' : `轮次 ${round} 读取失败（目录可能已被移动或删除）。`}</span>
        {refreshBtn('⟳ 重新读取')} {/* 错误页保留文字：这里是唯一出路，纯符号读不出含义 */}
      </div>
    )
  }

  const planDir = data.effortDir
  const readOnly = round !== null
  // 选中 effort（第 2 子页 map/spec 的数据源；「全部地图」态为 undefined）。
  const selEffort = effortIdx >= 0 ? data.efforts[effortIdx] : undefined
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: '8px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', background: active ? CARD : 'transparent', color: active ? TEXT : '#888', fontSize: 12, fontWeight: active ? 700 : 400 })
  // 字号档位（2026-10-02 用户需求）：dir = +1 放大 / −1 缩小；已在端点则不动。
  // 到端点不循环——循环会让「一直点」从最大突然跳回最小，是意外而非意图。
  const stepFontScale = (dir: 1 | -1) => {
    const i = FONT_SCALES.indexOf(fontScale as typeof FONT_SCALES[number])
    const next = FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]
    if (next === undefined || next === fontScale) return
    setFontScale(next); saveFontScale(next)
  }
  const fontBtn = (atEnd: boolean): React.CSSProperties => ({ padding: '2px 6px', border: 'none', borderRadius: 4, background: 'transparent', color: atEnd ? '#555' : TEXT_DIM, cursor: atEnd ? 'default' : 'pointer', fontSize: 11, fontWeight: 700 })
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
  // 三票型视图计数（2026-09-30 拍板③）：该型推演票全量（含收口）——
  // 退役的「🔍 推演票」聚合页语义由三个型视图分摊，可见性零丢失。
  const specCount = (type: string) => mapTickets.filter(t => (t.type ?? '').trim().toLowerCase() === type).length
  // 选中图的型别：三个票型视图只对推演图显示（拍板「仅 wayfinder 的 map 可见」）。
  const selKind = effortIdx >= 0 && selectedDir !== undefined ? mapKind(selectedDir, mapOwnTickets) : undefined
  // effort 全局进度（2026-10-03 拍板②）：单图态一次算好，工单/待拍板/缺陷/台账
  // 四个子页头部共用；own 只取**本图自有单据**（2026-10-04 拍板 A 案起剔除全局件
  // ——参见 effortProgress 注释），读数与总览卡完全同口径（effortProgress 单一
  // 真相源）——Kanban 自算 done/active 的第二口径退役，仅存于「全部地图」聚合态
  // fallback（无单一 effort，无锁）。
  const selProg = (() => {
    if (effortIdx < 0 || selectedDir === undefined || selEffort === undefined) return undefined
    // 只取本图自有单据（不含全局件，2026-10-04 拍板 A 案）——与总览卡同一口径，
    // 两处读数必须相等（单一真相源）。函数内亦会兜底剔除 ROOT_GROUP。
    const own = all.filter(t => t.effort === selectedDir)
    return effortProgress(own, selectedDir, cases, qaTests, selKind, selEffort.specRaw)
  })()

  // 轮次选择器（2026-10-03 拍板①：从主头部下移到地图页 effort 行右端——归档轮
  // 看的是「当时的图」，与 effort 切换同语境）。round 态指示由主头部下方的
  // 「🗄️ 历史轮次快照」横幅全 tab 兜底，其他页签不会无提示地读到归档数据。
  const roundsSelect = rounds.length > 0 && (
    <select
      value={round ?? ''}
      onChange={e => setRound(e.target.value === '' ? null : e.target.value)}
      title="按轮查看历史归档（.archive/rounds，只读）"
      style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${round !== null ? '#7a4a15' : BORDER}`, background: HEADER_BG, color: round !== null ? '#f7ad31' : TEXT_DIM, fontSize: 12, outline: 'none', maxWidth: 280, cursor: 'pointer' }}
    >
      <option value="">📍 现行（.scratch + .plan）</option>
      {rounds.map(r => (
        <option key={r.id} value={r.id}>🗄️ {r.id}{r.topic ? ` · ${r.topic}` : ''}</option>
      ))}
    </select>
  )

  // 第一行 tab（2026-09-30 拍板拆分与追加；2026-10-04 用户拍板：补【待拍板】
  // 并按 effort 子页序重排，两层顺序一致——单据类相对序统一为
  // 待拍板→台账→缺陷→测例，取代 2026-09-30「ADR 居台账后」的位置拍板，
  // ADR/CONTEXT/说明为全局知识层、effort 无对应，保持尾部）。【待拍板】=
  // 全量聚合（各 effort approval/ ＋ .plan/approval/ 全局件），计数口径与
  // 总览一致（pending）；计数橙色沿用 2291 行为 'approvals' 预留的分支。
  const tabs: { id: TopView; label: string; count: number }[] = [
    { id: 'overview', label: '🧭 总览', count: pendingApprovals(approvals) },
    // 地图 tab 计数用全局口径（mapOwnTickets），不随 chips 选中图跳变——
    // 随选中变化曾把选中无 open 票的图显示成「地图 0」，读作计数不准（2026-09-30 用户反馈）。
    { id: 'map', label: '🗺️ 地图', count: openTickets(mapOwnTickets) },
    { id: 'approvals', label: '⏳ 待拍板', count: pendingApprovals(approvals) },
    { id: 'ledger', label: '📒 台账', count: openLedgerCount(globalLedgers) },
    { id: 'defects', label: '🐞 缺陷', count: openDefectCount(defects) },
    { id: 'cases', label: '🧪 测例', count: cases.length },
    { id: 'adr', label: '🏛️ ADR', count: adrs.length },
    { id: 'context', label: '📐 CONTEXT', count: 0 },
    { id: 'guide', label: '📖 说明', count: 0 },
  ]

  // 宿主 .tabBody（ui-sidebar-right）height:100% + overflow:hidden：pane 高度
  // 固定、溢出裁切，滚动责任在本视图。minHeight:0 解除 flex 列方向的内容式
  // 自动最小高度，否则根被正文撑高后被宿主裁掉——全 tab 不可滚动。
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: BG, color: TEXT, fontFamily: 'sans-serif', fontSize: 14, zoom: fontScale }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, background: HEADER_BG, alignItems: 'center' }}>
        {tabs.map(t => (
          <button key={t.id} type="button" style={tabBtn(top === t.id)} onClick={() => setTop(t.id)}>
            {t.label}
            {/* 计数 0 不显示：文档类页签（CONTEXT/说明）计数恒 0，带一个「0」只有噪音
                （2026-09-30 用户反馈：context/spec/map 不要显示数量）。 */}
            {t.id !== 'guide' && t.count > 0 && <span style={{ marginLeft: 5, fontSize: 11, color: (t.id === 'approvals' || t.id === 'overview') ? '#f7ad31' : '#777' }}>{t.count}</span>}
          </button>
        ))}
        {/* The files change outside this view — another session writes them, or
            this one does. Re-reading is the only way to see that. */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 字号（2026-10-02 用户需求）：只有百分比与加减号，不带「字号」和 A 字符
              ——按钮自带 title/aria-label 说明用途，视觉上不占位。
              根节点 zoom 让整个子树等比缩放（含本控件自身，故调大后控件也跟着
              变大——与浏览器缩放同一预期）。到端点后按钮置灰，不做循环。 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '2px 4px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent' }}>
            <button
              type="button"
              onClick={() => stepFontScale(-1)}
              disabled={fontScale === FONT_SCALES[0]}
              title="缩小字号"
              aria-label="缩小字号"
              style={fontBtn(fontScale === FONT_SCALES[0])}
            >−</button>
            <span title="当前字号（整页等比缩放）" aria-live="polite" style={{ fontSize: 10.5, color: TEXT_DIM, minWidth: 30, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(fontScale * 100)}%</span>
            <button
              type="button"
              onClick={() => stepFontScale(1)}
              disabled={fontScale === FONT_SCALES[FONT_SCALES.length - 1]}
              title="放大字号"
              aria-label="放大字号"
              style={fontBtn(fontScale === FONT_SCALES[FONT_SCALES.length - 1])}
            >+</button>
          </div>
          {/* 刷新固定在最右（2026-10-02 用户需求）：位置不变找起来不用扫，
              符号本身也是通用语义，无需文字。 */}
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
              totalCount={mapOwnTickets.length}
              right={roundsSelect} />
          )}
          {/* 第二层子页签：当前选中图（或全部）的各类切面 */}
          <div style={{ display: 'flex', gap: 2, padding: '4px 14px 0', borderBottom: `1px solid ${BORDER}`, background: BG, alignItems: 'center' }}>
            {([
              ['route', '🎫 工单', openTickets(mapTickets)],
              // 第 2 子页（2026-09-30 拍板）：推演图 =【map】渲染 map.md 正文；
              // 实施图（spec-only）=【spec】渲染 spec.md 正文。按选中 effort 的
              // 文件有无互斥插入；「全部地图」态无单一正文，不显示。
              ...(selEffort === undefined ? [] : selEffort.mapRaw !== ''
                ? [['mapdoc', '🗺️ map', 0] as [MapSub, string, number]]
                : selEffort.specRaw ? [['specdoc', '📄 spec', 0] as [MapSub, string, number]] : []),
              // 原型产物子页（2026-10-04 票 24）：effort 的 prototype/ 自包含
              // html 预览。仅选中 effort 且目录非空时插入（同 mapdoc/specdoc
              // 模式）；「全部地图」态无单一 effort 不显示。id 用 protodoc——
              // 'prototype' 已被推演票型子页占用。
              ...(selEffort !== undefined && selEffort.prototypes.length > 0
                ? [['protodoc', '🖥️ 原型', selEffort.prototypes.length] as [MapSub, string, number]]
                : []),
              // 原「🎫 工单」独立子页已移除（2026-09-30 拍板②）并入本页（Table
              // 变体即原工单表）；2026-10-03 拍板：本页由「路线」更名「工单」。
              ['approvals', '⏳ 待拍板', pendingApprovals(mapApprovals)],
              ['ledger', '📒 台账', openLedgerCount(mapLedgers)],
              ['defects', '🐞 缺陷', openDefectCount(mapDefects)],
              ['cases', '🧪 测例', mapCases.reduce((n, f) => n + (f.body.match(/^\|\s*[A-Z]-?\d+/gm)?.length ?? 0), 0)],
              // 串联计数 = 实际入画的连通节点数（孤岛被折叠，不计入），与画布一致
              ['chain', '🧪 串联', buildChain(mapTickets, mapDefects, mapLedgers, mapCases).nodes.length],
              // 三票型视图（2026-09-30 拍板③，取代退役的「🔍 推演票」聚合页）：
              // 仅选中推演图时插入——实施图/spec-only 与「全部地图」态不显示（拍板
              // 「仅 wayfinder 的 map 可见」）；每型全量（含收口票）＋assets: 关联产物。
              ...(selKind === 'speculation' ? ([
                ['research', '🔍 调研', specCount('research')],
                ['prototype', '🧩 原型', specCount('prototype')],
                ['grilling', '🔥 拷问', specCount('grilling')],
              ] as [MapSub, string, number][]) : []),
            ] as [MapSub, string, number][]).map(([id, label, n]) => (
              <button key={id} type="button" style={{ ...mapTab(mapSub === id) }} onClick={() => setMapSub(id)}>
                {label}{n > 0 && <span style={{ marginLeft: 5, fontSize: 11, color: mapSub === id ? ACCENT_SOFT : '#777' }}>{n}</span>}
              </button>
            ))}
          </div>
          {/* effort 全局进度条（2026-10-03 拍板②＋用户反馈定位置）：子页签行下、
              内容区前，四个单据子页共用同一条；「全部地图」态无单一 effort
              （selProg undefined）不渲染，工单页 fallback 聚合条接手。 */}
          {selProg !== undefined && ['route', 'approvals', 'ledger', 'defects'].includes(mapSub) && (
            <EffortProgressBar prog={selProg} />
          )}
          {mapSub === 'route' && (
            <>
              <div style={{ display: 'flex', gap: 4, padding: '9px 14px', background: BG }}>
                <button type="button" style={subBtn(variant === 'A')} onClick={() => setVariant('A')}>📋 Kanban</button>
                <button type="button" style={subBtn(variant === 'D')} onClick={() => setVariant('D')}>📊 Relation</button>
                <button type="button" style={subBtn(variant === 'C')} onClick={() => setVariant('C')}>Table</button>
              </div>
              {variant === 'A' && <ViewA tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} destination={destination} readOnly={readOnly} prog={selProg} />}
              {variant === 'D' && <ViewD tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
              {variant === 'C' && <ViewC tickets={mapTickets} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
            </>
          )}
          {/* 第 2 子页正文：map.md（推演图）/ spec.md（spec-only 实施图），与
              票面详情同一 markdown 渲染器。 */}
          {mapSub === 'mapdoc' && selEffort !== undefined && selEffort.mapRaw !== '' && (
            <DocCard icon="🗺️" title="map.md" path={`${selEffort.dir}/map.md`} scope={scope} ctx={ctx} body={selEffort.mapRaw} />
          )}
          {mapSub === 'specdoc' && selEffort !== undefined && !!selEffort.specRaw && (
            <DocCard icon="📄" title="spec.md" path={`${selEffort.dir}/spec.md`} scope={scope} ctx={ctx} body={selEffort.specRaw as string} />
          )}
          {mapSub === 'protodoc' && selEffort !== undefined && selEffort.prototypes.length > 0 && (
            <ProtoView prototypes={selEffort.prototypes} scope={scope} />
          )}
          {mapSub === 'approvals' && <ApprovalsView approvals={mapApprovals} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'ledger' && <LedgerView ledgers={mapLedgers} mapTickets={mapTickets} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'defects' && <DefectView defects={mapDefects} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'chain' && <ChainView tickets={mapTickets} defects={mapDefects} ledgers={mapLedgers} cases={mapCases} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'cases' && <CasesView cases={mapCases} scope={scope} ctx={ctx} readOnly={readOnly} />}
          {mapSub === 'research' && <SpeculationTypeView kind="research" tickets={mapTickets} assetFiles={assetFiles} cwd={cwd} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'prototype' && <SpeculationTypeView kind="prototype" tickets={mapTickets} assetFiles={assetFiles} cwd={cwd} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
          {mapSub === 'grilling' && <SpeculationTypeView kind="grilling" tickets={mapTickets} assetFiles={assetFiles} cwd={cwd} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
        </>
      )}
      {top === 'approvals' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT }}>
            待拍板聚合（2026-10-04 用户拍板补 tab）：各 effort `approval/` ＋ 全局件 `.plan/approval/`；图内待拍板也在地图页「⏳ 待拍板」子页按图查看。pending 档=status 未翻且未标 archived。
          </div>
          {approvals.length > 0
            ? <ApprovalsView approvals={approvals} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />
            : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT }}>没有待拍板文档（有决定悬空时 to-approval 落档，这里第一时间看见）。</div>}
        </div>
      )}
      {top === 'cases' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT }}>
            测例聚合（2026-09-30 拍板拆分）：各 effort `qa/cases.md` ＋ 全局回测 `.plan/qa/cases-*.md`；图内测例也在地图页「🧪 测例」子页按图查看。
          </div>
          {cases.length > 0
            ? <CasesView cases={cases} scope={scope} ctx={ctx} readOnly={readOnly} />
            : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT }}>暂无测例文档（一图一份 `qa/cases.md`；无图归属回测落 `.plan/qa/cases-*.md`）。</div>}
        </div>
      )}
      {top === 'defects' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT }}>
            缺陷聚合（2026-09-30 拍板拆分）：各 effort `qa/DEF-*.md` ＋ 全局无图归属 `.plan/qa/` 缺陷；图内缺陷也在地图页「🐞 缺陷」子页按图查看。
          </div>
          {defects.length > 0
            ? <DefectView defects={defects} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />
            : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT }}>暂无缺陷文档（`type: qa-defect` 一缺陷一文件，加头 = 被看见）。</div>}
        </div>
      )}
      {top === 'adr' && <AdrView adrs={adrs} scope={scope} ctx={ctx} />}
      {top === 'context' && (
        // 与 spec/map 同壳（2026-10-02 用户反馈：样式还不一致）：CONTEXT 页此前是
        // 光板 div——虽已注入 MD_CSS（上一轮补的，解决「标题无层级/表格无边框」），
        // 但仍缺卡片框、卡头、可点开的文件路径，且正文继承 14px 而非文档页的 13px。
        // 直接复用 DocCard（同为「整篇 markdown 正文」场景），不再写第二套壳。
        // 空态/加载态仍走原分支：DocCard 要求有正文，且两者都无正文可展示。
        contextRaw !== null && contextRaw !== ''
          ? <DocCard icon="📐" title="CONTEXT.md" path={cwd === undefined ? 'CONTEXT.md' : `${cwd}/CONTEXT.md`} scope={scope} ctx={ctx} body={contextRaw} />
          : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, fontSize: 12, padding: 24, textAlign: 'center' }}>
            {contextRaw === null
              ? '读取 CONTEXT.md…'
              : '本仓仓根暂无 CONTEXT.md（领域词汇表/概念正本落点；建立后本页自动呈现）。'}
          </div>
      )}
      {top === 'guide' && <GuideView scope={scope} />}
      {top === 'ledger' && <LedgerView ledgers={globalLedgers} mapTickets={mapTickets} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
      {top === 'overview' && <OverviewView tickets={all} efforts={data.efforts} cases={cases} tests={qaTests} defects={defects} ledgers={ledgers} effortIdx={effortIdx} setEffortIdx={setEffortIdx} planDir={planDir} scope={scope} ctx={ctx} sessions={sessions} onChanged={onChanged} readOnly={readOnly} />}
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
          第一行页签（2026-09-30 拍板）：总览 / 地图 / 测例 / 缺陷 / 台账 / ADR / CONTEXT / 说明。测例与缺陷各自成页并
          <strong style={{ color: TEXT }}>聚合全局</strong>（各 effort <Code>qa/</Code> ＋ <Code>.plan/qa/</Code>）；
          【ADR】渲染仓根 <Code>docs/adr/</Code>（架构决策记录，知识层只读展示，2026-09-30 拍板）；
          【CONTEXT】渲染仓根 <Code>CONTEXT.md</Code>（词汇表/领域正本）。地图页内：推演图第 2 子页为【map】
          （map.md 正文）、实施图（spec-only）第 2 子页为【spec】（spec.md 正文）。
          各页显示的是两个治理目录下的 markdown：tracker 类（spec / map / issues 票）在 <Code>.scratch/</Code>，
          审批档与全局缺陷/台账在 <Code>.plan/</Code>。本页说明这些文件怎么产生、谁维护、怎么流转。完整的流程协议
          （每环节的位置与交接契约）记在同仓 <Code>skills/plan-protocol/SKILL.md</Code>，本页是它的可视化速览。
        </P>
        <P>
          <strong style={{ color: TEXT }}>台账 / 缺陷 / 测例三类都有「图内」与「全局」两个落点</strong>（2026-10-02 拍板口径）：
          有图归属的落该图的 <Code>.scratch/&lt;effort&gt;/qa|ledger/</Code>，随图整轮归档；
          无图归属的（SOP 回测、整页回测这类挂不到具体工单的）落 <Code>.plan/qa|ledger/</Code>，常驻不随轮走。
          拿不准归哪边时<strong style={{ color: TEXT }}>留全局</strong>（宁少拆不错拆）。
          <Code>.plan/approval/</Code> 的全局审批档则不同——它<strong style={{ color: TEXT }}>搭 effort 归档的车</strong>：
          被标了 <Code>archived:</Code> 的随某一轮一并搬走，没标的一直留在这里等。
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
            勾验收项、置 <Code>Status</Code> 行、补落地注
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
          两条流在「<strong style={{ color: TEXT }}>结论 = 要做某件事</strong>」处汇合：拍板结论若要求干活，
          <strong style={{ color: TEXT }}>plan-approve 在影响域清单登记票项</strong>（只结算、不落票——2026-09-28 拍板），
          落票由清单驱动后置执行（plan-loop「定案未拆票」行动行或实施会话调 <Code>to-tickets</Code>），
          而不是把结论留在文档里等人再拆一次。
        </P>

        <H>票的形态约定</H>
        <P>一个 effort 目录下，票按<strong style={{ color: TEXT }}>一票一文件</strong>放：</P>
        <div style={{ fontSize: 12, lineHeight: 1.9, color: TEXT_DIM, background: '#141416', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 8, padding: '10px 14px', margin: '8px 0', fontFamily: 'ui-monospace,Menlo,monospace' }}>
          .scratch/&lt;effort&gt;/ &nbsp;<span style={{ color: TEXT_FAINT }}>← tracker 类（spec/map/issues 票）</span><br />
          &nbsp;&nbsp;map.md &nbsp;<span style={{ color: TEXT_FAINT }}>← effort 标志：没有它，整个目录不被加载</span><br />
          &nbsp;&nbsp;issues/<br />
          &nbsp;&nbsp;&nbsp;&nbsp;01-&lt;slug&gt;.md &nbsp;<span style={{ color: TEXT_FAINT }}>← frontmatter: type；正文: **Status:** / **Blocked by:**</span><br />
          &nbsp;&nbsp;&nbsp;&nbsp;02-&lt;slug&gt;.md<br />
          &nbsp;&nbsp;approval/ &nbsp;<span style={{ color: TEXT_FAINT }}>← 图内审批档（待拍板-*.md，grill / wayfinder 生成）</span><br />
          &nbsp;&nbsp;qa/ &nbsp;<span style={{ color: TEXT_FAINT }}>← 图内测例（cases.md）＋ 缺陷（DEF-*）</span><br />
          &nbsp;&nbsp;ledger/ &nbsp;<span style={{ color: TEXT_FAINT }}>← 图内台账（挂账-NN-*），随图归档</span><br />
          &nbsp;&nbsp;qa/ &nbsp;<span style={{ color: TEXT_FAINT }}>← 图内测例（cases.md）＋ 缺陷（DEF-*）</span><br />
          &nbsp;&nbsp;ledger/ &nbsp;<span style={{ color: TEXT_FAINT }}>← 图内台账（挂账-NN-*），随图归档</span><br />
          .plan/ &nbsp;<span style={{ color: TEXT_FAINT }}>← 全局件目录：approval/（全局审批档，2026-09-30 收拢拍板）＋ qa/（无图归属缺陷/测例）＋ ledger/（全局台账）——三件即封闭清单，清单外新子目录由 plan-lint 拦</span>
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
            票是<strong style={{ color: TEXT }}>等被做</strong>的活（正文 <Code>**Status:** open/claimed/resolved</Code>）；
            待拍板是<strong style={{ color: TEXT }}>等你做决定</strong>的文档（正文 <Code>**Status:** pending</Code>）。
            两者状态都写<strong style={{ color: TEXT }}>正文行</strong>，不再写 frontmatter（2026-10-02 起；frontmatter 只留 <Code>type</Code> 等事实字段）。
            拍板结论若要干活，就该当场生成票——两者不是同一个东西，但会接力。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>四种票型怎么认？</strong><br />
            <Code>task</Code>＝执行票（🛠️ 落码验收，实施图的原子）；
            <Code>research</Code>＝调研票（🔍 查证并产出引用式笔记进 assets/）；
            <Code>prototype</Code>＝原型票（🧩 做粗糙实物给讨论反应）；
            <Code>grilling</Code>＝拷问票（🔥 逐题拍板）。
            推演图（后三种组成）终点是<strong style={{ color: TEXT }}>决策清零</strong>，实施图（task）终点是<strong style={{ color: TEXT }}>落码验收</strong>；
            卡片上的彩色徽标即票型身份；推演图子页「🔍 调研 / 🧩 原型 / 🔥 拷问」按票型全量列出这三种票与其 assets: 关联产物（2026-09-30 拍板：三视图取代聚合推演票页，仅推演图可见；工单页 Table 变体默认只显 open/claimed，收口票看这里）。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>进度条右端的黄色锁区是什么？</strong><br />
            实施图的完成度有两道<strong style={{ color: TEXT }}>结构性上限</strong>（2026-10-02/10-03 拍板）：
            没有 <Code>qa/cases.md</Code>（测例）锁右端 20%、封顶 80%；有测例但没有 <Code>qa/test.md</Code>
            （执行验收记录）锁右端 10%、封顶 90%。黄色段 = <strong style={{ color: TEXT }}>干了也够不到的那一段</strong>，
            补齐缺件才解锁；推演图没有 qa 通道，不参与这条口径。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>看到状态不对怎么办？</strong><br />
            结构漂移先用只读脚本查：<Code>bash ~/.zcode/skills/mp-plan-approve/scripts/plan-lint.sh 仓库根/.scratch 仓库根/.plan</Code>
            （同票双档、缺 map.md、文档头违规、合体票文件、effort 票尽未标 superseded-by、.plan 根层白名单；仓里有机器可读词表时加 <Code>--terms 词表</Code>，检查[7] 再断言全仓术语无标记残留）；
            再跑 <Code>plan-sync</Code> 对账票面与实际进度（对照 git 提交判定，先报告差异再改）。
            两者都只报告、不擅自改。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>归档在哪？</strong><br />
            已完成内容由 <Code>plan-archive</Code>（手动触发）迁到 <Code>.archive/</Code>，
            并 sweep 全仓引用（含归档区自身）、标过时/废弃。归档区的「现行权威」表是引用断链的高发地，每次归档都要维护它。<br/>
            归档时<strong style={{ color: TEXT }}>全局 qa/ 与 ledger/ 不搬</strong>（常驻），但<strong style={{ color: TEXT }}>已标 <Code>archived:</Code> 的全局审批档一并搭车搬走</strong>（2026-10-02 拍板）；<Code>plan-sync</Code> 收尾会先核一遍归档前置判据并报告。
            归档时<strong style={{ color: TEXT }}>全局 qa/ 与 ledger/ 不搬</strong>（常驻），
            但<strong style={{ color: TEXT }}>已标 <Code>archived:</Code> 的全局审批档一并搭车搬走</strong>（2026-10-02 拍板）。
            <Code>plan-sync</Code> 收尾会先核一遍归档前置判据并报告，不必等归档时才发现缺件。
            右上角「轮次」选择器可切进某一轮的快照（<Code>.archive/rounds/&lt;round-id&gt;/</Code>），
            按轮只读查看当时的地图 / 工单 / 拍板。
          </div>
          <div style={{ margin: '10px 0' }}>
            <strong style={{ color: TEXT }}>历史遗留的 impl/ 、impl-fe/ 目录？</strong><br />
            那是早期形态的实施工单，正在逐步废弃。它们的票现在也出现在「🗺️ 地图 → 🎫 工单」子页（Kanban/Table/Relation），不再单独成页；
            收尾时并入 <Code>issues/</Code>。<strong style={{ color: TEXT }}><Code>tickets/</Code> 同样是非法目录名</strong>——
            票只认 <Code>issues/</Code>（存量 <Code>tickets/</Code> 待迁移）。
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
                {/* 文件名 chip 由路径行取代——路径以文件名结尾，信息更全且可点开。 */}
                <FilePath ticket={t} scope={scope} ctx={ctx} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: settled ? '#2ecc7122' : '#ffa94d22', color: settled ? '#4ed17e' : '#f7ad31' }}>{t.status ?? 'pending'}</span>
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
    return t === undefined || (displayStatus(t) !== 'done' && !t.outOfScope)
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
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>一账一文件：全局件放 `.plan/ledger/挂账-NN-slug.md`，图内放 `.scratch/&lt;effort&gt;/ledger/`，frontmatter 带 `type: ledger`。</span>
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
            // 一账一文件：整个文件就是一笔，直接渲染卡片，不要组头——路径行即它的头部。
            return (
              <div key={t.file} onClick={() => setFocus(t)} style={{ padding: '10px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
                <FilePath ticket={t} scope={scope} ctx={ctx} />
                <LedgerCard entry={single} />
              </div>
            )
          }
          return (
            <div key={t.file} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{t.title}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{entries.length} 笔在账</span>
              </div>
              <FilePath ticket={t} scope={scope} ctx={ctx} />
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

// 缺陷字段 chip（2026-10-06 用户反馈：页面被撑爆、内容挤成竖排）。
//
// 症状：这些字段其实是**整句**而非短值（如状态「已关闭（2026-10-04 票 09
// `fff9bce1` 上下文装配＋票 10 `6a753bcc` 步 0/5 收敛单提交落地——断口 a…」，
// 实测 200+ 字）。chip 是不换行的 pill，`flexWrap` 只能整块换行——一个 chip
// 即宽几百像素，同行的标题被挤到只剩几个像素、竖排成一条，整页横向溢出。
//
// 修法：值超过 `maxW` 即截断加省略号，**完整原文挂在 title 上**（悬停可读）。
// 字段本身不丢，只是不再由它决定整页宽度。`minWidth: 0` 让 flex 子项真的能
// 收缩——缺它时 flex 项的下限是内容宽，截断不会生效。
function FieldChip({ label, value, maxW, style }: { label: string; value: string; maxW: number; style?: any }) {
  if (!value) return null
  return (
    <span title={`${label} ${value}`} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888', display: 'inline-block', maxWidth: maxW, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle', ...style }}>
      {label} {value}
    </span>
  )
}

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
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>{'`.scratch/<effort>/qa/`（存量图 `.plan/<effort>/qa/`）下带 `type: qa-defect` 头的缺陷台账会按图列在这里。'}</span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_FAINT }}>
        缺陷挂在具体图下（按当前选中的图过滤，切图联动）；一缺陷一文件（`qa/DEF-NN-*.md`），点卡片看全文。
      </div>
      {/* minWidth:0：flex 子项默认下限是内容宽，缺它时超宽内容会把这一列连同父容器一起撑宽
          （2026-10-06 实测：长字段 chip 撑爆整页、相邻列被挤成竖排）。 */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {defects.map(t => {
          const single = parseDefectFile(t)
          if (single !== undefined) {
            const closed = DEFECT_CLOSED.has(defectStateWord(single.state))
            return (
              <div key={`${t.effort}/${t.file}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{single.id} {single.title}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>一缺陷一文件</span>
                </div>
                {/* 组头原写「<effort>/<文件名>」——路径行以文件名结尾，信息更全且可点开。 */}
                <FilePath ticket={t} scope={scope} ctx={ctx} />
                <div onClick={() => setFocus(t)} style={{ padding: '10px 12px', borderRadius: 10, background: closed ? CARD_DARK : CARD, border: `1px solid ${BORDER}`, cursor: 'pointer', opacity: closed ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* 状态是长句（实测 200+ 字）：必须截断，否则撑爆整行、标题被挤成竖排。 */}
                    <span title={single.state} style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: closed ? '#2ecc7122' : '#ffa94d22', color: closed ? '#4ed17e' : '#f7ad31', flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{single.state}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{single.title}</span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: TEXT_FAINT, flexShrink: 0 }}>{single.id}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, minWidth: 0 }}>
                    <FieldChip label="严重度" value={single.severity} maxW={300} />
                    <FieldChip label="类型" value={single.kind} maxW={300} />
                    <FieldChip label="发现源" value={single.source} maxW={300} />
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
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: CHIP_BG, color: '#888' }}>{entries.length} 条</span>
              </div>
              <FilePath ticket={t} scope={scope} ctx={ctx} />
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
                      <span title={e.state || '待修复'} style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: closed ? '#2ecc7122' : '#ffa94d22', color: closed ? '#4ed17e' : '#f7ad31', flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.state || '待修复'}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: TEXT_FAINT, flexShrink: 0 }}>{e.id}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <FieldChip label="严重度" value={e.severity} maxW={300} />
                      <FieldChip label="类型" value={e.kind} maxW={300} />
                      <FieldChip label="发现源" value={e.source} maxW={300} />
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
  const NODE_W = 250, NODE_H = 68, INDENT = 64, GAP_Y = 12, TOP = 20
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
  const NODE_H = 68
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
                    {/* 节点高度 56→68 为路径行让位（buildChain 的 NODE_H 同步改）。 */}
                    <FilePath ticket={node.ticket} scope={scope} ctx={ctx} size={9} />
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

// ─── DocCard（整篇 markdown 正文卡片）────────────────────────────────────────
//
// 地图页第 2 子页【map】/【spec】的正文壳，口径对齐 CasesView/AdrView：一篇文章
// 一张卡（卡头 = 图标＋文件名＋可点开的路径，正文 = 渲染后 markdown）。
// 关键在 <style>{MD_CSS}</style>：MD_CSS 是随组件注入的局部样式表，定义了
// .pvm-h/.pvm-table/.pvm-code 等类；漏注入则 md() 吐出的 HTML 拿不到任何排版
// 样式（标题无层级、表格无边框），读起来就是一堆裸字——这正是 2026-10-02 用户
// 报「spec/map 页风格与其它页不一致」的根因（此前两处是光板 div）。
//
// path 走字符串而非 ticket：effort 对象只有 dir，没有 FilePath 需要的
// path/file 字段；点击打开仍复用宿主侧边栏（openFileInSidebar）同一通路。

// 原型产物子页（2026-10-04 票 24）：effort `prototype/` 下自包含单文件 html
// 的预览面。文件 pill 行（多文件时）＋ iframe 预览——src 指服务端只读 GET 端点
// （html 不进 snapshot，膨胀；路径围栏在服务端 prototypePathError）。
// iframe 带 key：切文件重挂 iframe（src 变了但同域 hash 不触发跨文档重载）；
// 变体切换（#variant=）是文档内 hash 行为，原型自带切换条管它，预览面不干预。
// 会话无 id（理论不可达——tab 上下文必绑会话）时给提示态而不是空 iframe。
function ProtoView({ prototypes, scope }: { prototypes: { name: string; path: string }[]; scope: SessionScope }) {
  const [sel, setSel] = useState(prototypes[0]?.path ?? '')
  const current = prototypes.find(p => p.path === sel) ?? prototypes[0]
  if (current === undefined) return null
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {prototypes.length > 1 && (
        <div style={{ display: 'flex', gap: 4, padding: '9px 14px', background: BG, flexWrap: 'wrap' }}>
          {prototypes.map(p => (
            <button key={p.path} type="button" style={subBtnLike(current.path === p.path)} onClick={() => setSel(p.path)}>{p.name}</button>
          ))}
        </div>
      )}
      {scope.sessionId
        ? <iframe key={current.path} src={prototypeUrl(scope.sessionId, current.path)} title={current.name}
            style={{ flex: 1, border: 'none', background: '#fff', minHeight: 0 }} />
        : <div style={{ padding: 14, fontSize: 12, color: TEXT_FAINT }}>无会话绑定，原型预览不可用（可在右栏直接打开 {displayPath(current.path, scope.cwd)}）。</div>}
    </div>
  )
}

// ProtoView 的文件 pill 样式：与地图 route 子页的变体按钮（subBtn）同语言，但
// 那是主组件作用域内的闭包函数，这里复用不了——按同款参数本地复刻一份。
function subBtnLike(active: boolean): React.CSSProperties {
  return { padding: '6px 14px', border: `1px solid ${active ? BORDER : 'transparent'}`, borderRadius: 7, cursor: 'pointer', background: active ? HEADER_BG : 'transparent', color: active ? TEXT : '#888', fontSize: 11.5, fontWeight: active ? 700 : 400 }
}

function DocCard({ icon, title, path, scope, ctx, body }: {
  icon: string; title: string; path: string; scope: SessionScope; ctx: any; body: string
}) {
  const open = () => openFileInSidebar(ctx, scope, path, path)
  return (
    // 滚动容器刻意用块级布局（不加 display:flex）：flex 列容器上的子项默认
    // flex-shrink:1 会被压扁到塞满容器，scrollHeight 恒等于 clientHeight，
    // 等于滚不动（同 CasesView 的坑，2026-10-02 实测）。块级布局不压缩内容，
    // 正文多长 scrollHeight 就多长。minHeight:0 负责在父 flex 列里占住受限高度。
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
      <style>{MD_CSS}</style>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, background: HEADER_BG }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{icon} {title}</span>
          <button
            type="button"
            onClick={open}
            title={`点击在右栏打开：${path}`}
            style={{ fontSize: 10.5, fontFamily: 'ui-monospace,Menlo,monospace', color: TEXT_FAINT, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {path}
          </button>
        </div>
        <div style={{ padding: '10px 14px 14px', fontSize: 13, color: TEXT_DIM }} dangerouslySetInnerHTML={{ __html: md(body) }} />
      </div>
    </div>
  )
}

// ─── CasesView（测例）────────────────────────────────────────────────────────
//
// 一图一份 `qa/cases.md`（to-qa-testcases 产出），单列在地图「🧪 测例」子页。
// 不拆文件：测例是批量设计文档，§0-§2 的被测对象/七源盘点/覆盖矩阵是共享
// 上下文；单用例需要独立跟踪时它已升级为缺陷（拆出去的是缺陷不是测例）。

function CasesView({ cases, scope, ctx, readOnly }: { cases: ParsedTicket[]; scope: SessionScope; ctx: any; readOnly?: boolean }) {
  if (cases.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, padding: 24, textAlign: 'center' }}>
        当前图没有测例文档。
        <br />
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>{'`to-qa-testcases` 产出的 `.plan/<effort>/qa/cases.md` 会按图列在这里（一图一份，不拆文件）。'}</span>
      </div>
    )
  }
  // 滚动修复（2026-10-02 实测定位）：本视图同时是「flex 列容器」+「滚动容器」。
  // 卡片的默认 flex-shrink:1 会被 flexbox 压到刚好塞满容器，scrollHeight 恒等于
  // clientHeight——没有任何可滚余量（Chrome 实测：1500px 内容得 client=scroll=536、
  // canScroll=false；同为 flex 列滚动容器但子项 flex-shrink:0 时 canScroll=true）。
  // 所以这不是 min-height 问题：min-height:0 与 min-height:auto 实测同结果，
  // 单补 minHeight:0 无效（44d7c2a 的同类修法在此不适用）。
  //
  // 修法＝「外层管高度、内层管滚动」分离式（同 LedgerView/DefectView 既有范式）：
  // 外层只负责在父容器里占住受限高度；内层 overflowY:auto 是普通块级滚动容器，
  // 块级布局不做 flex 压缩，内容多高 scrollHeight 就多高，滚动自然成立。
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <style>{MD_CSS}</style>
        {cases.map(c => (
          <div key={`${c.effort}/${c.file}`} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, background: HEADER_BG }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>🧪 {c.title}</span>
              <FilePath ticket={c} scope={scope} ctx={ctx} />
            </div>
            <div style={{ padding: '10px 14px 14px', fontSize: 13, color: TEXT_DIM }} dangerouslySetInnerHTML={{ __html: md(c.body) }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ADR view（2026-09-30 拍板①：docs/adr 纳入全局层展示）────────────────────
//
// ADR 是知识层（落点 docs/adr/NNNN-<slug>.md，格式正本 domain-modeling/
// ADR-FORMAT.md），原地自维护、不入治理目录——本页只读展示，不参与派活。
// Status 词表按 ADR-FORMAT；原版 Status 是 optional，缺省按「未标」呈现，
// 不阻塞展示（09-28 必填化拍板是记录层口径，执行文本尚未收编）。

const ADR_STATUS_META: Record<string, { label: string; color: string }> = {
  proposed: { label: 'proposed', color: '#f7ad31' },
  accepted: { label: 'accepted', color: '#4ed17e' },
  deprecated: { label: 'deprecated', color: '#f2555a' },
  superseded: { label: 'superseded', color: '#f2555a' },
}

function AdrView({ adrs, scope, ctx }: { adrs: ParsedTicket[]; scope: SessionScope; ctx: any }) {
  const sorted = useMemo(() => [...adrs].sort((a, b) => a.id.localeCompare(b.id)), [adrs])
  if (sorted.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: TEXT_FAINT, padding: 24, textAlign: 'center' }}>
        本仓仓根暂无 <code>docs/adr/</code>。
        <br />
        <span style={{ fontSize: 12, color: TEXT_FAINT }}>{'架构决策记录落 `docs/adr/NNNN-<slug>.md`（格式正本 domain-modeling/ADR-FORMAT.md），落第一份后本页自动呈现。'}</span>
      </div>
    )
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{MD_CSS}</style>
      {sorted.map(a => {
        const s = ADR_STATUS_META[statusWord(a)]
        const num = a.id.match(/^(\d{4})/)?.[1] ?? a.id
        const title = a.title.replace(/^(?:ADR[-:\s]*)?\d{4}[-:\s]+/, '') || a.title
        return (
          <div key={a.path ?? a.file} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: CARD, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, background: HEADER_BG, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, fontWeight: 700, color: ACCENT_SOFT }}>ADR-{num}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{title}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, border: `1px solid ${s ? `${s.color}55` : '#555'}`, color: s ? s.color : '#999' }}>{s ? s.label : '未标'}</span>
              {a.date && <span style={{ fontSize: 11, color: TEXT_FAINT }}>{a.date}</span>}
              <FilePath ticket={a} scope={scope} ctx={ctx} />
            </div>
            <div style={{ padding: '10px 14px 14px', fontSize: 13, color: TEXT_DIM }} dangerouslySetInnerHTML={{ __html: md(a.body) }} />
          </div>
        )
      })}
    </div>
  )
}
