window.__ModuleLoader__.load({
	id: "dsh-plan-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		async function call(method, payload) {
			const resp = await fetch(`/sidebar/api/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			const parsed = await resp.json();
			if (!resp.ok || parsed?.ok !== true) throw new Error(parsed?.error?.message ?? `HTTP ${resp.status}`);
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
		async function fsWrite(scope, path, content) {
			await call("fs.write", scopePayload(scope, {
				path,
				content
			}));
		}
		async function rpc(method, args) {
			const resp = await fetch(`/api/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId: crypto.randomUUID(),
					method,
					payload: { args }
				})
			});
			const full = await resp.json();
			if (!resp.ok || full.result?.ok !== true) throw new Error(full.result?.error?.message ?? `HTTP ${resp.status}`);
			return full.result.value;
		}
		async function sessionList() {
			return (await rpc("session/list", { _request: {} })).items;
		}
		/** E1 liveness probe: find the session in the list, undefined when absent. */
		async function sessionAlive(sessionId) {
			return (await sessionList()).find((s) => s.sessionId === sessionId);
		}
		async function sessionCreate(cwd) {
			return (await rpc("session/create", { request: cwd === void 0 ? {} : { cwd } })).sessionId;
		}
		/** Non-blocking dispatch: queue one human message on the session's inbox. */
		async function sessionPrompt(sessionId, text) {
			await rpc("session/prompt", { request: {
				requestId: crypto.randomUUID(),
				sessionId,
				mode: "queue",
				content: [{
					type: "text",
					text
				}],
				clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			} });
		}
		/** Run one slash command (e.g. `/plan-approve <doc>`) inside a session. */
		async function commandExecute(agentId, line) {
			return rpc("commands/execute", {
				agentId,
				line,
				submittedAttachments: []
			});
		}
		//#endregion
		//#region src/client/PlanView.tsx
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
				session: fm.session,
				originSession: fm["origin_session"],
				body
			};
		}
		/**
		* Set (or add) one frontmatter key in a raw document, preserving everything
		* else. This is the B1 write-back: dispatching work from the plan view binds
		* the session id onto the ticket so the next click jumps back instead of
		* forking a new session.
		*/
		function upsertFrontmatterKey(raw, key, value) {
			const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
			if (m && m[1] != null) {
				const lines = m[1].split("\n");
				const i = lines.findIndex((l) => l.startsWith(`${key}:`));
				if (i >= 0) lines[i] = `${key}: ${value}`;
				else lines.push(`${key}: ${value}`);
				return `---\n${lines.join("\n")}\n---\n${m[2] ?? ""}`;
			}
			return `---\n${key}: ${value}\n---\n\n${raw}`;
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
			if (ty === "qa-defect") return "defect";
			if (ty === "ledger") return "ledger";
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
			ledger: {
				label: "台账",
				icon: "📒",
				color: "#4ed17e"
			},
			defect: {
				label: "缺陷",
				icon: "🐞",
				color: "#f2555a"
			},
			note: {
				label: "说明",
				icon: "📄",
				color: TEXT_FAINT
			}
		};
		const SPECULATION_TYPES = new Set([
			"research",
			"grilling",
			"prototype"
		]);
		const IMPL_TYPES = new Set(["task", "impl"]);
		function mapKind(dir, tickets) {
			let speculation = false, impl = false;
			for (const t of tickets) {
				if (t.effort !== dir) continue;
				const ty = (t.type ?? "").trim().toLowerCase();
				if (SPECULATION_TYPES.has(ty)) speculation = true;
				if (IMPL_TYPES.has(ty)) impl = true;
			}
			if (speculation) return "speculation";
			if (impl) return "impl";
		}
		const MAP_KIND_META = {
			speculation: {
				label: "推演图",
				icon: "🗺️"
			},
			impl: {
				label: "实施图",
				icon: "🛠️"
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
		function parseRoundsIndex(raw) {
			const out = /* @__PURE__ */ new Map();
			let inSection = false;
			let inTable = false;
			for (const line of raw.split("\n")) {
				if (/^#{1,6}\s/.test(line)) {
					inSection = /^#{1,6}\s+轮次索引/.test(line);
					inTable = false;
					continue;
				}
				if (!line.trimStart().startsWith("|")) {
					if (inTable) {
						inSection = false;
						inTable = false;
					}
					continue;
				}
				if (!inSection) continue;
				inTable = true;
				const cells = line.split("|").map((c) => c.trim());
				const id = (cells[1] ?? "").replace(/`/g, "");
				if (!id || id.includes("--") || id === "round-id") continue;
				out.set(id, {
					id,
					topic: cells[2] || void 0
				});
			}
			return out;
		}
		async function loadRounds(scope, root) {
			let tree;
			try {
				tree = await fsTree(scope, `${root}/.archive/rounds`);
			} catch {
				return [];
			}
			const ids = tree.entries.filter((e) => e.isDir && /^\d{4}-\d{2}-\d{2}/.test(e.name)).map((e) => e.name).sort().reverse();
			if (ids.length === 0) return [];
			const meta = await fsRead(scope, `${root}/.archive/README.md`).then((r) => r.kind === "text" ? parseRoundsIndex(r.content) : /* @__PURE__ */ new Map()).catch(() => /* @__PURE__ */ new Map());
			return ids.map((id) => meta.get(id) ?? { id });
		}
		const mdEntries = (tree) => tree.entries.filter((e) => e.name.endsWith(".md") && !e.isDir);
		const ROOT_GROUP = "\0root";
		async function collectTicketFiles(scope, effortDir) {
			const tree = await fsTree(scope, effortDir);
			const inTickets = tree.entries.find((e) => e.isDir && e.name === "tickets");
			const NON_TICKET = /^(map|spec|tech-spec|fe-v1-spec|readme)\.md$/i;
			const subDirs = tree.entries.filter((e) => e.isDir && !e.hidden && e.name !== "node_modules");
			const groups = await Promise.all([
				inTickets ? fsTree(scope, inTickets.path).then((t) => mdEntries(t).map((f) => ({
					file: f,
					group: "tickets"
				}))) : Promise.resolve([]),
				Promise.resolve(mdEntries(tree).map((f) => ({
					file: f,
					group: ROOT_GROUP
				}))),
				...subDirs.filter((d) => d.name !== "tickets").map(async (d) => mdEntries(await fsTree(scope, d.path)).map((f) => ({
					file: f,
					group: d.name
				})))
			]);
			const seen = /* @__PURE__ */ new Set();
			const all = [];
			for (const e of groups.flat()) {
				if (NON_TICKET.test(e.file.name) || seen.has(e.file.path)) continue;
				seen.add(e.file.path);
				all.push(e);
			}
			return all;
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
				Promise.resolve(mdEntries(rootTree).map((f) => ({
					file: f,
					from: ROOT_GROUP,
					group: ROOT_GROUP
				}))),
				rootTree.entries.some((e) => e.isDir && e.name === "ledger") ? fsTree(scope, `${planDir}/ledger`).then((t) => mdEntries(t).map((f) => ({
					file: f,
					from: ROOT_GROUP,
					group: "ledger"
				}))) : Promise.resolve([]),
				...effortDirs.map(async (d) => await collectTicketFiles(scope, d).then((gs) => gs.map((g) => ({
					file: g.file,
					from: d,
					group: g.group
				}))))
			]);
			const efforts = allEfforts.map((dir, i) => ({
				dir,
				mapRaw: mapRaws[i]?.kind === "text" ? mapRaws[i].content : ""
			}));
			const seen = /* @__PURE__ */ new Set();
			const picked = [];
			for (const e of fileGroups.flat()) {
				if (seen.has(e.file.path)) continue;
				seen.add(e.file.path);
				picked.push(e);
			}
			const raws = await Promise.all(picked.map((e) => fsRead(scope, e.file.path).then((r) => r.kind === "text" ? r.content : "")));
			const tickets = picked.map((e, i) => ({
				...deriveTicketStatus(e.file.name, raws[i] ?? ""),
				path: e.file.path,
				effort: e.from,
				group: e.group
			})).filter((t, i) => picked[i]?.group !== "qa" || ticketKind(t) === "defect");
			const primary = efforts.find((e) => e.mapRaw !== "") ?? efforts[0];
			return {
				tickets,
				effortDir: primary?.dir ?? planDir,
				mapRaw: primary?.mapRaw ?? null,
				efforts
			};
		}
		const shortSession = (id) => id.replace(/^session-/, "").slice(0, 8);
		const EXPLORE_PROMPT = (t) => `继续推演这张工单：${t.path ?? t.file}\n\n先读票面原文与它引用的文档，然后继续未决项的推演；需要人拍板的结论，用 to-approval 落成待拍板文档。`;
		const ADVANCE_PROMPT = (t) => `推进这张工单：${t.path ?? t.file}\n\n按票面实施；完成后按 plan-protocol 回写票面状态（status 与落地注）。`;
		function DetailModal({ ticket, planDir, scope, ctx, sessions, onChanged, onClose, readOnly }) {
			const [fullBody, setFullBody] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [msg, setMsg] = (0, react.useState)(null);
			const [rebind, setRebind] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
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
			(0, react.useEffect)(() => {
				const onKey = (e) => {
					if (e.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const openInGui = (sessionId) => {
				if (ctx?.uiWorkspace?.openSession === void 0) {
					setMsg("此环境没有跳转能力（uiWorkspace 不可用）。");
					return false;
				}
				ctx.uiWorkspace.openSession(sessionId);
				return true;
			};
			/** Pure jump with the E1 liveness check. */
			const jump = async (sessionId) => {
				setMsg(null);
				setBusy("jump");
				try {
					if (await sessionAlive(sessionId) === void 0) {
						setMsg("该 session 已不可用（可能已被回收）。");
						return;
					}
					openInGui(sessionId);
				} catch (e) {
					setMsg(`查询 session 失败：${e.message}`);
				} finally {
					setBusy(null);
				}
			};
			/** Create a session bound to this repo, write the B1 binding, dispatch, jump. */
			const createAndBind = async (promptText) => {
				setMsg(null);
				setRebind(false);
				setBusy("create");
				try {
					const sessionId = await sessionCreate(scope.cwd);
					const target = ticket.path ?? `${planDir}/tickets/${ticket.file}`;
					const raw = await fsRead(scope, target);
					if (raw.kind === "text") await fsWrite(scope, target, upsertFrontmatterKey(raw.content, "session", sessionId));
					await sessionPrompt(sessionId, promptText);
					openInGui(sessionId);
					onChanged();
					setMsg(`已在新 session ${shortSession(sessionId)} 派活（非阻塞），绑定已写回票面。`);
				} catch (e) {
					setMsg(`派发失败：${e.message}`);
				} finally {
					setBusy(null);
				}
			};
			/** ①/② dispatch on a ticket: jump back when bound, create when not. */
			const dispatchTicket = async (mode) => {
				const promptText = mode === "explore" ? EXPLORE_PROMPT(ticket) : ADVANCE_PROMPT(ticket);
				if (!ticket.session) {
					await createAndBind(promptText);
					return;
				}
				setMsg(null);
				setBusy(mode);
				try {
					if (await sessionAlive(ticket.session) === void 0) {
						setRebind(true);
						setMsg("绑定的 session 已不可用。可新建 session 并重新绑定。");
						return;
					}
					await sessionPrompt(ticket.session, promptText);
					openInGui(ticket.session);
					onChanged();
					setMsg(`已派给 session ${shortSession(ticket.session)}（非阻塞）。`);
				} catch (e) {
					setMsg(`派发失败：${e.message}`);
				} finally {
					setBusy(null);
				}
			};
			/** ③ 拍板: run /plan-approve in the origin session, or this one. */
			const settle = async () => {
				setMsg(null);
				setBusy("settle");
				try {
					let target = ticket.originSession;
					if (target !== void 0) {
						if (await sessionAlive(target) === void 0) target = void 0;
					}
					const at = target ?? scope.sessionId;
					await commandExecute(at, `/plan-approve ${ticket.file}`);
					onChanged();
					setMsg(`已在 session ${shortSession(at)} 派 /plan-approve（非阻塞）。`);
				} catch (e) {
					setMsg(`拍板派发失败：${e.message}`);
				} finally {
					setBusy(null);
				}
			};
			const kind = ticketKind(ticket);
			const pending = isPending(ticket);
			const boundLive = ticket.session !== void 0 ? sessions.get(ticket.session) : void 0;
			const btn = (label, onClick, key, tone = ACCENT) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: busy !== null,
				onClick,
				style: {
					padding: "5px 12px",
					borderRadius: 7,
					border: `1px solid ${tone}`,
					background: `${tone}1a`,
					color: tone,
					cursor: busy === null ? "pointer" : "default",
					fontSize: 12,
					fontWeight: 600,
					opacity: busy === null || busy === key ? 1 : .5
				},
				children: busy === key ? "…" : label
			});
			const actions = [];
			if (!readOnly) {
				if (kind === "ticket") if (ticket.session !== void 0 && rebind) {
					actions.push(btn("新建 session 并重新绑定", () => void createAndBind(ADVANCE_PROMPT(ticket)), "create", "#f7ad31"));
					actions.push(btn("取消", () => {
						setRebind(false);
						setMsg(null);
					}, "cancel", "#666"));
				} else {
					if (ticket.session === void 0) actions.push(btn("🧭 开始推演", () => void dispatchTicket("explore"), "explore"));
					actions.push(btn("▶ 推进", () => void dispatchTicket("advance"), "advance"));
				}
				if (kind === "approval" && pending) actions.push(btn("✅ 拍板（派 /plan-approve）", () => void settle(), "settle", "#4ed17e"));
			}
			const jumps = [];
			if (ticket.session !== void 0) jumps.push([ticket.session, "绑定 session"]);
			if (ticket.originSession !== void 0) jumps.push([ticket.originSession, "来源 session"]);
			const body = fullBody ?? ticket.body;
			const chipRow = jumps.map(([id, label]) => {
				const live = sessions.get(id);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					title: `${label}: ${id}${live === void 0 ? "（已不可用）" : live.running ? "（运行中）" : "（空闲）"}`,
					onClick: () => {
						if (busy === null) jump(id);
					},
					style: {
						fontSize: 11,
						padding: "2px 9px",
						borderRadius: 999,
						background: live !== void 0 ? "#2ecc7118" : CHIP_BG,
						color: live !== void 0 ? "#4ed17e" : "#888",
						border: `1px solid ${BORDER}`,
						cursor: "pointer"
					},
					children: [
						live === void 0 ? "⚪" : live.running ? "🟢" : "⚪",
						" ",
						label,
						" ",
						shortSession(id)
					]
				}, id);
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: MD_CSS }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "16px 20px 0",
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: DOT[displayStatus(ticket)] },
									children: typeTheme(ticket.type).icon
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 16,
										fontWeight: 700,
										color: TEXT,
										lineHeight: 1.4,
										flex: 1
									},
									children: ticket.title
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "0 20px 12px",
								display: "flex",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 8,
								borderBottom: `1px solid ${BORDER_LIGHT}`
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								ticket.type && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: `${typeTheme(ticket.type).color}22`,
										color: typeTheme(ticket.type).color
									},
									children: ticket.type
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
								ticket.claimedBy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#f0a50022",
										color: "#f7ad31"
									},
									children: ["👤 ", ticket.claimedBy]
								}),
								ticket.status && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								ageLabel(ticket) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#ffa94d22",
										color: "#f7ad31"
									},
									children: ageLabel(ticket)
								}),
								ticket.origin && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								ticket.blockedBy.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#ff6b6b22",
										color: "#f2555a"
									},
									children: ["blocked_by: ", ticket.blockedBy.map((n) => `#${n}`).join(", ")]
								}),
								chipRow
							]
						}),
						(actions.length > 0 || msg !== null) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "10px 20px",
								borderBottom: `1px solid ${BORDER_LIGHT}`,
								display: "flex",
								gap: 8,
								alignItems: "center",
								flexWrap: "wrap"
							},
							children: [
								actions,
								boundLive?.running === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										color: "#4ed17e"
									},
									children: "🟢 session 运行中"
								}),
								msg !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 12,
										color: TEXT_DIM,
										flex: 1,
										minWidth: 200
									},
									children: msg
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
		function ViewA({ tickets, planDir, scope, ctx, sessions, onChanged, destination, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const groups = (0, react.useMemo)(() => {
				const g = {
					resolved: [],
					out_of_scope: [],
					claimed: [],
					open: []
				};
				for (const t of tickets) g[displayStatus(t)].push(t);
				return g;
			}, [tickets]);
			const waiting = (0, react.useMemo)(() => tickets.filter(isPending).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)), [tickets]);
			const active = tickets.filter((t) => !t.outOfScope);
			const done = tickets.filter((t) => t.resolved).length;
			const pct = active.length > 0 ? Math.round(done / active.length * 100) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "12px 16px 0",
							display: "flex",
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Kanban"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
					!readOnly && waiting.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							margin: "8px 16px 0",
							padding: "8px 12px",
							borderRadius: 8,
							background: "#3a2410",
							border: "1px solid #7a4a15",
							fontSize: 13
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 3
							},
							children: waiting.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								onClick: () => setFocus(t),
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									cursor: "pointer",
									color: "#e8c9a0"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontFamily: "monospace",
											fontSize: 11,
											color: "#f7ad31"
										},
										children: shortId(t)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											flex: 1,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap"
										},
										children: t.title
									}),
									ageLabel(t) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
					destination && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							margin: "8px 16px 0",
							display: "flex",
							alignItems: "center",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								height: 6,
								borderRadius: 3,
								background: CHIP_BG,
								border: `1px solid ${BORDER}`,
								overflow: "hidden"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
								height: "100%",
								width: `${pct}%`,
								borderRadius: 3,
								background: `linear-gradient(90deg, #4ed17e, ${ACCENT})`
							} })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							gap: 10,
							padding: "12px 16px",
							overflowX: "auto"
						},
						children: STATUS_ORDER.filter((s) => groups[s].length > 0).map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "7px 10px",
									display: "flex",
									alignItems: "center",
									gap: 7,
									borderBottom: `1px solid ${BORDER_LIGHT}`,
									background: HEADER_BG
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: DOT[s]
									} }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontWeight: 700,
											fontSize: 12
										},
										children: STATUS_LABELS[s]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											color: "#888"
										},
										children: groups[s].length
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									flex: 1,
									overflowY: "auto",
									padding: 6,
									display: "flex",
									flexDirection: "column",
									gap: 6
								},
								children: groups[s].map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										padding: 8,
										borderRadius: 8,
										background: CARD,
										border: `1px solid ${BORDER}`,
										cursor: "pointer"
									},
									onClick: () => setFocus(t),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 6
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: { fontSize: 12 },
												children: KIND_META[ticketKind(t)].icon
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											gap: 4,
											marginTop: 6,
											flexWrap: "wrap"
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
											t.type && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 5px",
													borderRadius: 999,
													background: `${typeTheme(t.type).color}22`,
													color: typeTheme(t.type).color
												},
												children: t.type
											}),
											isPending(t) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 5px",
													borderRadius: 999,
													background: "#ffa94d33",
													color: "#f7ad31"
												},
												children: ageLabel(t) ?? "待拍板"
											}),
											t.claimedBy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 5px",
													borderRadius: 999,
													background: "#f0a50022",
													color: "#f7ad31"
												},
												children: ["👤 ", t.claimedBy]
											}),
											t.blockedBy.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		function ViewC({ tickets, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [query, setQuery] = (0, react.useState)("");
			const OUTSTANDING = ["open", "claimed"];
			const [statusSet, setStatusSet] = (0, react.useState)(() => new Set(OUTSTANDING));
			const allTypes = (0, react.useMemo)(() => {
				const named = [...new Set(tickets.map((t) => t.type).filter((x) => !!x))].sort();
				return tickets.some((t) => !t.type) ? [...named, NO_TYPE] : named;
			}, [tickets]);
			const [typeSet, setTypeSet] = (0, react.useState)(() => new Set(Object.keys(TYPE_THEME)));
			const [kindSet, setKindSet] = (0, react.useState)(() => new Set([
				"ticket",
				"approval",
				"note"
			]));
			const typeInit = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (typeInit.current || tickets.length === 0) return;
				typeInit.current = true;
				setTypeSet(new Set(allTypes));
			}, [allTypes, tickets.length]);
			const [onlyBlocked, setOnlyBlocked] = (0, react.useState)(false);
			const [sort, setSort] = (0, react.useState)({
				key: "num",
				dir: 1
			});
			const [detail, setDetail] = (0, react.useState)(null);
			const rows = (0, react.useMemo)(() => {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 16px",
							background: HEADER_BG,
							borderBottom: `1px solid ${BORDER}`,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Table"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [
								rows.length,
								"/",
								tickets.length,
								" tickets",
								statusSet.size < STATUS_ORDER.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: "#666" },
									children: "（默认隐藏已完成；勾 Status 里的 Resolved 可看）"
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							display: "flex",
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Search"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Status"
								}), STATUS_ORDER.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: statusSet.has(s),
											onChange: () => setStatusSet(toggle(statusSet, s))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { color: DOT[s] },
											children: "●"
										}),
										" ",
										STATUS_LABELS[s]
									]
								}, s))] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Kind"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Type"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										color: TEXT_DIM,
										cursor: "pointer"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: onlyBlocked,
										onChange: (e) => setOnlyBlocked(e.target.checked)
									}), " Only blocked"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								overflowY: "auto",
								padding: 12
							},
							children: rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: 40,
									textAlign: "center",
									color: TEXT_FAINT
								},
								children: "No matching tickets"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								style: {
									width: "100%",
									borderCollapse: "separate",
									borderSpacing: 0,
									background: HEADER_BG,
									borderRadius: 8,
									overflow: "hidden",
									fontSize: 12
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
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
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((t) => {
									const th = typeTheme(t.type);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										style: { cursor: "pointer" },
										onClick: () => setDetail(t),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													fontFamily: "monospace",
													color: TEXT_FAINT,
													fontSize: 11
												},
												children: shortId(t)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
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
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 5
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
														width: 7,
														height: 7,
														borderRadius: "50%",
														background: DOT[displayStatus(t)]
													} }), STATUS_LABELS[displayStatus(t)]]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													color: t.claimedBy ? "#f7ad31" : TEXT_FAINT
												},
												children: t.claimedBy ?? "—"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
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
					detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: detail,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setDetail(null),
						readOnly
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
		function ViewD({ tickets, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [sel, setSel] = (0, react.useState)(null);
			const [hover, setHover] = (0, react.useState)(null);
			const { pos, sidePos, edges, W, H, capX, startCapY, endCapY, endY } = (0, react.useMemo)(() => layoutGraph(tickets), [tickets]);
			const focus = tickets.find((t) => t.id === sel) ?? null;
			const conn = (n) => {
				const keys = /* @__PURE__ */ new Set();
				for (const e of edges) if (e.from === n || e.to === n) keys.add(e.key);
				return keys;
			};
			const mk = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT,
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "12px 16px 8px",
							display: "flex",
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Relation"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [tickets.length, " tickets · hover / click node to highlight edges"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflow: "auto",
							position: "relative",
							cursor: "default"
						},
						onClick: () => setSel(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								position: "relative",
								width: W,
								height: H,
								margin: "0 auto"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											borderTopLeftRadius: 10,
											borderBottomLeftRadius: 10,
											background: DOT[displayStatus(t)]
										} }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 8px 7px 8px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 5
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: { fontSize: 12 },
														children: KIND_META[ticketKind(t)].icon
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													fontSize: 9,
													color: TEXT_FAINT,
													display: "flex",
													gap: 6
												},
												children: [STATUS_LABELS[displayStatus(t)], t.claimedBy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" 👤 ", t.claimedBy] })]
											})]
										})]
									}, n);
								}),
								[...sidePos.entries()].map(([n, p]) => {
									const t = tickets.find((x) => x.id === n);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											background: "rgba(255,255,255,.16)"
										} }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 8px 7px 8px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 5
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: { fontSize: 12 },
														children: "⛔"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													fontSize: 9,
													color: TEXT_FAINT
												},
												children: "ruled out"
											})]
										})]
									}, n);
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									width: W,
									height: H,
									style: {
										position: "absolute",
										left: 0,
										top: 0,
										pointerEvents: "none",
										zIndex: 1
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("defs", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
										id: "da",
										viewBox: "0 0 10 10",
										refX: "8.5",
										refY: "5",
										markerWidth: "6",
										markerHeight: "6",
										orient: "auto-start-reverse",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M 0 0 L 10 5 L 0 10 z",
											fill: "#454570"
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
										id: "da2",
										viewBox: "0 0 10 10",
										refX: "8.5",
										refY: "5",
										markerWidth: "6",
										markerHeight: "6",
										orient: "auto-start-reverse",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
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
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
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
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setSel(null),
						readOnly
					})
				]
			});
		}
		function effortStage(own) {
			const open = own.filter((t) => ticketKind(t) === "ticket" && (displayStatus(t) === "open" || displayStatus(t) === "claimed"));
			const pend = own.filter((t) => ticketKind(t) === "approval" && isPending(t));
			const byId = new Map(own.map((t) => [t.id, t]));
			const unmet = (t) => t.blockedBy.some((r) => {
				const b = resolveRef(r, byId);
				const bt = b === void 0 ? void 0 : byId.get(b);
				return bt !== void 0 && (displayStatus(bt) === "open" || displayStatus(bt) === "claimed");
			});
			const frontier = open.filter((t) => !unmet(t));
			if (open.length > 0) return frontier.length > 0 ? {
				stage: "② 落地链中",
				color: ACCENT_SOFT
			} : {
				stage: "⛔ 卡 blocked",
				color: "#f2555a"
			};
			if (pend.length > 0) return {
				stage: "① 决策循环中",
				color: "#f7ad31"
			};
			return {
				stage: "✅ 收口",
				color: "#4ed17e"
			};
		}
		function inEffort(t, dir) {
			return t.effort === dir || t.effort === ROOT_GROUP;
		}
		function EffortChips({ efforts, all, effortIdx, setEffortIdx, countFor, totalCount }) {
			const groups = [
				"speculation",
				"impl",
				void 0
			].map((kind) => ({
				kind,
				items: efforts.map((e, i) => ({
					e,
					i,
					kind: mapKind(e.dir, all)
				})).filter((w) => w.kind === kind)
			})).filter((g) => g.items.length > 0);
			const allOn = effortIdx < 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: 6,
					padding: "8px 10px 6px",
					flexWrap: "wrap",
					borderBottom: `1px solid ${BORDER_LIGHT}`,
					alignItems: "center"
				},
				children: [efforts.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					onClick: () => setEffortIdx(-1),
					style: {
						fontSize: 11,
						padding: "3px 9px",
						borderRadius: 999,
						cursor: "pointer",
						border: `1px solid ${allOn ? ACCENT : BORDER}`,
						color: allOn ? ACCENT : TEXT_FAINT,
						background: allOn ? `${ACCENT}22` : "transparent"
					},
					children: ["全部地图 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { opacity: .7 },
						children: totalCount
					})]
				}), groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					style: {
						display: "inline-flex",
						gap: 6,
						alignItems: "center",
						flexWrap: "wrap"
					},
					children: [
						groups.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 10,
								color: TEXT_FAINT,
								padding: "3px 2px"
							},
							children: g.kind ? `${MAP_KIND_META[g.kind].icon} ${MAP_KIND_META[g.kind].label}` : "📄 其他"
						}),
						g.items.map(({ e, i, kind }) => {
							const on = effortIdx === i;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								onClick: () => setEffortIdx(i),
								title: e.dir,
								style: {
									fontSize: 11,
									padding: "3px 9px",
									borderRadius: 999,
									cursor: "pointer",
									border: `1px solid ${on ? ACCENT : BORDER}`,
									color: on ? ACCENT : TEXT_FAINT,
									background: on ? `${ACCENT}22` : "transparent"
								},
								children: [
									kind ? MAP_KIND_META[kind].icon : "🗺️",
									" ",
									e.dir.split("/").pop(),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { opacity: .7 },
										children: countFor(e.dir)
									})
								]
							}, e.dir);
						}),
						g !== groups[groups.length - 1] && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
							width: 1,
							height: 16,
							background: BORDER,
							margin: "0 4px"
						} })
					]
				}, String(g.kind)))]
			});
		}
		function OverviewView({ tickets, efforts, defects, effortIdx, setEffortIdx, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const byId = new Map(tickets.map((t) => [t.id, t]));
			const selectedDir = effortIdx >= 0 ? efforts[effortIdx]?.dir : void 0;
			const shownEfforts = effortIdx < 0 ? efforts : efforts.filter((_, i) => i === effortIdx);
			const visible = (0, react.useMemo)(() => selectedDir === void 0 ? tickets : tickets.filter((t) => inEffort(t, selectedDir)), [tickets, selectedDir]);
			const unmetBlocker = (t) => t.blockedBy.some((r) => {
				const b = resolveRef(r, byId);
				const bt = b === void 0 ? void 0 : byId.get(b);
				return bt !== void 0 && (displayStatus(bt) === "open" || displayStatus(bt) === "claimed");
			});
			const oldestPending = (0, react.useMemo)(() => visible.filter((t) => ticketKind(t) === "approval" && isPending(t)).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)).slice(0, 5), [visible]);
			const longestBlocked = (0, react.useMemo)(() => visible.filter((t) => ticketKind(t) === "ticket" && (displayStatus(t) === "open" || displayStatus(t) === "claimed") && unmetBlocker(t)).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)).slice(0, 5), [visible]);
			const running = (0, react.useMemo)(() => visible.filter((t) => t.session !== void 0 && (displayStatus(t) === "open" || displayStatus(t) === "claimed")), [visible]);
			const row = (t, right) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				onClick: () => setFocus(t),
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "6px 8px",
					borderRadius: 7,
					cursor: "pointer",
					background: "transparent"
				},
				onMouseEnter: (e) => {
					e.currentTarget.style.background = RAISED;
				},
				onMouseLeave: (e) => {
					e.currentTarget.style.background = "transparent";
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 10,
							fontFamily: "monospace",
							color: TEXT_FAINT,
							minWidth: 28
						},
						children: shortId(t)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							flex: 1,
							fontSize: 12.5,
							color: TEXT,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						},
						children: t.title
					}),
					right
				]
			}, `${t.effort}/${t.file}`);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					overflowY: "auto",
					padding: 14,
					display: "flex",
					flexDirection: "column",
					gap: 12
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortChips, {
						efforts,
						all: tickets,
						effortIdx,
						setEffortIdx,
						countFor: (dir) => tickets.filter((t) => inEffort(t, dir) && ticketKind(t) === "ticket").length,
						totalCount: tickets.filter((t) => ticketKind(t) === "ticket").length
					}),
					[
						"speculation",
						"impl",
						void 0
					].map((kind) => ({
						kind,
						items: shownEfforts.map((e, i) => ({
							e,
							i
						})).filter(({ e }) => mapKind(e.dir, tickets) === kind)
					})).filter((g) => g.items.length > 0).map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: TEXT_DIM
							},
							children: [g.kind ? `${MAP_KIND_META[g.kind].icon} ${MAP_KIND_META[g.kind].label}` : "📄 其他地图", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontWeight: 400,
									color: TEXT_FAINT,
									marginLeft: 6
								},
								children: [g.items.length, " 张"]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 10,
								flexWrap: "wrap"
							},
							children: g.items.map(({ e }) => {
								const own = tickets.filter((t) => t.effort === e.dir || t.effort === ROOT_GROUP);
								const work = own.filter((t) => ticketKind(t) === "ticket" && !t.outOfScope);
								const done = work.filter((t) => t.resolved).length;
								const pct = work.length > 0 ? Math.round(done / work.length * 100) : 0;
								const { stage, color } = effortStage(own);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										flex: "1 1 220px",
										minWidth: 220,
										padding: "10px 12px",
										borderRadius: 10,
										background: CARD,
										border: `1px solid ${BORDER}`,
										borderTop: `3px solid ${color}`
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												fontSize: 11,
												color: TEXT_FAINT,
												fontFamily: "monospace",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap"
											},
											children: e.dir.split("/").pop()
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												fontSize: 15,
												fontWeight: 700,
												color,
												margin: "3px 0 6px"
											},
											children: stage
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												height: 5,
												borderRadius: 3,
												background: CHIP_BG,
												overflow: "hidden"
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
												height: "100%",
												width: `${pct}%`,
												background: `linear-gradient(90deg, #4ed17e, ${ACCENT})`
											} })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												fontSize: 11,
												color: TEXT_FAINT,
												marginTop: 5
											},
											children: [
												pct,
												"% · ",
												work.length - done,
												" 张在途 · ",
												own.filter((t) => ticketKind(t) === "approval" && isPending(t)).length,
												" 待拍板",
												(() => {
													const dn = defects.filter((t) => t.effort === e.dir).length;
													if (dn === 0) return null;
													return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															color: "#f2555a",
															marginLeft: 6
														},
														children: ["🐞 ", dn]
													});
												})()
											]
										})
									]
								}, e.dir);
							})
						})]
					}, String(g.kind))),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 12,
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 320px",
								minWidth: 300,
								padding: "10px 12px",
								borderRadius: 10,
								background: CARD,
								border: `1px solid ${BORDER}`
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									fontWeight: 700,
									color: "#f7ad31",
									marginBottom: 6
								},
								children: "⏳ 最久待拍板"
							}), oldestPending.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									color: TEXT_FAINT
								},
								children: "没有挂起的拍板。"
							}) : oldestPending.map((t) => row(t, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: "#f7ad31",
									flexShrink: 0
								},
								children: ageLabel(t) ?? "pending"
							})))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 320px",
								minWidth: 300,
								padding: "10px 12px",
								borderRadius: 10,
								background: CARD,
								border: `1px solid ${BORDER}`
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									fontWeight: 700,
									color: "#f2555a",
									marginBottom: 6
								},
								children: "⛔ 最长等待 blocker"
							}), longestBlocked.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									color: TEXT_FAINT
								},
								children: "没有等依赖的票。"
							}) : longestBlocked.map((t) => row(t, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: "#f2555a",
									fontFamily: "monospace",
									flexShrink: 0
								},
								children: t.blockedBy.map((n) => `#${n}`).join(" ")
							})))]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 12px",
							borderRadius: 10,
							background: CARD,
							border: `1px solid ${BORDER}`
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: ACCENT_SOFT,
								marginBottom: 6
							},
							children: "🔗 后台任务（绑 session 的在途票）"
						}), running.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								color: TEXT_FAINT
							},
							children: "没有。从工单详情里「开始推演 / 推进」会在这里出现。"
						}) : running.map((t) => {
							const s = t.session !== void 0 ? sessions.get(t.session) : void 0;
							return row(t, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 11,
									fontFamily: "monospace",
									flexShrink: 0,
									color: s === void 0 ? "#666" : s.running ? "#4ed17e" : TEXT_FAINT
								},
								children: [
									s === void 0 ? "⚪ 已回收" : s.running ? "🟢 运行中" : "⚪ 空闲",
									" ",
									shortSession(t.session)
								]
							}));
						})]
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		function PlanView(props) {
			const { ctx, scope } = props;
			const [data, setData] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [top, setTop] = (0, react.useState)("map");
			const [mapSub, setMapSub] = (0, react.useState)("route");
			const [effortIdx, setEffortIdx] = (0, react.useState)(0);
			const [variant, setVariant] = (0, react.useState)("A");
			const [sessions, setSessions] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const [rounds, setRounds] = (0, react.useState)([]);
			const [round, setRound] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
				setLoading(true);
				setError(null);
				const base = scope.cwd ? `${scope.cwd}/` : "";
				const dir = round === null ? `${base}.plan` : `${base}.archive/rounds/${round}`;
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
			}, [
				scope.sessionId,
				scope.cwd,
				round
			]);
			const loadSessions = (0, react.useCallback)(() => {
				sessionList().then((items) => setSessions(new Map(items.map((s) => [s.sessionId, s])))).catch(() => setSessions(/* @__PURE__ */ new Map()));
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => {
				loadSessions();
			}, [loadSessions]);
			(0, react.useEffect)(() => {
				setRound(null);
				if (!scope.cwd) {
					setRounds([]);
					return;
				}
				loadRounds(scope, scope.cwd).then(setRounds).catch(() => setRounds([]));
			}, [scope.sessionId, scope.cwd]);
			(0, react.useEffect)(() => {
				setEffortIdx(-1);
			}, [round]);
			const onChanged = (0, react.useCallback)(() => {
				load();
				loadSessions();
			}, [load, loadSessions]);
			const all = data?.tickets ?? [];
			const routeTickets = (0, react.useMemo)(() => all.filter((t) => classify(t) === "ticket"), [all]);
			const approvals = (0, react.useMemo)(() => all.filter((t) => classify(t) === "approval"), [all]);
			const ledgers = (0, react.useMemo)(() => all.filter((t) => classify(t) === "ledger"), [all]);
			const defects = (0, react.useMemo)(() => all.filter((t) => classify(t) === "defect"), [all]);
			const mapOwnTickets = routeTickets;
			const selectedDir = effortIdx >= 0 ? data?.efforts[effortIdx]?.dir : void 0;
			const mapTickets = (0, react.useMemo)(() => effortIdx < 0 ? mapOwnTickets : mapOwnTickets.filter((t) => t.effort === selectedDir || t.effort === ROOT_GROUP), [
				mapOwnTickets,
				effortIdx,
				selectedDir
			]);
			const mapDefects = (0, react.useMemo)(() => effortIdx < 0 ? defects : defects.filter((t) => t.effort === selectedDir), [
				defects,
				effortIdx,
				selectedDir
			]);
			const mapApprovals = (0, react.useMemo)(() => effortIdx < 0 ? approvals : approvals.filter((t) => selectedDir !== void 0 && inEffort(t, selectedDir)), [
				approvals,
				effortIdx,
				selectedDir
			]);
			const globalLedgers = (0, react.useMemo)(() => ledgers.filter((t) => t.effort === ROOT_GROUP), [ledgers]);
			const mapLedgers = (0, react.useMemo)(() => effortIdx < 0 ? ledgers : ledgers.filter((t) => t.effort === selectedDir), [
				ledgers,
				effortIdx,
				selectedDir
			]);
			const destination = (0, react.useMemo)(() => {
				const mapRaw = effortIdx >= 0 ? data?.efforts[effortIdx]?.mapRaw : data?.mapRaw;
				if (!mapRaw) return null;
				return mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/)?.[1]?.trim().split("\n")[0]?.trim() ?? null;
			}, [
				data?.efforts,
				data?.mapRaw,
				effortIdx
			]);
			const refreshBtn = (label = "⟳ 刷新") => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
			if (error || !data) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: round === null ? "No .plan found in current directory." : `轮次 ${round} 读取失败（目录可能已被移动或删除）。` }), refreshBtn("⟳ 重新读取")]
			});
			const planDir = data.effortDir;
			const readOnly = round !== null;
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
				padding: "5px 12px",
				border: `1px solid ${active ? BORDER : "transparent"}`,
				borderRadius: 7,
				cursor: "pointer",
				background: active ? HEADER_BG : "transparent",
				color: active ? TEXT : "#888",
				fontSize: 11,
				fontWeight: active ? 700 : 400
			});
			const tabs = [
				{
					id: "overview",
					label: "🧭 总览",
					count: approvals.filter((t) => isPending(t)).length
				},
				{
					id: "map",
					label: "🗺️ 地图",
					count: mapTickets.length
				},
				{
					id: "ledger",
					label: "📒 台账",
					count: globalLedgers.length
				},
				{
					id: "guide",
					label: "📖 说明",
					count: 0
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 4,
							padding: "6px 8px",
							borderBottom: `1px solid ${BORDER}`,
							background: HEADER_BG,
							alignItems: "center"
						},
						children: [tabs.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: tabBtn(top === t.id),
							onClick: () => setTop(t.id),
							children: [t.label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									marginLeft: 5,
									fontSize: 11,
									color: t.id === "overview" && t.count > 0 ? "#f7ad31" : "#777"
								},
								children: t.count
							})]
						}, t.id)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginLeft: "auto",
								display: "flex",
								alignItems: "center",
								gap: 6
							},
							children: [rounds.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: round ?? "",
								onChange: (e) => setRound(e.target.value === "" ? null : e.target.value),
								title: "按轮查看历史归档（.archive/rounds，只读）",
								style: {
									padding: "4px 8px",
									borderRadius: 6,
									border: `1px solid ${round !== null ? "#7a4a15" : BORDER}`,
									background: HEADER_BG,
									color: round !== null ? "#f7ad31" : TEXT_DIM,
									fontSize: 12,
									outline: "none",
									maxWidth: 280,
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "📍 现行（.plan）"
								}), rounds.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: r.id,
									children: [
										"🗄️ ",
										r.id,
										r.topic ? ` · ${r.topic}` : ""
									]
								}, r.id))]
							}), refreshBtn()]
						})]
					}),
					round !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "6px 12px",
							background: "#241d10",
							borderBottom: "1px solid #7a4a1566",
							fontSize: 12,
							color: "#e8c9a0",
							display: "flex",
							gap: 10,
							alignItems: "center",
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"🗄️ 历史轮次快照（只读）：",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { fontFamily: "ui-monospace,Menlo,monospace" },
								children: round
							}),
							rounds.find((r) => r.id === round)?.topic ? ` · ${rounds.find((r) => r.id === round)?.topic}` : ""
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { color: "#a98d5f" },
							children: "归档内容勿据以实现；派活 / 拍板动作已停用。"
						})]
					}),
					top === "map" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						data.efforts.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortChips, {
							efforts: data.efforts,
							all,
							effortIdx,
							setEffortIdx,
							countFor: (dir) => mapOwnTickets.filter((t) => inEffort(t, dir)).length,
							totalCount: mapOwnTickets.length
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 4,
								padding: "5px 10px",
								borderBottom: `1px solid ${BORDER}`,
								background: BG,
								alignItems: "center"
							},
							children: [
								[
									"route",
									"🗺️ 路线",
									mapTickets.length
								],
								[
									"tickets",
									"🎫 工单",
									mapTickets.length
								],
								[
									"approvals",
									"⏳ 待拍板",
									mapApprovals.length
								],
								[
									"ledger",
									"📒 台账",
									mapLedgers.length
								],
								[
									"defects",
									"🐞 缺陷",
									mapDefects.length
								]
							].map(([id, label, n]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: subBtn(mapSub === id),
								onClick: () => setMapSub(id),
								children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										marginLeft: 4,
										opacity: .7
									},
									children: n
								})]
							}, id))
						}),
						mapSub === "route" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 4,
									padding: "5px 10px",
									borderBottom: `1px solid ${BORDER}`,
									background: BG
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: subBtn(variant === "A"),
										onClick: () => setVariant("A"),
										children: "📋 Kanban"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: subBtn(variant === "D"),
										onClick: () => setVariant("D"),
										children: "📊 Relation"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: subBtn(variant === "C"),
										onClick: () => setVariant("C"),
										children: "Table"
									})
								]
							}),
							variant === "A" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewA, {
								tickets: mapTickets,
								planDir,
								scope,
								ctx,
								sessions,
								onChanged,
								destination,
								readOnly
							}),
							variant === "D" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewD, {
								tickets: mapTickets,
								planDir,
								scope,
								ctx,
								sessions,
								onChanged,
								readOnly
							}),
							variant === "C" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewC, {
								tickets: mapTickets,
								planDir,
								scope,
								ctx,
								sessions,
								onChanged,
								readOnly
							})
						] }),
						mapSub === "tickets" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewC, {
							tickets: mapTickets,
							planDir,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "approvals" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalsView, {
							approvals: mapApprovals,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "ledger" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerView, {
							ledgers: mapLedgers,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "defects" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DefectView, {
							defects: mapDefects,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						})
					] }),
					top === "guide" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuideView, { scope }),
					top === "ledger" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerView, {
						ledgers: globalLedgers,
						scope,
						ctx,
						sessions,
						onChanged,
						readOnly
					}),
					top === "overview" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewView, {
						tickets: all,
						efforts: data.efforts,
						defects,
						effortIdx,
						setEffortIdx,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						readOnly
					})
				]
			});
		}
		function GuideView({ scope }) {
			const H = ({ children }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 14,
					fontWeight: 700,
					color: TEXT,
					margin: "20px 0 8px"
				},
				children
			});
			const P = ({ children, style }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 12.5,
					lineHeight: 1.8,
					color: TEXT_DIM,
					margin: "6px 0",
					...style
				},
				children
			});
			const Code = ({ children }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
				style: {
					background: "rgba(255,255,255,.08)",
					padding: "1px 5px",
					borderRadius: 4,
					fontFamily: "ui-monospace,Menlo,monospace",
					fontSize: 11.5,
					color: ACCENT_SOFT
				},
				children
			});
			const Box = ({ title, who, tone, children }) => {
				const c = tone === "decide" ? "#f7ad31" : tone === "ok" ? "#4ed17e" : "#609bfa";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						flex: "1 1 140px",
						minWidth: 140,
						padding: "9px 11px",
						borderRadius: 8,
						background: CARD,
						border: `1px solid ${c}55`,
						borderTop: `3px solid ${c}`
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: c
							},
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 10.5,
								color: TEXT_FAINT,
								marginTop: 3,
								fontFamily: "ui-monospace,Menlo,monospace",
								wordBreak: "break-all"
							},
							children: who
						}),
						children && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 11,
								color: TEXT_DIM,
								marginTop: 5,
								lineHeight: 1.6
							},
							children
						})
					]
				});
			};
			const Arrow = () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					alignSelf: "center",
					color: TEXT_FAINT,
					fontSize: 15,
					padding: "0 1px"
				},
				children: "→"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					flex: 1,
					overflowY: "auto",
					padding: "4px 18px 28px"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { maxWidth: 900 },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "这个页面是什么" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"总览 / 路线 / 工单 / 待拍板 / 台账 / 缺陷 各页显示的都是在 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".plan/" }),
							" 下的 markdown。 本页说明这些文件怎么产生、谁维护、怎么流转。完整的流程协议（每环节的位置与交接契约）记在同仓",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "skills/plan-protocol/SKILL.md" }),
							"，本页是它的可视化速览。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "主流程：先决策，再落地" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"「",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "已知要做"
							}),
							"」时走这条链——把需求写成 spec，再拆票实现。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "10px 0",
								alignItems: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
								title: "① 决策循环",
								who: "grill / wayfinder → to-approval → plan-approve",
								tone: "decide",
								children: "一轮轮收敛：把模糊决策拷问清楚、落待拍板、逐项拍板"
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "6px 0 4px",
								alignItems: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: TEXT_FAINT,
									marginRight: 2
								},
								children: "决策定案（结论是「要做 X」）↓"
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "4px 0"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Box, {
									title: "② 定需求",
									who: "to-spec",
									tone: "ok",
									children: [
										"产出 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "spec.md" }),
										"；写前读架构正本、写完更新"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "③ 拆票",
									who: "to-tickets",
									tone: "ok",
									children: "一票一文件、每票切穿各层、写明谁阻塞谁"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "④ 执行",
									who: "implement / implement-spec",
									tone: "ok",
									children: "按票派 subagent，并行实现、逐个合并"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Box, {
									title: "⑤ 回写",
									who: "plan-sync（执行时同步）",
									tone: "ok",
									children: [
										"勾验收项、置 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "status" }),
										"、补落地注"
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, {
							style: { marginTop: 2 },
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { color: TEXT },
									children: "回写发生在两处，是同一件事的两种时机"
								}),
								"：执行类 skill 在每张票合并落地时",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { color: TEXT },
									children: "当场"
								}),
								"翻状态；",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-sync" }),
								" 事后对账，把「看起来已完成、票面没翻」的条目找回补齐。两者不是两条流程。"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "补充流程：执行中暴露的问题" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"「",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "发现一个 bug / 缺口"
							}),
							"」时走这条链——先拍板定论，依据就是拍板文档本身。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "10px 0"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "发现",
									who: "find-bug",
									tone: "decide",
									children: "执行 / 测试中暴露的问题"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Box, {
									title: "待拍板文档",
									who: "to-approval → plan-approve",
									tone: "decide",
									children: ["落文档、拍板；", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { color: TEXT },
										children: "依据 = 这份文档本身"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "依据",
									who: "（不追加、不新建 spec）",
									tone: "read",
									children: "拍板文档自带原话 + 争议 + 结论，天然当上游"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "接回落地链",
									who: "to-tickets → implement → plan-sync",
									tone: "ok",
									children: "同上 ③ ④ ⑤"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"两条流在「",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "结论 = 要做某件事"
							}),
							"」处汇合：拍板结论若要求干活，",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "同一轮就该落成标准票"
							}),
							"（",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-approve" }),
							" 调 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "to-tickets" }),
							"），而不是把结论留在文档里等人再拆一次。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "票的形态约定" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"一个 effort 目录下，票按",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "一票一文件"
							}),
							"放："
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 12,
								lineHeight: 1.9,
								color: TEXT_DIM,
								background: "#141416",
								border: `1px solid ${BORDER_LIGHT}`,
								borderRadius: 8,
								padding: "10px 14px",
								margin: "8px 0",
								fontFamily: "ui-monospace,Menlo,monospace"
							},
							children: [
								".plan/<effort>/",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0map.md \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← effort 标志：没有它，整个目录不被加载"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0tickets/",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0\xA0\xA001-<slug>.md \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← frontmatter: type / blocked_by / status"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0\xA0\xA002-<slug>.md"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "为什么必须一票一文件"
							}),
							"：把多张票写进同一个文件（如 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "tickets.md" }),
							"）， 按文件读取的一方会把它当成",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "一张票"
							}),
							"，里面的票全部丢失—— 本插件就是按文件读的。合并文件看起来整齐，代价是内容不可见。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "几个常见疑问" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 12.5,
								lineHeight: 1.85,
								color: TEXT_DIM
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "票和待拍板有什么区别？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"票是",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "等被做"
										}),
										"的活（",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "status: open/done" }),
										"）； 待拍板是",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "等你做决定"
										}),
										"的文档（",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "status: pending" }),
										"）。 拍板结论若要干活，就该当场生成票——两者不是同一个东西，但会接力。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "看到状态不对怎么办？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"结构漂移先用只读脚本查：",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "node …/dsh-plan-view/scripts/plan-lint.mjs 仓库根" }),
										"（同票双档、缺 map.md、缺状态头/非法 status）； 再跑 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-sync" }),
										" 对账票面与实际进度（对照 git 提交判定，先报告差异再改）。 两者都只报告、不擅自改。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "归档在哪？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"已完成内容由 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-archive" }),
										"（手动触发）迁到 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".archive/" }),
										"， 并 sweep 全仓引用（含归档区自身）、标过时/废弃。归档区的「现行权威」表是引用断链的高发地，每次归档都要维护它。 右上角「轮次」选择器可切进某一轮的快照（",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".archive/rounds/<round-id>/" }),
										"）， 按轮只读查看当时的路线 / 工单 / 拍板。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "历史遗留的 impl/ 、impl-fe/ 目录？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"那是早期形态的实施工单，正在逐步废弃。它们的票现在也出现在「🗺️ 地图 → 🎫 工单」子页，不再单独成页； 收尾时会清理并入 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "tickets/" }),
										"。"
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginTop: 22,
								paddingTop: 12,
								borderTop: `1px solid ${BORDER_LIGHT}`,
								fontSize: 11,
								color: TEXT_FAINT
							},
							children: [
								"本页内容随约定演进；若与 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "skills/" }),
								" 下的 skill 正文或 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-protocol" }),
								" 冲突，以 skill 为准。"
							]
						})
					]
				})
			});
		}
		function approvalState(t) {
			if (statusWord(t) === "pending") return "pending";
			return "settled";
		}
		function ApprovalsView({ approvals, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const [filter, setFilter] = (0, react.useState)(readOnly ? "all" : "pending");
			const counts = (0, react.useMemo)(() => ({
				pending: approvals.filter((t) => approvalState(t) === "pending").length,
				settled: approvals.filter((t) => approvalState(t) === "settled").length,
				all: approvals.length
			}), [approvals]);
			const shown = (0, react.useMemo)(() => {
				return [...filter === "all" ? approvals : approvals.filter((t) => approvalState(t) === filter)].sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1));
			}, [approvals, filter]);
			if (approvals.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					readOnly ? "该轮次没有拍板文档。" : "没有待你拍板的文档。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					shown.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: TEXT_FAINT,
							fontSize: 13
						},
						children: filter === "pending" ? "没有等你拍板的文档。" : "该筛选下没有文档。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								onClick: () => setFocus(t),
								style: {
									padding: 12,
									borderRadius: 10,
									background: settled ? CARD_DARK : CARD,
									border: `1px solid ${hot ? "#7a4a15" : BORDER}`,
									cursor: "pointer",
									opacity: settled ? .75 : 1
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 8
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 13,
												color: settled ? TEXT_FAINT : "#f7ad31"
											},
											children: settled ? "✓" : "⏳"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												flex: 1,
												fontSize: 13,
												fontWeight: 700,
												color: settled ? TEXT_FAINT : TEXT,
												lineHeight: 1.4
											},
											children: t.title
										}),
										!settled && age !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 6,
										flexWrap: "wrap",
										marginTop: 7
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 10,
												padding: "1px 6px",
												borderRadius: 999,
												background: settled ? "#2ecc7122" : "#ffa94d22",
												color: settled ? "#4ed17e" : "#f7ad31"
											},
											children: t.status ?? "pending"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 10,
												padding: "1px 6px",
												borderRadius: 999,
												background: CHIP_BG,
												color: "#888"
											},
											children: t.file
										}),
										t.origin && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "1px 6px",
												borderRadius: 999,
												background: CHIP_BG,
												color: "#888"
											},
											children: ["origin: ", t.origin]
										}),
										t.date && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir: "",
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		const LEDGER_STATES = [
			"在挂",
			"已销",
			"已转票"
		];
		/** 解析台账条目：`### 挂账-NN 标题` 小节 + `- 状态/卡点/启动条件/来源:` 固定字段。 */
		function parseLedgerEntries(body) {
			const out = [];
			const sections = /(^|\n)### 挂账-/.test(body) ? body.split(/^### /m).slice(1) : body.split(/^# /m).slice(1);
			for (const sec of sections) {
				const m = (sec.split("\n")[0]?.trim() ?? "").match(/^(挂账-[\w.-]+)\s+(.+)$/);
				if (!m?.[1] || !m[2]) continue;
				const field = (name) => sec.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
				const rawState = field("状态") || "在挂";
				const core = LEDGER_STATES.find((s) => rawState.startsWith(s)) ?? rawState;
				const note = core === rawState ? "" : rawState.slice(core.length).replace(/^[（(]\s*/, "").replace(/[)）]\s*$/, "");
				out.push({
					id: m[1],
					title: m[2],
					state: core,
					stateNote: note,
					blocker: field("卡点"),
					startWhen: field("启动条件"),
					source: field("来源")
				});
			}
			return out;
		}
		function LedgerView({ ledgers, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			if (ledgers.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					"没有台账条目。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "一账一文件：全局放 `.plan/ledger/挂账-NN-slug.md`，图内放 `.plan/<effort>/ledger/`，frontmatter 带 `type: ledger`。"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: "8px 14px",
							borderBottom: `1px solid ${BORDER}`,
							fontSize: 11,
							color: TEXT_FAINT
						},
						children: "挂账 = 发现但当下不做/做不了的项，条件成熟开工销账；agent 扫描「启动条件」已满足的项即可启动。一账一文件。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflowY: "auto",
							padding: 12,
							display: "flex",
							flexDirection: "column",
							gap: 10
						},
						children: ledgers.map((t) => {
							const entries = parseLedgerEntries(t.body);
							const single = entries.length === 1 ? entries[0] : void 0;
							if (single !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								onClick: () => setFocus(t),
								style: {
									padding: "10px 12px",
									borderRadius: 10,
									background: CARD,
									border: `1px solid ${BORDER}`,
									cursor: "pointer"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerCard, { entry: single })
							}, t.file);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 8
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 13,
													fontWeight: 700,
													color: TEXT
												},
												children: t.title
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: t.file
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: [entries.length, " 笔在账"]
											})
										]
									}),
									entries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: () => setFocus(t),
										style: {
											padding: 12,
											borderRadius: 10,
											background: CARD,
											border: `1px solid ${BORDER}`,
											cursor: "pointer",
											fontSize: 12,
											color: TEXT_FAINT
										},
										children: "未解析出台账条目（需要 `# 挂账-NN` 标题或 `### 挂账-NN` 小节格式），点开看全文。"
									}),
									entries.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: () => setFocus(t),
										style: {
											padding: "10px 12px",
											borderRadius: 10,
											background: CARD,
											border: `1px solid ${BORDER}`,
											cursor: "pointer"
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerCard, { entry: e })
									}, e.id))
								]
							}, t.file);
						})
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir: "",
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		const LEDGER_STATE_COLOR = {
			"在挂": {
				bg: "#ffa94d22",
				fg: "#f7ad31"
			},
			"已销": {
				bg: "#2ecc7122",
				fg: "#4ed17e"
			},
			"已转票": {
				bg: "#609bfa22",
				fg: "#609bfa"
			}
		};
		function LedgerCard({ entry: e }) {
			const tone = LEDGER_STATE_COLOR[e.state] ?? {
				bg: CHIP_BG,
				fg: TEXT_FAINT
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 10,
								padding: "1px 8px",
								borderRadius: 999,
								background: tone.bg,
								color: tone.fg,
								flexShrink: 0
							},
							children: e.state
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: 1,
								minWidth: 200,
								fontSize: 13,
								fontWeight: 700,
								color: TEXT
							},
							children: e.title
						}),
						e.source && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 10,
								color: TEXT_FAINT,
								flexShrink: 0
							},
							children: e.source
						})
					]
				}),
				e.stateNote && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 11,
						color: tone.fg,
						marginTop: 4,
						lineHeight: 1.5
					},
					children: ["状态注记：", e.stateNote]
				}),
				e.blocker && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: TEXT_DIM,
						marginTop: 6,
						lineHeight: 1.5
					},
					children: ["卡点：", e.blocker]
				}),
				e.startWhen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: "#4ed17e",
						marginTop: 3,
						lineHeight: 1.5
					},
					children: ["启动条件：", e.startWhen]
				})
			] });
		}
		function parseDefectEntries(body) {
			const lines = body.split("\n");
			for (let i = 0; i < lines.length - 1; i++) {
				const head = lines[i] ?? "";
				if (!head.includes("缺陷号") || !isDivider(lines[i + 1] ?? "")) continue;
				const cols = splitRow(head);
				const col = (...names) => cols.findIndex((c) => names.some((n) => c.includes(n)));
				const ix = {
					id: col("缺陷号"),
					title: col("标题"),
					severity: col("严重度", "严重程度"),
					kind: col("类型", "domain"),
					state: col("状态"),
					source: col("发现源")
				};
				const cell = (row, k) => k >= 0 ? row[k] ?? "" : "";
				const out = [];
				for (let j = i + 2; j < lines.length; j++) {
					const line = lines[j] ?? "";
					if (!line.includes("|") || /^\s*$/.test(line)) break;
					const cells = splitRow(line);
					const id = cell(cells, ix.id);
					if (!id) continue;
					out.push({
						id,
						title: cell(cells, ix.title),
						severity: cell(cells, ix.severity),
						kind: cell(cells, ix.kind),
						state: cell(cells, ix.state),
						source: cell(cells, ix.source)
					});
				}
				return out;
			}
			return [];
		}
		const DEFECT_CLOSED = new Set([
			"已关闭",
			"关闭",
			"挂起"
		]);
		const defectStateWord = (s) => s.trim().split(/[\s(（#:：—-]/)[0] ?? "";
		function DefectView({ defects, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			if (defects.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					"当前图没有缺陷台账。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "`.plan/<effort>/qa/` 下带 `type: qa-defect` 头的缺陷台账会按图列在这里。"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: "8px 14px",
							borderBottom: `1px solid ${BORDER}`,
							fontSize: 11,
							color: TEXT_FAINT
						},
						children: "缺陷挂在具体图下（按当前选中的图过滤，切图联动）；条目来自台账的「清单总览」表，点卡片看全文。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflowY: "auto",
							padding: 12,
							display: "flex",
							flexDirection: "column",
							gap: 10
						},
						children: defects.map((t) => {
							const entries = parseDefectEntries(t.body);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 8
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 13,
													fontWeight: 700,
													color: TEXT
												},
												children: t.title
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: [
													t.effort?.split("/").pop(),
													"/",
													t.file
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: [entries.length, " 条"]
											})
										]
									}),
									entries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: () => setFocus(t),
										style: {
											padding: 12,
											borderRadius: 10,
											background: CARD,
											border: `1px solid ${BORDER}`,
											cursor: "pointer",
											fontSize: 12,
											color: TEXT_FAINT
										},
										children: "未解析出缺陷条目（需要「清单总览」表格，表头含缺陷号/标题/严重度等列），点开看全文。"
									}),
									entries.map((e) => {
										const closed = DEFECT_CLOSED.has(defectStateWord(e.state));
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											onClick: () => setFocus(t),
											style: {
												padding: "10px 12px",
												borderRadius: 10,
												background: closed ? CARD_DARK : CARD,
												border: `1px solid ${BORDER}`,
												cursor: "pointer",
												opacity: closed ? .75 : 1
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 10,
															padding: "1px 8px",
															borderRadius: 999,
															background: closed ? "#2ecc7122" : "#ffa94d22",
															color: closed ? "#4ed17e" : "#f7ad31",
															flexShrink: 0
														},
														children: e.state || "新建"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															flex: 1,
															fontSize: 13,
															fontWeight: 700,
															color: TEXT
														},
														children: e.title
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 10,
															fontFamily: "monospace",
															color: TEXT_FAINT,
															flexShrink: 0
														},
														children: e.id
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 6,
													flexWrap: "wrap",
													marginTop: 6
												},
												children: [
													e.severity && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["严重度 ", e.severity]
													}),
													e.kind && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["类型 ", e.kind]
													}),
													e.source && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["发现源 ", e.source]
													})
												]
											})]
										}, e.id);
									})
								]
							}, `${t.effort}/${t.file}`);
						})
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir: "",
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const inject = ["betterSidebar", "slots"];
		function apply(ctx) {
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-plan-view:plan",
				title: () => "Plan",
				icon: (size) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "1",
							y: "1",
							width: "14",
							height: "14",
							rx: "3",
							stroke: "currentColor",
							strokeWidth: "1.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "4",
							y1: "5",
							x2: "12",
							y2: "5",
							stroke: "currentColor",
							strokeWidth: "1.2"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "4",
							y1: "8",
							x2: "12",
							y2: "8",
							stroke: "currentColor",
							strokeWidth: "1.2"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
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
				component: (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanView, { ...props })
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map