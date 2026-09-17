import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region ../../../../dsh-plugin/packages/dsh-plan-view/src/client/api.ts
async function call(method, payload) {
	const resp = await fetch(`/sidebar/api/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload)
	});
	const parsed = await resp.json();
	if (!resp.ok || parsed?.ok !== true || parsed?.value === void 0) throw new Error(parsed?.error?.message ?? `HTTP ${resp.status}`);
	return parsed.value;
}
function scopePayload(scope, extra) {
	return {
		sessionId: scope.sessionId,
		...scope.cwd != null ? { cwd: scope.cwd } : {},
		...extra
	};
}
async function fsTree(scope, path) {
	return call("fs.tree", scopePayload(scope, { path }));
}
async function fsRead(scope, path) {
	return call("fs.read", scopePayload(scope, { path }));
}
//#endregion
//#region ../../../../dsh-plugin/packages/dsh-plan-view/src/client/PlanView.tsx
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
function parseFrontmatter(raw) {
	const fm = {};
	let body = raw;
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (m && m[1] != null) {
		for (const line of m[1].split("\n")) {
			const kv = line.match(/^([^:]+):\s*(.*)$/);
			if (kv?.[1] != null && kv?.[2] != null) fm[kv[1].trim()] = kv[2].trim();
		}
		body = m[2] ?? "";
	}
	return {
		fm,
		body
	};
}
function deriveTicketStatus(file, raw) {
	const { fm, body } = parseFrontmatter(raw);
	const hasAnswer = /^## Answer\b/m.test(body) && /^## Answer\b[\s\S]*\n\S/m.test(body);
	const hasRuledOut = /^## Ruled out\b/m.test(body) && /^## Ruled out\b[\s\S]*\n\S/m.test(body);
	const titleMatch = raw.match(/^#\s+(.+)$/m);
	return {
		id: ticketId(file),
		file,
		title: titleMatch?.[1]?.replace(/`[^`]*`/g, "")?.trim() ?? file,
		type: fm.type,
		blockedBy: parseBlockedBy(fm.blocked_by),
		resolved: hasAnswer,
		outOfScope: hasRuledOut,
		claimedBy: fm.claimed_by,
		status: fm.status,
		date: fm.date,
		origin: fm.origin,
		body
	};
}
const DONE_STATUS = new Set([
	"done",
	"closed",
	"resolved",
	"complete",
	"completed",
	"shipped"
]);
const OUT_STATUS = new Set([
	"abandoned",
	"rejected",
	"wontfix",
	"won't fix",
	"cancelled",
	"canceled",
	"superseded"
]);
const CLAIMED_STATUS = new Set([
	"doing",
	"in_progress",
	"in-progress",
	"wip",
	"claimed",
	"in review",
	"review"
]);
function statusWord(t) {
	const raw = (t.status ?? "").trim().toLowerCase();
	if (raw.startsWith("superseded-by")) return "superseded";
	return raw.split(/[\s(#:—-]/)[0] ?? "";
}
function displayStatus(t) {
	if (t.outOfScope) return "out_of_scope";
	if (t.resolved) return "resolved";
	const w = statusWord(t);
	if (DONE_STATUS.has(w)) return "resolved";
	if (OUT_STATUS.has(w)) return "out_of_scope";
	if (t.claimedBy) return "claimed";
	if (CLAIMED_STATUS.has(w)) return "claimed";
	return "open";
}
function ticketId(file) {
	return file.replace(/\.md$/i, "");
}
function shortId(t) {
	return (t.id.match(/^([A-Za-z]*\d+)/)?.[1] ?? t.id).slice(0, 4).toUpperCase();
}
function normalizeRef(raw) {
	return ticketId(raw.trim().replace(/^["']|["']$/g, "").split("/").pop() ?? "");
}
function parseBlockedBy(value) {
	return (value ?? "").replace(/[\[\]]/g, "").split(",").map(normalizeRef).filter(Boolean);
}
function resolveRef(ref, byId) {
	if (byId.has(ref)) return ref;
	if (/^\d+$/.test(ref)) {
		const padded = ref.padStart(2, "0");
		if (byId.has(padded)) return padded;
	}
	for (const id of byId.keys()) if (id === ref || id.startsWith(`${ref}-`) || id.split("-")[0] === ref) return id;
}
function escapeHtml(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Inline spans: code, bold, italic, links. Runs on already-escaped text. */
function inline(s) {
	return s.replace(/`([^`]+)`/g, "<code class=\"pvm-code\">$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a class=\"pvm-a\" href=\"$2\" target=\"_blank\" rel=\"noreferrer\">$1</a>");
}
const splitRow = (line) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isDivider = (line) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
function md(text) {
	const lines = text.split("\n");
	const out = [];
	let i = 0;
	let para = [];
	let list = [];
	let olist = [];
	let quote = [];
	const flushPara = () => {
		if (para.length) {
			out.push(`<p class="pvm-p">${para.map(inline).join("<br/>")}</p>`);
			para = [];
		}
	};
	const flushList = () => {
		if (list.length) {
			out.push(`<ul class="pvm-ul">${list.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
			list = [];
		}
	};
	const flushOlist = () => {
		if (olist.length) {
			out.push(`<ol class="pvm-ol">${olist.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
			olist = [];
		}
	};
	const flushQuote = () => {
		if (quote.length) {
			out.push(`<blockquote class="pvm-quote">${quote.map(inline).join("<br/>")}</blockquote>`);
			quote = [];
		}
	};
	const flushAll = () => {
		flushPara();
		flushList();
		flushOlist();
		flushQuote();
	};
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (line.match(/^\s*```(\w*)\s*$/)) {
			flushAll();
			const buf = [];
			i++;
			while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) {
				buf.push(lines[i] ?? "");
				i++;
			}
			i++;
			out.push(`<pre class="pvm-pre"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
			continue;
		}
		if (line.includes("|") && isDivider(lines[i + 1] ?? "")) {
			flushAll();
			const head = splitRow(line);
			i += 2;
			const body = [];
			while (i < lines.length && (lines[i] ?? "").includes("|") && !/^\s*$/.test(lines[i] ?? "")) {
				body.push(splitRow(lines[i] ?? ""));
				i++;
			}
			out.push("<div class=\"pvm-tw\"><table class=\"pvm-table\"><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" + body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + "</tbody></table></div>");
			continue;
		}
		const h = line.match(/^(#{1,6})\s+(.*)$/);
		if (h && h[1] && h[2] !== void 0) {
			flushAll();
			const lvl = h[1].length;
			const tag = lvl <= 1 ? "h2" : lvl === 2 ? "h3" : "h4";
			out.push(`<${tag} class="pvm-h">${inline(h[2])}</${tag}>`);
			i++;
			continue;
		}
		if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
			flushAll();
			out.push("<hr class=\"pvm-hr\"/>");
			i++;
			continue;
		}
		const q = line.match(/^>\s?(.*)$/);
		if (q) {
			flushPara();
			flushList();
			flushOlist();
			quote.push(q[1] ?? "");
			i++;
			continue;
		}
		const ul = line.match(/^\s*[-*+]\s+(.*)$/);
		if (ul) {
			flushPara();
			flushOlist();
			flushQuote();
			list.push(ul[1] ?? "");
			i++;
			continue;
		}
		const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
		if (ol) {
			flushPara();
			flushList();
			flushQuote();
			olist.push(ol[1] ?? "");
			i++;
			continue;
		}
		if (/^\s*$/.test(line)) {
			flushAll();
			i++;
			continue;
		}
		flushList();
		flushOlist();
		flushQuote();
		para.push(line);
		i++;
	}
	flushAll();
	return out.join("");
}
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
`;
const TYPE_THEME = {
	research: {
		icon: "🔍",
		color: ACCENT
	},
	grilling: {
		icon: "🔥",
		color: "#f2555a"
	},
	prototype: {
		icon: "🛠️",
		color: "#f7ad31"
	},
	task: {
		icon: "⚡",
		color: ACCENT_SOFT
	}
};
const TYPE_FALLBACK = {
	icon: "•",
	color: "#888"
};
const NO_TYPE = "\0no-type";
const typeTheme = (t) => TYPE_THEME[t ?? ""] ?? TYPE_FALLBACK;
const DOT = {
	open: "#81858c",
	claimed: "#f7ad31",
	resolved: "#4ed17e",
	out_of_scope: "#61666b"
};
const STATUS_LABELS = {
	open: "Open",
	claimed: "Claimed",
	resolved: "Resolved",
	out_of_scope: "Out of scope"
};
const STATUS_ORDER = [
	"open",
	"claimed",
	"resolved",
	"out_of_scope"
];
/** Approval documents are `type: approval`, or any doc carrying a pending-style status. */
function ticketKind(t) {
	const ty = (t.type ?? "").trim().toLowerCase();
	if (ty === "approval") return "approval";
	if (isPending(t)) return "approval";
	if (ty === "spec" || ty === "design" || /^(map|readme|index)$/i.test(t.id)) return "note";
	if (!ty && !t.status) return "note";
	return "ticket";
}
const KIND_META = {
	ticket: {
		label: "工单",
		icon: "🎫",
		color: ACCENT_SOFT
	},
	approval: {
		label: "待拍板",
		icon: "⏳",
		color: "#f7ad31"
	},
	note: {
		label: "说明",
		icon: "📄",
		color: TEXT_FAINT
	}
};
/** Frontmatter `status` marks a document as an approval awaiting a ruling. */
function isPending(t) {
	return statusWord(t) === "pending";
}
/** Whole days since the document's `date`. Undefined when there is no usable date. */
function ageDays(t) {
	if (!t.date) return void 0;
	const then = Date.parse(t.date);
	if (Number.isNaN(then)) return void 0;
	return Math.max(0, Math.floor((Date.now() - then) / 864e5));
}
function ageLabel(t) {
	const d = ageDays(t);
	if (d === void 0) return void 0;
	if (d === 0) return "今天";
	return `挂了 ${d} 天`;
}
const BG = "#151517";
const HEADER_BG = "#1b1b1c";
const CARD = "#232324";
const CARD_DARK = "#1f1f20";
const RAISED = "#2c2c2e";
const TEXT = "#e9ecf2";
const TEXT_DIM = "#adb2b8";
const TEXT_FAINT = "#81858c";
const BORDER = "rgba(255,255,255,.10)";
const BORDER_LIGHT = "rgba(255,255,255,.06)";
const ACCENT = "#4176e6";
const ACCENT_SOFT = "#609bfa";
const CHIP_BG = "rgba(255,255,255,.07)";
const mdEntries = (tree) => tree.entries.filter((e) => e.name.endsWith(".md") && !e.isDir);
async function collectTicketFiles(scope, effortDir) {
	const tree = await fsTree(scope, effortDir);
	const inTickets = tree.entries.find((e) => e.isDir && e.name === "tickets");
	if (inTickets) {
		const found = mdEntries(await fsTree(scope, inTickets.path));
		if (found.length > 0) return found;
	}
	const NON_TICKET = /^(map|spec|tech-spec|fe-v1-spec|readme)\.md$/i;
	const here = mdEntries(tree).filter((e) => !NON_TICKET.test(e.name));
	const subs = await Promise.all(tree.entries.filter((e) => e.isDir && !e.hidden && e.name !== "tickets" && e.name !== "node_modules").map(async (d) => mdEntries(await fsTree(scope, d.path)).filter((e) => !NON_TICKET.test(e.name))));
	return [...here, ...subs.flat()];
}
function classify(t) {
	return ticketKind(t);
}
async function loadPlan(scope, planDir) {
	const rootTree = await fsTree(scope, planDir);
	const hasMapHere = rootTree.entries.some((e) => e.name === "map.md" && !e.isDir);
	const subDirs = rootTree.entries.filter((e) => e.isDir && !e.hidden && e.name !== "node_modules");
	const effortDirs = (await Promise.all(subDirs.map(async (d) => (await fsTree(scope, d.path)).entries.some((e) => e.name === "map.md" && !e.isDir) ? d.path : null))).filter((p) => p !== null);
	const allEfforts = hasMapHere ? [planDir, ...effortDirs] : effortDirs;
	const [mapRaws, ...fileGroups] = await Promise.all([
		Promise.all(allEfforts.map((d) => fsRead(scope, `${d}/map.md`))),
		Promise.resolve(mdEntries(rootTree)),
		...effortDirs.map((d) => collectTicketFiles(scope, d))
	]);
	const efforts = allEfforts.map((dir, i) => ({
		dir,
		mapRaw: mapRaws[i]?.kind === "text" ? mapRaws[i].content : ""
	}));
	const seen = /* @__PURE__ */ new Set();
	const mdFiles = [];
	for (const e of fileGroups.flat()) {
		if (seen.has(e.path)) continue;
		seen.add(e.path);
		mdFiles.push(e);
	}
	const raws = await Promise.all(mdFiles.map((e) => fsRead(scope, e.path).then((r) => r.kind === "text" ? r.content : "")));
	const tickets = mdFiles.map((e, i) => ({
		...deriveTicketStatus(e.name, raws[i] ?? ""),
		path: e.path
	}));
	const primary = efforts.find((e) => e.mapRaw !== "") ?? efforts[0];
	return {
		tickets,
		effortDir: primary?.dir ?? planDir,
		mapRaw: primary?.mapRaw ?? null,
		efforts
	};
}
function DetailModal({ ticket, planDir, scope, onClose }) {
	const [fullBody, setFullBody] = useState(null);
	useEffect(() => {
		let alive = true;
		fsRead(scope, ticket.path ?? `${planDir}/tickets/${ticket.file}`).then((r) => {
			if (alive && r.kind === "text") setFullBody(parseFrontmatter(r.content).body);
		});
		return () => {
			alive = false;
		};
	}, [
		ticket.file,
		ticket.path,
		planDir,
		scope
	]);
	const body = fullBody ?? ticket.body;
	useEffect(() => {
		const onKey = (e) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return /* @__PURE__ */ jsx("div", {
		style: {
			position: "fixed",
			inset: 0,
			background: "rgba(0,0,0,.6)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			zIndex: 100
		},
		onClick: onClose,
		children: /* @__PURE__ */ jsxs("div", {
			style: {
				width: "min(1080px, 94vw)",
				maxHeight: "88vh",
				display: "flex",
				flexDirection: "column",
				background: HEADER_BG,
				border: `1px solid ${BORDER}`,
				borderRadius: 14,
				boxShadow: "0 16px 48px rgba(0,0,0,.55)"
			},
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ jsx("style", { children: MD_CSS }),
				/* @__PURE__ */ jsxs("div", {
					style: {
						padding: "16px 20px 0",
						display: "flex",
						alignItems: "center",
						gap: 8
					},
					children: [
						/* @__PURE__ */ jsx("span", {
							style: { color: DOT[displayStatus(ticket)] },
							children: typeTheme(ticket.type).icon
						}),
						/* @__PURE__ */ jsx("span", {
							style: {
								fontSize: 16,
								fontWeight: 700,
								color: TEXT,
								lineHeight: 1.4,
								flex: 1
							},
							children: ticket.title
						}),
						/* @__PURE__ */ jsx("button", {
							style: {
								background: "transparent",
								border: "none",
								color: "#888",
								fontSize: 18,
								cursor: "pointer"
							},
							onClick: onClose,
							children: "✕"
						})
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					style: {
						padding: "0 20px 12px",
						display: "flex",
						gap: 6,
						flexWrap: "wrap",
						marginTop: 8,
						borderBottom: `1px solid ${BORDER_LIGHT}`
					},
					children: [
						/* @__PURE__ */ jsxs("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: CHIP_BG,
								color: "#888",
								border: `1px solid ${BORDER}`
							},
							children: ["#", shortId(ticket)]
						}),
						/* @__PURE__ */ jsxs("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: `${KIND_META[ticketKind(ticket)].color}22`,
								color: KIND_META[ticketKind(ticket)].color
							},
							children: [
								KIND_META[ticketKind(ticket)].icon,
								" ",
								KIND_META[ticketKind(ticket)].label
							]
						}),
						ticket.type && /* @__PURE__ */ jsx("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: `${typeTheme(ticket.type).color}22`,
								color: typeTheme(ticket.type).color
							},
							children: ticket.type
						}),
						/* @__PURE__ */ jsx("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: CHIP_BG,
								color: DOT[displayStatus(ticket)],
								border: `1px solid ${BORDER}`
							},
							children: STATUS_LABELS[displayStatus(ticket)]
						}),
						ticket.claimedBy && /* @__PURE__ */ jsxs("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: "#f0a50022",
								color: "#f7ad31"
							},
							children: ["👤 ", ticket.claimedBy]
						}),
						ticket.status && /* @__PURE__ */ jsxs("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: CHIP_BG,
								color: "#aaa",
								border: `1px solid ${BORDER}`
							},
							children: ["status: ", ticket.status]
						}),
						ageLabel(ticket) && /* @__PURE__ */ jsx("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: "#ffa94d22",
								color: "#f7ad31"
							},
							children: ageLabel(ticket)
						}),
						ticket.origin && /* @__PURE__ */ jsxs("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: CHIP_BG,
								color: "#888",
								border: `1px solid ${BORDER}`
							},
							children: ["origin: ", ticket.origin]
						}),
						ticket.blockedBy.length > 0 && /* @__PURE__ */ jsxs("span", {
							style: {
								fontSize: 11,
								padding: "2px 9px",
								borderRadius: 999,
								background: "#ff6b6b22",
								color: "#f2555a"
							},
							children: ["blocked_by: ", ticket.blockedBy.map((n) => `#${n}`).join(", ")]
						})
					]
				}),
				/* @__PURE__ */ jsx("div", {
					style: {
						flex: 1,
						overflowY: "auto",
						padding: "14px 20px 20px",
						fontSize: 13,
						color: TEXT_DIM
					},
					dangerouslySetInnerHTML: { __html: md(body) }
				})
			]
		})
	});
}
function ViewA({ tickets, planDir, scope, destination }) {
	const [focus, setFocus] = useState(null);
	const groups = useMemo(() => {
		const g = {
			resolved: [],
			out_of_scope: [],
			claimed: [],
			open: []
		};
		for (const t of tickets) g[displayStatus(t)].push(t);
		return g;
	}, [tickets]);
	const waiting = useMemo(() => tickets.filter(isPending).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)), [tickets]);
	const active = tickets.filter((t) => !t.outOfScope);
	const done = tickets.filter((t) => t.resolved).length;
	const pct = active.length > 0 ? Math.round(done / active.length * 100) : 0;
	return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			background: BG,
			color: TEXT
		},
		children: [
			/* @__PURE__ */ jsxs("div", {
				style: {
					padding: "12px 16px 0",
					display: "flex",
					justifyContent: "space-between"
				},
				children: [/* @__PURE__ */ jsx("span", {
					style: {
						fontSize: 14,
						fontWeight: 700
					},
					children: "Kanban"
				}), /* @__PURE__ */ jsxs("span", {
					style: {
						fontSize: 12,
						color: "#888"
					},
					children: [
						tickets.length,
						" tickets · ",
						done,
						" resolved"
					]
				})]
			}),
			waiting.length > 0 && /* @__PURE__ */ jsxs("div", {
				style: {
					margin: "8px 16px 0",
					padding: "8px 12px",
					borderRadius: 8,
					background: "#3a2410",
					border: "1px solid #7a4a15",
					fontSize: 13
				},
				children: [/* @__PURE__ */ jsxs("div", {
					style: {
						fontWeight: 700,
						color: "#f7ad31",
						marginBottom: 4
					},
					children: [
						"⏳ 等你拍板（",
						waiting.length,
						"）"
					]
				}), /* @__PURE__ */ jsx("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 3
					},
					children: waiting.map((t) => /* @__PURE__ */ jsxs("div", {
						onClick: () => setFocus(t),
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							cursor: "pointer",
							color: "#e8c9a0"
						},
						children: [
							/* @__PURE__ */ jsx("span", {
								style: {
									fontFamily: "monospace",
									fontSize: 11,
									color: "#f7ad31"
								},
								children: shortId(t)
							}),
							/* @__PURE__ */ jsx("span", {
								style: {
									flex: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: t.title
							}),
							ageLabel(t) && /* @__PURE__ */ jsx("span", {
								style: {
									fontSize: 11,
									color: "#f7ad31",
									flexShrink: 0
								},
								children: ageLabel(t)
							})
						]
					}, t.id))
				})]
			}),
			destination && /* @__PURE__ */ jsx("div", {
				style: {
					margin: "8px 16px 0",
					padding: "8px 12px",
					borderRadius: 8,
					background: HEADER_BG,
					border: `1px solid ${BORDER}`,
					color: "#aaa",
					fontSize: 13
				},
				children: destination
			}),
			/* @__PURE__ */ jsxs("div", {
				style: {
					margin: "8px 16px 0",
					display: "flex",
					alignItems: "center",
					gap: 10
				},
				children: [/* @__PURE__ */ jsx("div", {
					style: {
						flex: 1,
						height: 6,
						borderRadius: 3,
						background: CHIP_BG,
						border: `1px solid ${BORDER}`,
						overflow: "hidden"
					},
					children: /* @__PURE__ */ jsx("div", { style: {
						height: "100%",
						width: `${pct}%`,
						borderRadius: 3,
						background: `linear-gradient(90deg, #4ed17e, ${ACCENT})`
					} })
				}), /* @__PURE__ */ jsxs("span", {
					style: {
						fontSize: 12,
						fontWeight: 700,
						color: "#4ed17e",
						minWidth: 36,
						textAlign: "right"
					},
					children: [pct, "%"]
				})]
			}),
			/* @__PURE__ */ jsx("div", {
				style: {
					flex: 1,
					display: "flex",
					gap: 10,
					padding: "12px 16px",
					overflowX: "auto"
				},
				children: STATUS_ORDER.filter((s) => groups[s].length > 0).map((s) => /* @__PURE__ */ jsxs("div", {
					style: {
						flex: "1 1 0",
						minWidth: 200,
						display: "flex",
						flexDirection: "column",
						background: BG,
						border: `1px solid ${BORDER_LIGHT}`,
						borderRadius: 10,
						overflow: "hidden"
					},
					children: [/* @__PURE__ */ jsxs("div", {
						style: {
							padding: "7px 10px",
							display: "flex",
							alignItems: "center",
							gap: 7,
							borderBottom: `1px solid ${BORDER_LIGHT}`,
							background: HEADER_BG
						},
						children: [
							/* @__PURE__ */ jsx("span", { style: {
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: DOT[s]
							} }),
							/* @__PURE__ */ jsx("span", {
								style: {
									fontWeight: 700,
									fontSize: 12
								},
								children: STATUS_LABELS[s]
							}),
							/* @__PURE__ */ jsx("span", {
								style: {
									fontSize: 11,
									color: "#888"
								},
								children: groups[s].length
							})
						]
					}), /* @__PURE__ */ jsx("div", {
						style: {
							flex: 1,
							overflowY: "auto",
							padding: 6,
							display: "flex",
							flexDirection: "column",
							gap: 6
						},
						children: groups[s].map((t) => /* @__PURE__ */ jsxs("div", {
							style: {
								padding: 8,
								borderRadius: 8,
								background: CARD,
								border: `1px solid ${BORDER}`,
								cursor: "pointer"
							},
							onClick: () => setFocus(t),
							children: [/* @__PURE__ */ jsxs("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 6
								},
								children: [
									/* @__PURE__ */ jsx("span", {
										style: {
											fontSize: 10,
											fontFamily: "monospace",
											color: "#888",
											background: CHIP_BG,
											borderRadius: 999,
											minWidth: 20,
											height: 20,
											padding: "0 4px",
											boxSizing: "border-box",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontWeight: 700
										},
										children: shortId(t)
									}),
									/* @__PURE__ */ jsx("span", {
										style: { fontSize: 12 },
										children: KIND_META[ticketKind(t)].icon
									}),
									/* @__PURE__ */ jsx("span", {
										style: {
											flex: 1,
											fontSize: 12,
											fontWeight: 600,
											lineHeight: 1.3,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap"
										},
										children: t.title
									})
								]
							}), /* @__PURE__ */ jsxs("div", {
								style: {
									display: "flex",
									gap: 4,
									marginTop: 6,
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ jsxs("span", {
										style: {
											fontSize: 10,
											padding: "1px 5px",
											borderRadius: 999,
											background: `${KIND_META[ticketKind(t)].color}22`,
											color: KIND_META[ticketKind(t)].color
										},
										children: [
											KIND_META[ticketKind(t)].icon,
											" ",
											KIND_META[ticketKind(t)].label
										]
									}),
									t.type && /* @__PURE__ */ jsx("span", {
										style: {
											fontSize: 10,
											padding: "1px 5px",
											borderRadius: 999,
											background: `${typeTheme(t.type).color}22`,
											color: typeTheme(t.type).color
										},
										children: t.type
									}),
									isPending(t) && /* @__PURE__ */ jsx("span", {
										style: {
											fontSize: 10,
											padding: "1px 5px",
											borderRadius: 999,
											background: "#ffa94d33",
											color: "#f7ad31"
										},
										children: ageLabel(t) ?? "待拍板"
									}),
									t.claimedBy && /* @__PURE__ */ jsxs("span", {
										style: {
											fontSize: 10,
											padding: "1px 5px",
											borderRadius: 999,
											background: "#f0a50022",
											color: "#f7ad31"
										},
										children: ["👤 ", t.claimedBy]
									}),
									t.blockedBy.length > 0 && /* @__PURE__ */ jsxs("span", {
										style: {
											fontSize: 10,
											padding: "1px 5px",
											borderRadius: 999,
											background: "#ff6b6b22",
											color: "#f2555a"
										},
										children: [" ", t.blockedBy.map((n) => `#${n}`).join(",")]
									})
								]
							})]
						}, t.file))
					})]
				}, s))
			}),
			focus && /* @__PURE__ */ jsx(DetailModal, {
				ticket: focus,
				planDir,
				scope,
				onClose: () => setFocus(null)
			})
		]
	});
}
function ViewC({ tickets, planDir, scope }) {
	const [query, setQuery] = useState("");
	const OUTSTANDING = ["open", "claimed"];
	const [statusSet, setStatusSet] = useState(() => new Set(OUTSTANDING));
	const allTypes = useMemo(() => {
		const named = [...new Set(tickets.map((t) => t.type).filter((x) => !!x))].sort();
		return tickets.some((t) => !t.type) ? [...named, NO_TYPE] : named;
	}, [tickets]);
	const [typeSet, setTypeSet] = useState(() => new Set(Object.keys(TYPE_THEME)));
	const [kindSet, setKindSet] = useState(() => new Set([
		"ticket",
		"approval",
		"note"
	]));
	const typeInit = useRef(false);
	useEffect(() => {
		if (typeInit.current || tickets.length === 0) return;
		typeInit.current = true;
		setTypeSet(new Set(allTypes));
	}, [allTypes, tickets.length]);
	const [onlyBlocked, setOnlyBlocked] = useState(false);
	const [sort, setSort] = useState({
		key: "num",
		dir: 1
	});
	const [detail, setDetail] = useState(null);
	const rows = useMemo(() => {
		let out = tickets.filter((t) => {
			if (onlyBlocked && t.blockedBy.length === 0) return false;
			if (!statusSet.has(displayStatus(t))) return false;
			if (!kindSet.has(ticketKind(t))) return false;
			if (allTypes.length > 0 && !typeSet.has(t.type ?? NO_TYPE)) return false;
			if (query && !`${t.title} ${t.body} ${t.claimedBy ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
			return true;
		});
		out = [...out].sort((a, b) => {
			let v = 0;
			if (sort.key === "num") v = a.id.localeCompare(b.id, void 0, { numeric: true });
			else if (sort.key === "status") v = STATUS_ORDER.indexOf(displayStatus(a)) - STATUS_ORDER.indexOf(displayStatus(b));
			else if (sort.key === "kind") v = ticketKind(a).localeCompare(ticketKind(b));
			else v = (a.type ?? "").localeCompare(b.type ?? "");
			return v * sort.dir;
		});
		return out;
	}, [
		tickets,
		query,
		statusSet,
		typeSet,
		kindSet,
		onlyBlocked,
		sort
	]);
	const toggle = (set, v) => {
		const nx = new Set(set);
		if (nx.has(v)) nx.delete(v);
		else nx.add(v);
		return nx;
	};
	const sortBy = (key) => setSort((s) => s.key === key ? {
		key,
		dir: s.dir === 1 ? -1 : 1
	} : {
		key,
		dir: 1
	});
	const arrow = (key) => sort.key === key ? sort.dir === 1 ? " ↑" : " ↓" : "";
	return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			background: BG,
			color: TEXT
		},
		children: [
			/* @__PURE__ */ jsxs("div", {
				style: {
					padding: "10px 16px",
					background: HEADER_BG,
					borderBottom: `1px solid ${BORDER}`,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 10
				},
				children: [/* @__PURE__ */ jsx("span", {
					style: {
						fontSize: 14,
						fontWeight: 700
					},
					children: "Table"
				}), /* @__PURE__ */ jsxs("span", {
					style: {
						fontSize: 12,
						color: "#888"
					},
					children: [
						rows.length,
						"/",
						tickets.length,
						" tickets",
						statusSet.size < STATUS_ORDER.length && /* @__PURE__ */ jsx("span", {
							style: { color: "#666" },
							children: "（默认隐藏已完成；勾 Status 里的 Resolved 可看）"
						})
					]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				style: {
					flex: 1,
					display: "flex",
					overflow: "hidden"
				},
				children: [/* @__PURE__ */ jsxs("div", {
					style: {
						width: 200,
						flexShrink: 0,
						background: HEADER_BG,
						borderRight: `1px solid ${BORDER}`,
						padding: 12,
						display: "flex",
						flexDirection: "column",
						gap: 14,
						overflowY: "auto"
					},
					children: [
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
							style: {
								fontSize: 10,
								fontWeight: 700,
								color: "#777",
								textTransform: "uppercase",
								marginBottom: 4
							},
							children: "Search"
						}), /* @__PURE__ */ jsx("input", {
							style: {
								width: "100%",
								padding: "5px 8px",
								borderRadius: 6,
								border: `1px solid ${BORDER}`,
								background: HEADER_BG,
								color: TEXT,
								fontSize: 12,
								outline: "none",
								boxSizing: "border-box"
							},
							placeholder: "title / body / owner…",
							value: query,
							onChange: (e) => setQuery(e.target.value)
						})] }),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
							style: {
								fontSize: 10,
								fontWeight: 700,
								color: "#777",
								textTransform: "uppercase",
								marginBottom: 4
							},
							children: "Status"
						}), STATUS_ORDER.map((s) => /* @__PURE__ */ jsxs("label", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6,
								fontSize: 12,
								color: TEXT_DIM,
								cursor: "pointer",
								padding: "1px 0"
							},
							children: [
								/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									checked: statusSet.has(s),
									onChange: () => setStatusSet(toggle(statusSet, s))
								}),
								/* @__PURE__ */ jsx("span", {
									style: { color: DOT[s] },
									children: "●"
								}),
								" ",
								STATUS_LABELS[s]
							]
						}, s))] }),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
							style: {
								fontSize: 10,
								fontWeight: 700,
								color: "#777",
								textTransform: "uppercase",
								marginBottom: 4
							},
							children: "Kind"
						}), /* @__PURE__ */ jsx("div", {
							style: {
								display: "flex",
								flexWrap: "wrap",
								gap: 4
							},
							children: [
								"ticket",
								"approval",
								"note"
							].map((k) => {
								const meta = KIND_META[k];
								const on = kindSet.has(k);
								return /* @__PURE__ */ jsxs("span", {
									style: {
										fontSize: 10,
										padding: "2px 7px",
										borderRadius: 999,
										cursor: "pointer",
										border: `1px solid ${meta.color}`,
										color: on ? "#fff" : meta.color,
										background: on ? meta.color : "transparent"
									},
									onClick: () => setKindSet(toggle(kindSet, k)),
									children: [
										meta.icon,
										" ",
										meta.label
									]
								}, k);
							})
						})] }),
						/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
							style: {
								fontSize: 10,
								fontWeight: 700,
								color: "#777",
								textTransform: "uppercase",
								marginBottom: 4
							},
							children: "Type"
						}), /* @__PURE__ */ jsx("div", {
							style: {
								display: "flex",
								flexWrap: "wrap",
								gap: 4
							},
							children: allTypes.map((t) => {
								const theme = t === NO_TYPE ? {
									icon: "∅",
									color: TEXT_FAINT
								} : typeTheme(t);
								const on = typeSet.has(t);
								const label = t === NO_TYPE ? "（无 type）" : t;
								return /* @__PURE__ */ jsxs("span", {
									style: {
										fontSize: 10,
										padding: "2px 7px",
										borderRadius: 999,
										cursor: "pointer",
										border: `1px solid ${theme.color}`,
										color: on ? "#fff" : theme.color,
										background: on ? theme.color : "transparent"
									},
									onClick: () => setTypeSet(toggle(typeSet, t)),
									children: [
										theme.icon,
										" ",
										label
									]
								}, t);
							})
						})] }),
						/* @__PURE__ */ jsxs("label", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6,
								fontSize: 12,
								color: TEXT_DIM,
								cursor: "pointer"
							},
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								checked: onlyBlocked,
								onChange: (e) => setOnlyBlocked(e.target.checked)
							}), " Only blocked"]
						}),
						/* @__PURE__ */ jsx("button", {
							style: {
								marginTop: "auto",
								padding: "6px 0",
								borderRadius: 6,
								border: `1px solid ${BORDER}`,
								background: HEADER_BG,
								color: "#888",
								cursor: "pointer",
								fontSize: 11
							},
							onClick: () => {
								setQuery("");
								setStatusSet(new Set(OUTSTANDING));
								setTypeSet(new Set(allTypes));
								setKindSet(new Set([
									"ticket",
									"approval",
									"note"
								]));
								setOnlyBlocked(false);
							},
							children: "Reset"
						})
					]
				}), /* @__PURE__ */ jsx("div", {
					style: {
						flex: 1,
						overflowY: "auto",
						padding: 12
					},
					children: rows.length === 0 ? /* @__PURE__ */ jsx("div", {
						style: {
							padding: 40,
							textAlign: "center",
							color: TEXT_FAINT
						},
						children: "No matching tickets"
					}) : /* @__PURE__ */ jsxs("table", {
						style: {
							width: "100%",
							borderCollapse: "separate",
							borderSpacing: 0,
							background: HEADER_BG,
							borderRadius: 8,
							overflow: "hidden",
							fontSize: 12
						},
						children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
							/* @__PURE__ */ jsxs("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG,
									cursor: "pointer"
								},
								onClick: () => sortBy("num"),
								children: ["# ", arrow("num")]
							}),
							/* @__PURE__ */ jsx("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG
								},
								children: "Title"
							}),
							/* @__PURE__ */ jsxs("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG,
									cursor: "pointer"
								},
								onClick: () => sortBy("kind"),
								children: ["Kind ", arrow("kind")]
							}),
							/* @__PURE__ */ jsxs("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG,
									cursor: "pointer"
								},
								onClick: () => sortBy("type"),
								children: ["Type ", arrow("type")]
							}),
							/* @__PURE__ */ jsxs("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG,
									cursor: "pointer"
								},
								onClick: () => sortBy("status"),
								children: ["Status ", arrow("status")]
							}),
							/* @__PURE__ */ jsx("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG
								},
								children: "Owner"
							}),
							/* @__PURE__ */ jsx("th", {
								style: {
									textAlign: "left",
									padding: "7px 10px",
									fontSize: 10,
									fontWeight: 700,
									color: "#777",
									textTransform: "uppercase",
									borderBottom: `1px solid ${BORDER}`,
									background: HEADER_BG
								},
								children: "Blocked"
							})
						] }) }), /* @__PURE__ */ jsx("tbody", { children: rows.map((t) => {
							const th = typeTheme(t.type);
							return /* @__PURE__ */ jsxs("tr", {
								style: { cursor: "pointer" },
								onClick: () => setDetail(t),
								children: [
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`,
											fontFamily: "monospace",
											color: TEXT_FAINT,
											fontSize: 11
										},
										children: shortId(t)
									}),
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`,
											fontWeight: 600,
											color: TEXT,
											maxWidth: 200,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap"
										},
										children: t.title
									}),
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`
										},
										children: /* @__PURE__ */ jsxs("span", {
											style: {
												padding: "1px 6px",
												borderRadius: 999,
												background: `${KIND_META[ticketKind(t)].color}1e`,
												color: KIND_META[ticketKind(t)].color,
												border: `1px solid ${KIND_META[ticketKind(t)].color}44`,
												fontSize: 11
											},
											children: [
												KIND_META[ticketKind(t)].icon,
												" ",
												KIND_META[ticketKind(t)].label
											]
										})
									}),
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`
										},
										children: /* @__PURE__ */ jsxs("span", {
											style: {
												padding: "1px 6px",
												borderRadius: 999,
												background: `${th.color}1e`,
												color: th.color,
												border: `1px solid ${th.color}44`,
												fontSize: 11
											},
											children: [
												th.icon,
												" ",
												t.type ?? "（无 type）"
											]
										})
									}),
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`
										},
										children: /* @__PURE__ */ jsxs("span", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 5
											},
											children: [/* @__PURE__ */ jsx("span", { style: {
												width: 7,
												height: 7,
												borderRadius: "50%",
												background: DOT[displayStatus(t)]
											} }), STATUS_LABELS[displayStatus(t)]]
										})
									}),
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`,
											color: t.claimedBy ? "#f7ad31" : TEXT_FAINT
										},
										children: t.claimedBy ?? "—"
									}),
									/* @__PURE__ */ jsx("td", {
										style: {
											padding: "7px 10px",
											borderBottom: `1px solid ${BORDER_LIGHT}`,
											color: t.blockedBy.length > 0 ? "#f2555a" : TEXT_FAINT,
											fontFamily: "monospace",
											fontSize: 11
										},
										children: t.blockedBy.length > 0 ? t.blockedBy.map((n) => `#${n}`).join(" ") : "—"
									})
								]
							}, t.file);
						}) })]
					})
				})]
			}),
			detail && /* @__PURE__ */ jsx(DetailModal, {
				ticket: detail,
				planDir,
				scope,
				onClose: () => setDetail(null)
			})
		]
	});
}
const NODE_W = 176, STEP_X = 200, NODE_H = 44;
const RUNG_TOP = 140, RUNG_STEP = 110;
const START_Y = 36, END_GAP = 110, CAP_H = 30, CAP_W = 100;
const START = "\0start";
const END = "\0end";
function layoutGraph(tickets) {
	const grid = tickets.filter((t) => !t.outOfScope);
	const side = tickets.filter((t) => t.outOfScope);
	const byId = new Map(tickets.map((t) => [t.id, t]));
	const deps = /* @__PURE__ */ new Map();
	for (const t of tickets) deps.set(t.id, t.blockedBy.map((r) => resolveRef(r, byId)).filter((x) => x !== void 0));
	const depsOf = (t) => deps.get(t.id) ?? [];
	const depth = /* @__PURE__ */ new Map();
	const visit = (n) => {
		if (depth.has(n)) return depth.get(n);
		const t = byId.get(n);
		if (!t) return 0;
		const d = depsOf(t).filter((b) => byId.has(b) && !byId.get(b).outOfScope).reduce((m, b) => Math.max(m, visit(b)), 0) + 1;
		depth.set(n, d);
		return d;
	};
	for (const t of grid) visit(t.id);
	const maxL = Math.max(1, ...grid.map((t) => depth.get(t.id)));
	const layers = Array.from({ length: maxL }, () => []);
	for (const t of grid) layers[depth.get(t.id) - 1].push(t);
	const cmp = (a, b) => a.id.localeCompare(b.id, void 0, { numeric: true });
	layers[0].sort(cmp);
	for (let l = 1; l < maxL; l++) {
		const upIdx = /* @__PURE__ */ new Map();
		layers[l - 1].forEach((t, i) => upIdx.set(t.id, i));
		layers[l].sort((a, b) => {
			const pa = depsOf(a).filter((p) => upIdx.has(p)), pb = depsOf(b).filter((p) => upIdx.has(p));
			return pa.reduce((s, p) => s + upIdx.get(p), 0) / Math.max(1, pa.length) - pb.reduce((s, p) => s + upIdx.get(p), 0) / Math.max(1, pb.length) || cmp(a, b);
		});
	}
	const maxCount = Math.max(...layers.map((o) => o.length), 1);
	const W_MAIN = Math.max(600, maxCount * STEP_X + 40);
	const sideGap = 48;
	const sideRows = /* @__PURE__ */ new Map();
	let maxSideRow = 0;
	for (const t of side) {
		const p = depsOf(t).find((b) => byId.has(b) && !byId.get(b).outOfScope);
		let tier = 0;
		if (p !== void 0) {
			const parentTier = layers.findIndex((l) => l.some((tk) => tk.id === p));
			tier = (parentTier >= 0 ? parentTier : 0) + 1;
		}
		const yKey = RUNG_TOP + tier * RUNG_STEP;
		if (!sideRows.has(yKey)) sideRows.set(yKey, []);
		sideRows.get(yKey).push(t);
		maxSideRow = Math.max(maxSideRow, sideRows.get(yKey).length);
	}
	const W = side.length > 0 ? Math.max(W_MAIN, W_MAIN + sideGap + (maxSideRow - 1) * STEP_X + NODE_W + 40) : W_MAIN;
	const pos = /* @__PURE__ */ new Map();
	layers.forEach((o, li) => {
		const left = (W_MAIN - (o.length * STEP_X - 24)) / 2;
		o.forEach((t, i) => {
			const x = left + i * STEP_X;
			pos.set(t.id, {
				x,
				cx: x + NODE_W / 2,
				y: RUNG_TOP + li * RUNG_STEP
			});
		});
	});
	const laneX = W_MAIN + sideGap;
	const sidePos = /* @__PURE__ */ new Map();
	for (const [y, row] of sideRows) row.forEach((t, i) => {
		const x = laneX + i * STEP_X;
		sidePos.set(t.id, {
			x,
			cx: x + NODE_W / 2,
			y
		});
	});
	const childrenOf = /* @__PURE__ */ new Map();
	const edges = [];
	for (const t of grid) {
		const n = t.id;
		for (const p of depsOf(t)) if (byId.has(p) && !byId.get(p).outOfScope) {
			const key = `e${p}-${n}`;
			edges.push({
				from: p,
				to: n,
				key
			});
			if (!childrenOf.has(p)) childrenOf.set(p, []);
			childrenOf.get(p).push(n);
		}
	}
	layers[0].map((t) => t.id).forEach((r, i) => edges.push({
		from: START,
		to: r,
		key: `s${i}`
	}));
	grid.filter((t) => (childrenOf.get(t.id) ?? []).length === 0 && t.resolved).map((t) => t.id).forEach((l, i) => edges.push({
		from: l,
		to: END,
		key: `l${i}`
	}));
	for (const t of side) {
		const n = t.id;
		const p = depsOf(t).find((b) => byId.has(b));
		if (p !== void 0) edges.push({
			from: p,
			to: n,
			dashed: true,
			key: `d${p}-${n}`
		});
	}
	const endY = RUNG_TOP + (maxL - 1) * RUNG_STEP + END_GAP;
	const maxSideY = sidePos.size > 0 ? Math.max(...[...sidePos.values()].map((p) => p.y)) : 0;
	return {
		pos,
		sidePos,
		edges,
		W,
		H: Math.max(endY + CAP_H / 2 + 40, maxSideY + NODE_H + 40),
		capX: W_MAIN / 2,
		endY,
		startCapY: START_Y - CAP_H / 2,
		endCapY: endY - CAP_H / 2
	};
}
function ViewD({ tickets, planDir, scope }) {
	const [sel, setSel] = useState(null);
	const [hover, setHover] = useState(null);
	const { pos, sidePos, edges, W, H, capX, startCapY, endCapY, endY } = useMemo(() => layoutGraph(tickets), [tickets]);
	const focus = tickets.find((t) => t.id === sel) ?? null;
	const conn = (n) => {
		const keys = /* @__PURE__ */ new Set();
		for (const e of edges) if (e.from === n || e.to === n) keys.add(e.key);
		return keys;
	};
	const mk = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
	return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			background: BG,
			color: TEXT,
			overflow: "hidden"
		},
		children: [
			/* @__PURE__ */ jsxs("div", {
				style: {
					padding: "12px 16px 8px",
					display: "flex",
					justifyContent: "space-between"
				},
				children: [/* @__PURE__ */ jsx("span", {
					style: {
						fontSize: 14,
						fontWeight: 700
					},
					children: "Relation"
				}), /* @__PURE__ */ jsxs("span", {
					style: {
						fontSize: 12,
						color: "#888"
					},
					children: [tickets.length, " tickets · hover / click node to highlight edges"]
				})]
			}),
			/* @__PURE__ */ jsx("div", {
				style: {
					flex: 1,
					overflow: "auto",
					position: "relative",
					cursor: "default"
				},
				onClick: () => setSel(null),
				children: /* @__PURE__ */ jsxs("div", {
					style: {
						position: "relative",
						width: W,
						height: H,
						margin: "0 auto"
					},
					children: [
						/* @__PURE__ */ jsx("div", {
							style: {
								position: "absolute",
								left: capX - CAP_W / 2,
								top: startCapY,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: CAP_W,
								height: CAP_H,
								borderRadius: 999,
								background: CARD,
								border: `2px solid ${BORDER}`,
								fontSize: 12,
								fontWeight: 800,
								color: TEXT,
								boxShadow: "0 2px 10px rgba(0,0,0,.4)"
							},
							children: "Start"
						}),
						[...pos.entries()].map(([n, p]) => {
							const t = tickets.find((x) => x.id === n);
							return /* @__PURE__ */ jsxs("div", {
								style: {
									position: "absolute",
									display: "flex",
									background: CARD,
									borderRadius: 10,
									overflow: "hidden",
									cursor: "pointer",
									zIndex: 3,
									boxShadow: sel === n || hover === n ? "0 4px 20px rgba(0,0,0,.5), 0 0 0 2px #fff3" : "0 3px 12px rgba(0,0,0,.3)",
									border: `1px solid ${BORDER}`,
									width: NODE_W,
									height: NODE_H,
									left: p.x,
									top: p.y
								},
								onClick: (e) => {
									e.stopPropagation();
									setSel(n);
								},
								onMouseEnter: () => setHover(n),
								onMouseLeave: () => setHover(null),
								children: [/* @__PURE__ */ jsx("span", { style: {
									width: 4,
									flexShrink: 0,
									borderTopLeftRadius: 10,
									borderBottomLeftRadius: 10,
									background: DOT[displayStatus(t)]
								} }), /* @__PURE__ */ jsxs("div", {
									style: {
										padding: "7px 8px 7px 8px",
										flex: 1,
										minWidth: 0,
										display: "flex",
										flexDirection: "column",
										gap: 3
									},
									children: [/* @__PURE__ */ jsxs("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 5
										},
										children: [
											/* @__PURE__ */ jsx("span", {
												style: {
													fontSize: 9,
													fontFamily: "monospace",
													color: "#888",
													background: CHIP_BG,
													borderRadius: 999,
													minWidth: 18,
													height: 18,
													padding: "0 4px",
													boxSizing: "border-box",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													fontWeight: 700
												},
												children: shortId(t)
											}),
											/* @__PURE__ */ jsx("span", {
												style: { fontSize: 12 },
												children: KIND_META[ticketKind(t)].icon
											}),
											/* @__PURE__ */ jsx("span", {
												style: {
													fontSize: 11,
													fontWeight: 700,
													color: TEXT,
													lineHeight: 1.3,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
													flex: 1
												},
												children: t.title
											})
										]
									}), /* @__PURE__ */ jsxs("div", {
										style: {
											fontSize: 9,
											color: TEXT_FAINT,
											display: "flex",
											gap: 6
										},
										children: [STATUS_LABELS[displayStatus(t)], t.claimedBy && /* @__PURE__ */ jsxs(Fragment, { children: [" 👤 ", t.claimedBy] })]
									})]
								})]
							}, n);
						}),
						[...sidePos.entries()].map(([n, p]) => {
							const t = tickets.find((x) => x.id === n);
							return /* @__PURE__ */ jsxs("div", {
								style: {
									position: "absolute",
									display: "flex",
									background: CARD_DARK,
									borderRadius: 10,
									overflow: "hidden",
									cursor: "pointer",
									zIndex: 3,
									boxShadow: "0 2px 8px rgba(0,0,0,.3)",
									border: "2px dashed #383860",
									width: NODE_W,
									height: NODE_H,
									left: p.x,
									top: p.y
								},
								onClick: (e) => {
									e.stopPropagation();
									setSel(n);
								},
								onMouseEnter: () => setHover(n),
								onMouseLeave: () => setHover(null),
								children: [/* @__PURE__ */ jsx("span", { style: {
									width: 4,
									flexShrink: 0,
									background: "rgba(255,255,255,.16)"
								} }), /* @__PURE__ */ jsxs("div", {
									style: {
										padding: "7px 8px 7px 8px",
										flex: 1,
										minWidth: 0,
										display: "flex",
										flexDirection: "column",
										gap: 3
									},
									children: [/* @__PURE__ */ jsxs("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 5
										},
										children: [
											/* @__PURE__ */ jsx("span", {
												style: {
													fontSize: 9,
													fontFamily: "monospace",
													color: "#888",
													background: CHIP_BG,
													borderRadius: 999,
													minWidth: 18,
													height: 18,
													padding: "0 4px",
													boxSizing: "border-box",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													fontWeight: 700
												},
												children: shortId(t)
											}),
											/* @__PURE__ */ jsx("span", {
												style: { fontSize: 12 },
												children: "⛔"
											}),
											/* @__PURE__ */ jsx("span", {
												style: {
													fontSize: 11,
													fontWeight: 700,
													color: TEXT,
													lineHeight: 1.3,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
													flex: 1
												},
												children: t.title
											})
										]
									}), /* @__PURE__ */ jsx("div", {
										style: {
											fontSize: 9,
											color: TEXT_FAINT
										},
										children: "ruled out"
									})]
								})]
							}, n);
						}),
						/* @__PURE__ */ jsx("div", {
							style: {
								position: "absolute",
								left: capX - CAP_W / 2,
								top: endCapY,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: CAP_W,
								height: CAP_H,
								borderRadius: 999,
								background: CARD,
								border: `2px solid ${BORDER}`,
								fontSize: 12,
								fontWeight: 800,
								color: TEXT,
								boxShadow: "0 2px 10px rgba(0,0,0,.4)"
							},
							children: "End"
						}),
						/* @__PURE__ */ jsxs("svg", {
							width: W,
							height: H,
							style: {
								position: "absolute",
								left: 0,
								top: 0,
								pointerEvents: "none",
								zIndex: 1
							},
							children: [/* @__PURE__ */ jsxs("defs", { children: [/* @__PURE__ */ jsx("marker", {
								id: "da",
								viewBox: "0 0 10 10",
								refX: "8.5",
								refY: "5",
								markerWidth: "6",
								markerHeight: "6",
								orient: "auto-start-reverse",
								children: /* @__PURE__ */ jsx("path", {
									d: "M 0 0 L 10 5 L 0 10 z",
									fill: "#454570"
								})
							}), /* @__PURE__ */ jsx("marker", {
								id: "da2",
								viewBox: "0 0 10 10",
								refX: "8.5",
								refY: "5",
								markerWidth: "6",
								markerHeight: "6",
								orient: "auto-start-reverse",
								children: /* @__PURE__ */ jsx("path", {
									d: "M 0 0 L 10 5 L 0 10 z",
									fill: TEXT
								})
							})] }), edges.map((e) => {
								const aPos = e.from === START ? {
									cx: capX,
									y: startCapY
								} : pos.get(e.from);
								const bPos = e.to === END ? {
									cx: capX,
									y: endY
								} : pos.get(e.to) ?? sidePos.get(e.to);
								if (!aPos || !bPos) return null;
								const active = hover ?? sel;
								const connected = active === null || conn(active).has(e.key);
								const sx = aPos.cx, sy = e.from === START ? startCapY + CAP_H : aPos.y + NODE_H;
								const ex = e.to === END ? capX : bPos.cx;
								const ey = e.to === END ? endY : e.dashed ? bPos.y : bPos.y + NODE_H / 2;
								const sw = e.dashed ? 1.4 : connected ? 3 : 1.4;
								const sc = e.dashed ? "rgba(255,255,255,.35)" : connected ? TEXT : "rgba(255,255,255,.22)";
								return /* @__PURE__ */ jsx("path", {
									d: mk(sx, sy, ex, ey),
									fill: "none",
									stroke: sc,
									strokeWidth: sw,
									strokeDasharray: e.dashed ? "5 4" : void 0,
									opacity: active !== null && !connected ? .45 : 1,
									markerEnd: connected && !e.dashed ? "url(#da2)" : e.dashed ? void 0 : "url(#da)",
									style: { transition: "stroke-width .18s, opacity .18s" }
								}, e.key);
							})]
						})
					]
				})
			}),
			focus && /* @__PURE__ */ jsx(DetailModal, {
				ticket: focus,
				planDir,
				scope,
				onClose: () => setSel(null)
			})
		]
	});
}
function PlanView(props) {
	const { scope } = props;
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [loading, setLoading] = useState(true);
	const [top, setTop] = useState("route");
	const [effortIdx, setEffortIdx] = useState(0);
	const [variant, setVariant] = useState("A");
	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		const dir = scope.cwd ? `${scope.cwd}/.plan` : ".plan";
		try {
			const r = await loadPlan(scope, dir);
			if (!r) {
				setError("empty");
				setLoading(false);
				return;
			}
			setData(r);
		} catch {
			setError("failed");
		} finally {
			setLoading(false);
		}
	}, [scope.sessionId, scope.cwd]);
	useEffect(() => {
		load();
	}, [load]);
	const all = data?.tickets ?? [];
	const routeTickets = useMemo(() => all.filter((t) => classify(t) === "ticket"), [all]);
	const approvals = useMemo(() => all.filter((t) => classify(t) === "approval"), [all]);
	const destination = useMemo(() => {
		const mapRaw = data?.efforts[effortIdx]?.mapRaw;
		if (!mapRaw) return null;
		return mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/)?.[1]?.trim().split("\n")[0]?.trim() ?? null;
	}, [data?.efforts, effortIdx]);
	const refreshBtn = (label = "⟳ 刷新") => /* @__PURE__ */ jsx("button", {
		type: "button",
		onClick: () => void load(),
		disabled: loading,
		title: "重新读取 .plan（别处改了文件时用）",
		style: {
			padding: "5px 10px",
			border: `1px solid ${BORDER}`,
			borderRadius: 6,
			background: "transparent",
			color: loading ? "#555" : "#aaa",
			cursor: loading ? "default" : "pointer",
			fontSize: 12
		},
		children: loading ? "读取中…" : label
	});
	if (loading) return /* @__PURE__ */ jsx("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 10,
			background: BG,
			color: "#888"
		},
		children: "Loading…"
	});
	if (error || !data) return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 10,
			background: BG,
			color: "#888"
		},
		children: [/* @__PURE__ */ jsx("span", { children: "No .plan found in current directory." }), refreshBtn("⟳ 重新读取")]
	});
	const planDir = data.effortDir;
	const tabBtn = (active) => ({
		padding: "6px 12px",
		border: "none",
		borderRadius: 6,
		cursor: "pointer",
		background: active ? CARD : "transparent",
		color: active ? TEXT : "#888",
		fontSize: 12,
		fontWeight: active ? 700 : 400
	});
	const subBtn = (active) => ({
		flex: 1,
		padding: "5px 0",
		border: "none",
		borderRadius: 6,
		cursor: "pointer",
		background: active ? HEADER_BG : "transparent",
		color: active ? TEXT : "#888",
		fontSize: 11
	});
	const tabs = [
		{
			id: "route",
			label: "🗺️ 路线",
			count: routeTickets.length
		},
		{
			id: "tickets",
			label: "🎫 工单",
			count: routeTickets.length
		},
		{
			id: "approvals",
			label: "⏳ 待拍板",
			count: approvals.length
		}
	];
	return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			background: BG,
			color: TEXT,
			fontFamily: "sans-serif",
			fontSize: 14
		},
		children: [
			/* @__PURE__ */ jsxs("div", {
				style: {
					display: "flex",
					gap: 4,
					padding: "6px 8px",
					borderBottom: `1px solid ${BORDER}`,
					background: HEADER_BG,
					alignItems: "center"
				},
				children: [tabs.map((t) => /* @__PURE__ */ jsxs("button", {
					type: "button",
					style: tabBtn(top === t.id),
					onClick: () => setTop(t.id),
					children: [t.label, /* @__PURE__ */ jsx("span", {
						style: {
							marginLeft: 5,
							fontSize: 11,
							color: t.id === "approvals" && t.count > 0 ? "#f7ad31" : "#777"
						},
						children: t.count
					})]
				}, t.id)), /* @__PURE__ */ jsx("div", {
					style: { marginLeft: "auto" },
					children: refreshBtn()
				})]
			}),
			top === "route" && /* @__PURE__ */ jsxs(Fragment, { children: [
				data.efforts.length > 1 && /* @__PURE__ */ jsx("div", {
					style: {
						display: "flex",
						gap: 6,
						padding: "6px 10px 0",
						flexWrap: "wrap"
					},
					children: data.efforts.map((e) => /* @__PURE__ */ jsx("span", {
						onClick: () => setEffortIdx(data.efforts.indexOf(e)),
						style: {
							fontSize: 11,
							padding: "2px 8px",
							borderRadius: 999,
							cursor: "pointer",
							border: `1px solid ${effortIdx === data.efforts.indexOf(e) ? ACCENT : BORDER}`,
							color: effortIdx === data.efforts.indexOf(e) ? ACCENT : "#888"
						},
						children: e.dir.split("/").pop()
					}, e.dir))
				}),
				/* @__PURE__ */ jsxs("div", {
					style: {
						display: "flex",
						gap: 2,
						padding: "4px 8px",
						borderBottom: `1px solid ${BORDER}`,
						background: BG
					},
					children: [
						/* @__PURE__ */ jsx("button", {
							type: "button",
							style: subBtn(variant === "A"),
							onClick: () => setVariant("A"),
							children: "📋 Kanban"
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							style: subBtn(variant === "D"),
							onClick: () => setVariant("D"),
							children: "📊 Relation"
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							style: subBtn(variant === "C"),
							onClick: () => setVariant("C"),
							children: "Table"
						})
					]
				}),
				variant === "A" && /* @__PURE__ */ jsx(ViewA, {
					tickets: routeTickets,
					planDir,
					scope,
					destination
				}),
				variant === "D" && /* @__PURE__ */ jsx(ViewD, {
					tickets: routeTickets,
					planDir,
					scope
				}),
				variant === "C" && /* @__PURE__ */ jsx(ViewC, {
					tickets: routeTickets,
					planDir,
					scope
				})
			] }),
			top === "tickets" && /* @__PURE__ */ jsx(ViewC, {
				tickets: routeTickets,
				planDir,
				scope
			}),
			top === "approvals" && /* @__PURE__ */ jsx(ApprovalsView, {
				approvals,
				scope
			})
		]
	});
}
function approvalState(t) {
	if (statusWord(t) === "pending") return "pending";
	return "settled";
}
function ApprovalsView({ approvals, scope }) {
	const [focus, setFocus] = useState(null);
	const [filter, setFilter] = useState("pending");
	const counts = useMemo(() => ({
		pending: approvals.filter((t) => approvalState(t) === "pending").length,
		settled: approvals.filter((t) => approvalState(t) === "settled").length,
		all: approvals.length
	}), [approvals]);
	const shown = useMemo(() => {
		return [...filter === "all" ? approvals : approvals.filter((t) => approvalState(t) === filter)].sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1));
	}, [approvals, filter]);
	if (approvals.length === 0) return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			color: TEXT_FAINT,
			padding: 24,
			textAlign: "center"
		},
		children: [
			"没有待你拍板的文档。",
			/* @__PURE__ */ jsx("br", {}),
			/* @__PURE__ */ jsx("span", {
				style: {
					fontSize: 12,
					color: TEXT_FAINT
				},
				children: "审批文档写 `status: pending` 后会出现在这里。"
			})
		]
	});
	const chip = (id, label) => {
		const on = filter === id;
		return /* @__PURE__ */ jsxs("span", {
			onClick: () => setFilter(id),
			style: {
				fontSize: 11,
				padding: "2px 9px",
				borderRadius: 999,
				cursor: "pointer",
				border: `1px solid ${on ? "#f7ad31" : BORDER}`,
				color: on ? "#f7ad31" : "#888",
				background: on ? "#ffa94d1a" : "transparent"
			},
			children: [
				label,
				" ",
				counts[id]
			]
		}, id);
	};
	return /* @__PURE__ */ jsxs("div", {
		style: {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			overflow: "hidden"
		},
		children: [
			/* @__PURE__ */ jsxs("div", {
				style: {
					padding: "8px 14px",
					borderBottom: `1px solid ${BORDER}`,
					display: "flex",
					alignItems: "center",
					gap: 6,
					flexWrap: "wrap"
				},
				children: [
					chip("pending", "⏳ 待拍板"),
					chip("settled", "✓ 已结案"),
					chip("all", "全部")
				]
			}),
			shown.length === 0 ? /* @__PURE__ */ jsx("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: TEXT_FAINT,
					fontSize: 13
				},
				children: filter === "pending" ? "没有等你拍板的文档。" : "该筛选下没有文档。"
			}) : /* @__PURE__ */ jsx("div", {
				style: {
					flex: 1,
					overflowY: "auto",
					padding: 12,
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				children: shown.map((t) => {
					const age = ageDays(t);
					const hot = approvalState(t) === "pending" && age !== void 0 && age >= 7;
					const settled = approvalState(t) === "settled";
					return /* @__PURE__ */ jsxs("div", {
						onClick: () => setFocus(t),
						style: {
							padding: 12,
							borderRadius: 10,
							background: settled ? CARD_DARK : CARD,
							border: `1px solid ${hot ? "#7a4a15" : BORDER}`,
							cursor: "pointer",
							opacity: settled ? .75 : 1
						},
						children: [/* @__PURE__ */ jsxs("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [
								/* @__PURE__ */ jsx("span", {
									style: {
										fontSize: 13,
										color: settled ? TEXT_FAINT : "#f7ad31"
									},
									children: settled ? "✓" : "⏳"
								}),
								/* @__PURE__ */ jsx("span", {
									style: {
										flex: 1,
										fontSize: 13,
										fontWeight: 700,
										color: settled ? TEXT_FAINT : TEXT,
										lineHeight: 1.4
									},
									children: t.title
								}),
								!settled && age !== void 0 && /* @__PURE__ */ jsx("span", {
									style: {
										fontSize: 11,
										padding: "2px 8px",
										borderRadius: 999,
										background: hot ? "#7a4a1533" : CHIP_BG,
										color: hot ? "#f7ad31" : "#888",
										flexShrink: 0
									},
									children: ageLabel(t)
								})
							]
						}), /* @__PURE__ */ jsxs("div", {
							style: {
								display: "flex",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 7
							},
							children: [
								/* @__PURE__ */ jsx("span", {
									style: {
										fontSize: 10,
										padding: "1px 6px",
										borderRadius: 999,
										background: settled ? "#2ecc7122" : "#ffa94d22",
										color: settled ? "#4ed17e" : "#f7ad31"
									},
									children: t.status ?? "pending"
								}),
								/* @__PURE__ */ jsx("span", {
									style: {
										fontSize: 10,
										padding: "1px 6px",
										borderRadius: 999,
										background: CHIP_BG,
										color: "#888"
									},
									children: t.file
								}),
								t.origin && /* @__PURE__ */ jsxs("span", {
									style: {
										fontSize: 10,
										padding: "1px 6px",
										borderRadius: 999,
										background: CHIP_BG,
										color: "#888"
									},
									children: ["origin: ", t.origin]
								}),
								t.date && /* @__PURE__ */ jsx("span", {
									style: {
										fontSize: 10,
										padding: "1px 6px",
										borderRadius: 999,
										background: CHIP_BG,
										color: "#888"
									},
									children: t.date
								})
							]
						})]
					}, t.file);
				})
			}),
			focus && /* @__PURE__ */ jsx(DetailModal, {
				ticket: focus,
				planDir: "",
				scope,
				onClose: () => setFocus(null)
			})
		]
	});
}
//#endregion
//#region ../../../../dsh-plugin/packages/dsh-plan-view/src/client/index.tsx
const inject = ["betterSidebar", "slots"];
function apply(ctx) {
	ctx.effect(() => ctx.betterSidebar.registerTab({
		id: "dsh-plan-view:plan",
		title: () => "Plan",
		icon: (size) => /* @__PURE__ */ jsxs("svg", {
			width: size,
			height: size,
			viewBox: "0 0 16 16",
			fill: "none",
			children: [
				/* @__PURE__ */ jsx("rect", {
					x: "1",
					y: "1",
					width: "14",
					height: "14",
					rx: "3",
					stroke: "currentColor",
					strokeWidth: "1.5"
				}),
				/* @__PURE__ */ jsx("line", {
					x1: "4",
					y1: "5",
					x2: "12",
					y2: "5",
					stroke: "currentColor",
					strokeWidth: "1.2"
				}),
				/* @__PURE__ */ jsx("line", {
					x1: "4",
					y1: "8",
					x2: "12",
					y2: "8",
					stroke: "currentColor",
					strokeWidth: "1.2"
				}),
				/* @__PURE__ */ jsx("line", {
					x1: "4",
					y1: "11",
					x2: "9",
					y2: "11",
					stroke: "currentColor",
					strokeWidth: "1.2"
				})
			]
		}),
		order: 46,
		single: true,
		component: (props) => /* @__PURE__ */ jsx(PlanView, { ...props })
	}));
}
//#endregion
export { apply, inject };
