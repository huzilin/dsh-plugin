window.__ModuleLoader__.load({
	id: "dsh-plan-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/types/client/api.js
		/**
		* Minimal fetch wrapper for DSH sidebar API — reads fs.tree and fs.read.
		* Self-contained: does not depend on better-sidebar's internal api module.
		*/
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
		//#region lib/types/client/PlanView.js
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
			return {
				file,
				title: raw.match(/^#\s+(.+)$/m)?.[1]?.replace(/`[^`]*`/g, "")?.trim() ?? file,
				type: fm.type,
				blockedBy: (fm.blocked_by ?? "").replace(/[\[\]]/g, "").split(/[,\s]+/).map(Number).filter(Boolean),
				resolved: hasAnswer,
				outOfScope: hasRuledOut,
				claimedBy: fm.claimed_by,
				body
			};
		}
		function displayStatus(t) {
			if (t.outOfScope) return "out_of_scope";
			if (t.resolved) return "resolved";
			if (t.claimedBy) return "claimed";
			return "open";
		}
		function ticketNum(file) {
			const m = file.match(/^(\d+)/);
			return m ? Number(m[1]) : 0;
		}
		function md(text) {
			return "<p>" + text.replace(/^### (.+)$/gm, "<h4>$1</h4>").replace(/^## (.+)$/gm, "<h3>$1</h3>").replace(/^# (.+)$/gm, "<h2>$1</h2>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/^- (.+)$/gm, "<li>$1</li>").replace(/^---$/gm, "<hr/>").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>") + "</p>";
		}
		const TYPE_THEME = {
			research: {
				icon: "🔍",
				color: "#7c6bff"
			},
			grilling: {
				icon: "🔥",
				color: "#ff6b6b"
			},
			prototype: {
				icon: "🛠️",
				color: "#ffa94d"
			},
			task: {
				icon: "⚡",
				color: "#4dabf7"
			}
		};
		const DOT = {
			open: "#6b6b8a",
			claimed: "#f0a500",
			resolved: "#2ecc71",
			out_of_scope: "#555577"
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
		const BG = "#0d0d1a", CARD = "#2d2d52", CARD_DARK = "#1a1a36", TEXT = "#e0e0f0";
		const BORDER = "#2a2a4e", BORDER_LIGHT = "#26264a", HEADER_BG = "#161628";
		async function loadPlan(scope, planDir) {
			let effortDir = planDir;
			const rootTree = await fsTree(scope, planDir);
			if (!rootTree.entries.some((e) => e.name === "map.md" && !e.isDir)) {
				for (const d of rootTree.entries.filter((e) => e.isDir)) if ((await fsTree(scope, d.path)).entries.some((e) => e.name === "map.md" && !e.isDir)) {
					effortDir = d.path;
					break;
				}
			}
			const [mapRes, treeRes] = await Promise.all([fsRead(scope, `${effortDir}/map.md`), fsTree(scope, `${effortDir}/tickets`)]);
			const mapRaw = mapRes.kind === "text" ? mapRes.content : "";
			const mdFiles = treeRes.entries.filter((e) => e.name.endsWith(".md") && !e.isDir);
			const raws = await Promise.all(mdFiles.map((e) => fsRead(scope, e.path).then((r) => r.kind === "text" ? r.content : "")));
			return {
				mapRaw,
				tickets: mdFiles.map((e, i) => deriveTicketStatus(e.name, raws[i] ?? "")),
				effortDir
			};
		}
		function DetailModal({ ticket, planDir, scope, onClose }) {
			const [fullBody, setFullBody] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let alive = true;
				fsRead(scope, `${planDir}/tickets/${ticket.file}`).then((r) => {
					if (alive && r.kind === "text") setFullBody(r.content);
				});
				return () => {
					alive = false;
				};
			}, [
				ticket.file,
				planDir,
				scope
			]);
			const body = fullBody ?? ticket.body;
			return (0, react_jsx_runtime.jsx)("div", {
				style: {
					position: "fixed",
					inset: 0,
					background: "rgba(5,5,15,.7)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 100
				},
				onClick: onClose,
				children: (0, react_jsx_runtime.jsxs)("div", {
					style: {
						width: "min(560px, 90vw)",
						maxHeight: "78vh",
						overflow: "auto",
						background: HEADER_BG,
						border: `1px solid ${BORDER}`,
						borderRadius: 14,
						padding: 18
					},
					onClick: (e) => e.stopPropagation(),
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									style: { color: DOT[displayStatus(ticket)] },
									children: TYPE_THEME[ticket.type ?? ""]?.icon ?? "…"
								}),
								(0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 16,
										fontWeight: 700,
										color: TEXT,
										lineHeight: 1.4,
										flex: 1
									},
									children: ticket.title
								}),
								(0, react_jsx_runtime.jsx)("button", {
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
						(0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 8
							},
							children: [
								(0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#1e1e3a",
										color: "#888",
										border: `1px solid ${BORDER}`
									},
									children: ["#", ticketNum(ticket.file)]
								}),
								ticket.type && (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: `${TYPE_THEME[ticket.type]?.color ?? "#888"}22`,
										color: TYPE_THEME[ticket.type]?.color ?? "#888"
									},
									children: ticket.type
								}),
								(0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#1e1e3a",
										color: DOT[displayStatus(ticket)],
										border: `1px solid ${BORDER}`
									},
									children: STATUS_LABELS[displayStatus(ticket)]
								}),
								ticket.claimedBy && (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#f0a50022",
										color: "#f0a500"
									},
									children: ["👤 ", ticket.claimedBy]
								}),
								ticket.blockedBy.length > 0 && (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#ff6b6b22",
										color: "#ff6b6b"
									},
									children: ["blocked_by: ", ticket.blockedBy.map((n) => `#${n}`).join(", ")]
								})
							]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							style: {
								marginTop: 14,
								fontSize: 12.5,
								lineHeight: 1.75,
								color: "#c8c8e8",
								background: "#1e1e3a",
								border: `1px solid ${BORDER}`,
								borderRadius: 8,
								padding: 12
							},
							dangerouslySetInnerHTML: { __html: md(body) }
						})
					]
				})
			});
		}
		function ViewA({ tickets, planDir, scope, destination }) {
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
			const active = tickets.filter((t) => !t.outOfScope);
			const done = tickets.filter((t) => t.resolved).length;
			const pct = active.length > 0 ? Math.round(done / active.length * 100) : 0;
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "12px 16px 0",
							display: "flex",
							justifyContent: "space-between"
						},
						children: [(0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Kanban"
						}), (0, react_jsx_runtime.jsxs)("span", {
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
					destination && (0, react_jsx_runtime.jsx)("div", {
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
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							margin: "8px 16px 0",
							display: "flex",
							alignItems: "center",
							gap: 10
						},
						children: [(0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								height: 6,
								borderRadius: 3,
								background: "#1e1e3a",
								border: `1px solid ${BORDER}`,
								overflow: "hidden"
							},
							children: (0, react_jsx_runtime.jsx)("div", { style: {
								height: "100%",
								width: `${pct}%`,
								borderRadius: 3,
								background: "linear-gradient(90deg, #2ecc71, #7c6bff)"
							} })
						}), (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: "#2ecc71",
								minWidth: 36,
								textAlign: "right"
							},
							children: [pct, "%"]
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							gap: 10,
							padding: "12px 16px",
							overflowX: "auto"
						},
						children: STATUS_ORDER.filter((s) => groups[s].length > 0).map((s) => (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 0",
								minWidth: 200,
								display: "flex",
								flexDirection: "column",
								background: "#080814",
								border: `1px solid ${BORDER_LIGHT}`,
								borderRadius: 10,
								overflow: "hidden"
							},
							children: [(0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "7px 10px",
									display: "flex",
									alignItems: "center",
									gap: 7,
									borderBottom: `1px solid ${BORDER_LIGHT}`,
									background: "#121224"
								},
								children: [
									(0, react_jsx_runtime.jsx)("span", { style: {
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: DOT[s]
									} }),
									(0, react_jsx_runtime.jsx)("span", {
										style: {
											fontWeight: 700,
											fontSize: 12
										},
										children: STATUS_LABELS[s]
									}),
									(0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											color: "#888"
										},
										children: groups[s].length
									})
								]
							}), (0, react_jsx_runtime.jsx)("div", {
								style: {
									flex: 1,
									overflowY: "auto",
									padding: 6,
									display: "flex",
									flexDirection: "column",
									gap: 6
								},
								children: groups[s].map((t) => (0, react_jsx_runtime.jsxs)("div", {
									style: {
										padding: 8,
										borderRadius: 8,
										background: CARD,
										border: `1px solid ${BORDER}`,
										cursor: "pointer"
									},
									onClick: () => setFocus(t),
									children: [(0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 6
										},
										children: [
											(0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													fontFamily: "monospace",
													color: "#888",
													background: "#1e1e3a",
													borderRadius: 999,
													width: 20,
													height: 20,
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													fontWeight: 700
												},
												children: String(ticketNum(t.file)).padStart(2, "0")
											}),
											(0, react_jsx_runtime.jsx)("span", {
												style: { fontSize: 12 },
												children: TYPE_THEME[t.type ?? ""]?.icon ?? "?"
											}),
											(0, react_jsx_runtime.jsx)("span", {
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
									}), (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											gap: 4,
											marginTop: 6,
											flexWrap: "wrap"
										},
										children: [
											t.type && (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 5px",
													borderRadius: 999,
													background: `${TYPE_THEME[t.type]?.color ?? "#888"}22`,
													color: TYPE_THEME[t.type]?.color ?? "#888"
												},
												children: t.type
											}),
											t.claimedBy && (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 5px",
													borderRadius: 999,
													background: "#f0a50022",
													color: "#f0a500"
												},
												children: ["👤 ", t.claimedBy]
											}),
											t.blockedBy.length > 0 && (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 5px",
													borderRadius: 999,
													background: "#ff6b6b22",
													color: "#ff6b6b"
												},
												children: [" ", t.blockedBy.map((n) => `#${n}`).join(",")]
											})
										]
									})]
								}, t.file))
							})]
						}, s))
					}),
					focus && (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						onClose: () => setFocus(null)
					})
				]
			});
		}
		function ViewC({ tickets, planDir, scope }) {
			const [query, setQuery] = (0, react.useState)("");
			const [statusSet, setStatusSet] = (0, react.useState)(() => new Set(STATUS_ORDER));
			const [typeSet, setTypeSet] = (0, react.useState)(() => new Set(Object.keys(TYPE_THEME)));
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
					if (!typeSet.has(t.type ?? "")) return false;
					if (query && !`${t.title} ${t.body} ${t.claimedBy ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
					return true;
				});
				out = [...out].sort((a, b) => {
					let v = 0;
					if (sort.key === "num") v = ticketNum(a.file) - ticketNum(b.file);
					else if (sort.key === "status") v = STATUS_ORDER.indexOf(displayStatus(a)) - STATUS_ORDER.indexOf(displayStatus(b));
					else v = (a.type ?? "").localeCompare(b.type ?? "");
					return v * sort.dir;
				});
				return out;
			}, [
				tickets,
				query,
				statusSet,
				typeSet,
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
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 16px",
							background: HEADER_BG,
							borderBottom: `1px solid ${BORDER}`,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 10
						},
						children: [(0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Table"
						}), (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [
								rows.length,
								"/",
								tickets.length,
								" tickets"
							]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							display: "flex",
							overflow: "hidden"
						},
						children: [(0, react_jsx_runtime.jsxs)("div", {
							style: {
								width: 200,
								flexShrink: 0,
								background: "#121224",
								borderRight: `1px solid ${BORDER}`,
								padding: 12,
								display: "flex",
								flexDirection: "column",
								gap: 14,
								overflowY: "auto"
							},
							children: [
								(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Search"
								}), (0, react_jsx_runtime.jsx)("input", {
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
								(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Status"
								}), STATUS_ORDER.map((s) => (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										color: "#c8c8e8",
										cursor: "pointer",
										padding: "1px 0"
									},
									children: [
										(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: statusSet.has(s),
											onChange: () => setStatusSet(toggle(statusSet, s))
										}),
										(0, react_jsx_runtime.jsx)("span", {
											style: { color: DOT[s] },
											children: "●"
										}),
										" ",
										STATUS_LABELS[s]
									]
								}, s))] }),
								(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Type"
								}), (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										flexWrap: "wrap",
										gap: 4
									},
									children: Object.keys(TYPE_THEME).map((t) => {
										const on = typeSet.has(t);
										return (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "2px 7px",
												borderRadius: 999,
												cursor: "pointer",
												border: `1px solid ${TYPE_THEME[t].color}`,
												color: TYPE_THEME[t].color,
												background: on ? TYPE_THEME[t].color : "transparent"
											},
											onClick: () => setTypeSet(toggle(typeSet, t)),
											children: [
												TYPE_THEME[t].icon,
												" ",
												t
											]
										}, t);
									})
								})] }),
								(0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										color: "#c8c8e8",
										cursor: "pointer"
									},
									children: [(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: onlyBlocked,
										onChange: (e) => setOnlyBlocked(e.target.checked)
									}), " Only blocked"]
								}),
								(0, react_jsx_runtime.jsx)("button", {
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
										setStatusSet(new Set(STATUS_ORDER));
										setTypeSet(new Set(Object.keys(TYPE_THEME)));
										setOnlyBlocked(false);
									},
									children: "Reset"
								})
							]
						}), (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								overflowY: "auto",
								padding: 12
							},
							children: rows.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: 40,
									textAlign: "center",
									color: "#55557a"
								},
								children: "No matching tickets"
							}) : (0, react_jsx_runtime.jsxs)("table", {
								style: {
									width: "100%",
									borderCollapse: "separate",
									borderSpacing: 0,
									background: HEADER_BG,
									borderRadius: 8,
									overflow: "hidden",
									fontSize: 12
								},
								children: [(0, react_jsx_runtime.jsx)("thead", { children: (0, react_jsx_runtime.jsxs)("tr", { children: [
									(0, react_jsx_runtime.jsxs)("th", {
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
									(0, react_jsx_runtime.jsx)("th", {
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
									(0, react_jsx_runtime.jsxs)("th", {
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
									(0, react_jsx_runtime.jsxs)("th", {
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
									(0, react_jsx_runtime.jsx)("th", {
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
									(0, react_jsx_runtime.jsx)("th", {
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
								] }) }), (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((t) => {
									const th = TYPE_THEME[t.type ?? ""] ?? {
										icon: "?",
										color: "#888"
									};
									return (0, react_jsx_runtime.jsxs)("tr", {
										style: { cursor: "pointer" },
										onClick: () => setDetail(t),
										children: [
											(0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid #1e1e3a`,
													fontFamily: "monospace",
													color: "#8a8ab0",
													fontSize: 11
												},
												children: String(ticketNum(t.file)).padStart(2, "0")
											}),
											(0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid #1e1e3a`,
													fontWeight: 600,
													color: TEXT,
													maxWidth: 200,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap"
												},
												children: t.title
											}),
											(0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid #1e1e3a`
												},
												children: (0, react_jsx_runtime.jsxs)("span", {
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
														t.type
													]
												})
											}),
											(0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid #1e1e3a`
												},
												children: (0, react_jsx_runtime.jsxs)("span", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 5
													},
													children: [(0, react_jsx_runtime.jsx)("span", { style: {
														width: 7,
														height: 7,
														borderRadius: "50%",
														background: DOT[displayStatus(t)]
													} }), STATUS_LABELS[displayStatus(t)]]
												})
											}),
											(0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid #1e1e3a`,
													color: t.claimedBy ? "#f0a500" : "#55557a"
												},
												children: t.claimedBy ?? "—"
											}),
											(0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid #1e1e3a`,
													color: t.blockedBy.length > 0 ? "#ff6b6b" : "#55557a",
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
					detail && (0, react_jsx_runtime.jsx)(DetailModal, {
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
		function layoutGraph(tickets) {
			const byNum = new Map(tickets.map((t) => [ticketNum(t.file), t]));
			const grid = tickets.filter((t) => !t.outOfScope);
			const side = tickets.filter((t) => t.outOfScope);
			const depth = /* @__PURE__ */ new Map();
			const visit = (n) => {
				if (depth.has(n)) return depth.get(n);
				const t = byNum.get(n);
				if (!t) return 0;
				const d = t.blockedBy.filter((b) => byNum.has(b) && !byNum.get(b).outOfScope).reduce((m, b) => Math.max(m, visit(b)), 0) + 1;
				depth.set(n, d);
				return d;
			};
			for (const t of grid) visit(ticketNum(t.file));
			const maxL = Math.max(1, ...grid.map((t) => depth.get(ticketNum(t.file))));
			const layers = Array.from({ length: maxL }, () => []);
			for (const t of grid) layers[depth.get(ticketNum(t.file)) - 1].push(t);
			layers[0].sort((a, b) => ticketNum(a.file) - ticketNum(b.file));
			for (let l = 1; l < maxL; l++) {
				const upIdx = /* @__PURE__ */ new Map();
				layers[l - 1].forEach((t, i) => upIdx.set(ticketNum(t.file), i));
				layers[l].sort((a, b) => {
					return a.blockedBy.filter((p) => upIdx.has(p)).reduce((s, p) => s + upIdx.get(p), 0) / Math.max(1, a.blockedBy.filter((p) => upIdx.has(p)).length) - b.blockedBy.filter((p) => upIdx.has(p)).reduce((s, p) => s + upIdx.get(p), 0) / Math.max(1, b.blockedBy.filter((p) => upIdx.has(p)).length) || ticketNum(a.file) - ticketNum(b.file);
				});
			}
			const maxCount = Math.max(...layers.map((o) => o.length), 1);
			const W = Math.max(600, maxCount * STEP_X + 40);
			const pos = /* @__PURE__ */ new Map();
			layers.forEach((o, li) => {
				const left = (W - (o.length * STEP_X - 24)) / 2;
				o.forEach((t, i) => {
					const x = left + i * STEP_X;
					pos.set(ticketNum(t.file), {
						x,
						cx: x + NODE_W / 2,
						y: RUNG_TOP + li * RUNG_STEP
					});
				});
			});
			const sidePos = /* @__PURE__ */ new Map();
			for (const t of side) {
				const n = ticketNum(t.file);
				const p = t.blockedBy.find((b) => byNum.has(b) && !byNum.get(b).outOfScope);
				if (p !== void 0 ? pos.get(p) : void 0) {
					const sideTier = layers.findIndex((l) => l.some((tk) => ticketNum(tk.file) === p)) + 1;
					const sideY = RUNG_TOP + sideTier * RUNG_STEP;
					const tierTk = layers[sideTier] ?? [];
					const rightmost = tierTk.length > 0 ? Math.max(...tierTk.map((tk) => pos.get(ticketNum(tk.file)).x)) : (W - NODE_W) / 2;
					sidePos.set(n, {
						x: rightmost + STEP_X,
						cx: rightmost + STEP_X + NODE_W / 2,
						y: sideY
					});
				} else sidePos.set(n, {
					x: W / 2 - NODE_W / 2,
					cx: W / 2,
					y: RUNG_TOP
				});
			}
			const childrenOf = /* @__PURE__ */ new Map();
			const edges = [];
			for (const t of grid) {
				const n = ticketNum(t.file);
				for (const p of t.blockedBy) if (byNum.has(p) && !byNum.get(p).outOfScope) {
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
			layers[0].map((t) => ticketNum(t.file)).forEach((r, i) => edges.push({
				from: -1,
				to: r,
				key: `s${i}`
			}));
			grid.filter((t) => (childrenOf.get(ticketNum(t.file)) ?? []).length === 0 && t.resolved).map((t) => ticketNum(t.file)).forEach((l, i) => edges.push({
				from: l,
				to: -2,
				key: `l${i}`
			}));
			for (const t of side) {
				const n = ticketNum(t.file);
				const p = t.blockedBy.find((b) => byNum.has(b));
				if (p !== void 0) edges.push({
					from: p,
					to: n,
					dashed: true,
					key: `d${p}-${n}`
				});
			}
			const endY = RUNG_TOP + (maxL - 1) * RUNG_STEP + END_GAP;
			return {
				pos,
				sidePos,
				edges,
				W,
				H: endY + CAP_H / 2 + 40,
				endY,
				startCapY: START_Y - CAP_H / 2,
				endCapY: endY - CAP_H / 2
			};
		}
		function ViewD({ tickets, planDir, scope }) {
			const [sel, setSel] = (0, react.useState)(null);
			const [hover, setHover] = (0, react.useState)(null);
			const { pos, sidePos, edges, W, H, startCapY, endCapY, endY } = (0, react.useMemo)(() => layoutGraph(tickets), [tickets]);
			const focus = tickets.find((t) => ticketNum(t.file) === sel) ?? null;
			const conn = (n) => {
				const keys = /* @__PURE__ */ new Set();
				for (const e of edges) if (e.from === n || e.to === n) keys.add(e.key);
				return keys;
			};
			const mk = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
			return (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT,
					overflow: "hidden"
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "12px 16px 8px",
							display: "flex",
							justifyContent: "space-between"
						},
						children: [(0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Relation"
						}), (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [tickets.length, " tickets · hover / click node to highlight edges"]
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflow: "auto",
							position: "relative",
							cursor: "default"
						},
						onClick: () => setSel(null),
						children: (0, react_jsx_runtime.jsxs)("div", {
							style: {
								position: "relative",
								width: W,
								height: H,
								margin: "0 auto"
							},
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									style: {
										position: "absolute",
										left: W / 2 - CAP_W / 2,
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
									const t = tickets.find((x) => ticketNum(x.file) === n);
									return (0, react_jsx_runtime.jsxs)("div", {
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
										children: [(0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											borderTopLeftRadius: 10,
											borderBottomLeftRadius: 10,
											background: DOT[displayStatus(t)]
										} }), (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 8px 7px 8px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [(0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 5
												},
												children: [
													(0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 9,
															fontFamily: "monospace",
															color: "#888",
															background: "#1e1e3a",
															borderRadius: 999,
															width: 18,
															height: 18,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															fontWeight: 700
														},
														children: String(n).padStart(2, "0")
													}),
													(0, react_jsx_runtime.jsx)("span", {
														style: { fontSize: 12 },
														children: TYPE_THEME[t.type ?? ""]?.icon ?? "?"
													}),
													(0, react_jsx_runtime.jsx)("span", {
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
											}), (0, react_jsx_runtime.jsxs)("div", {
												style: {
													fontSize: 9,
													color: "#8a8ab0",
													display: "flex",
													gap: 6
												},
												children: [STATUS_LABELS[displayStatus(t)], t.claimedBy && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" 👤 ", t.claimedBy] })]
											})]
										})]
									}, n);
								}),
								[...sidePos.entries()].map(([n, p]) => {
									const t = tickets.find((x) => ticketNum(x.file) === n);
									return (0, react_jsx_runtime.jsxs)("div", {
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
										children: [(0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											background: "#383860"
										} }), (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 8px 7px 8px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [(0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 5
												},
												children: [
													(0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 9,
															fontFamily: "monospace",
															color: "#888",
															background: "#1e1e3a",
															borderRadius: 999,
															width: 18,
															height: 18,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															fontWeight: 700
														},
														children: String(n).padStart(2, "0")
													}),
													(0, react_jsx_runtime.jsx)("span", {
														style: { fontSize: 12 },
														children: "⛔"
													}),
													(0, react_jsx_runtime.jsx)("span", {
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
											}), (0, react_jsx_runtime.jsx)("div", {
												style: {
													fontSize: 9,
													color: "#8a8ab0"
												},
												children: "ruled out"
											})]
										})]
									}, n);
								}),
								(0, react_jsx_runtime.jsx)("div", {
									style: {
										position: "absolute",
										left: W / 2 - CAP_W / 2,
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
								(0, react_jsx_runtime.jsxs)("svg", {
									width: W,
									height: H,
									style: {
										position: "absolute",
										left: 0,
										top: 0,
										pointerEvents: "none",
										zIndex: 1
									},
									children: [(0, react_jsx_runtime.jsxs)("defs", { children: [(0, react_jsx_runtime.jsx)("marker", {
										id: "da",
										viewBox: "0 0 10 10",
										refX: "8.5",
										refY: "5",
										markerWidth: "6",
										markerHeight: "6",
										orient: "auto-start-reverse",
										children: (0, react_jsx_runtime.jsx)("path", {
											d: "M 0 0 L 10 5 L 0 10 z",
											fill: "#454570"
										})
									}), (0, react_jsx_runtime.jsx)("marker", {
										id: "da2",
										viewBox: "0 0 10 10",
										refX: "8.5",
										refY: "5",
										markerWidth: "6",
										markerHeight: "6",
										orient: "auto-start-reverse",
										children: (0, react_jsx_runtime.jsx)("path", {
											d: "M 0 0 L 10 5 L 0 10 z",
											fill: TEXT
										})
									})] }), edges.map((e) => {
										const aPos = e.from === -1 ? {
											cx: W / 2,
											y: startCapY
										} : pos.get(e.from);
										const bPos = e.to === -2 ? {
											cx: W / 2,
											y: endY
										} : pos.get(e.to) ?? sidePos.get(e.to);
										if (!aPos || !bPos) return null;
										const active = hover ?? sel;
										const connected = active === null || conn(active).has(e.key);
										const sx = aPos.cx, sy = e.from === -1 ? startCapY + CAP_H : aPos.y + NODE_H;
										const ex = e.to === -2 ? W / 2 : bPos.cx;
										const ey = e.to === -2 ? endY : e.dashed ? bPos.y : bPos.y + NODE_H / 2;
										const sw = e.dashed ? 1.4 : connected ? 3 : 1.4;
										const sc = e.dashed ? "#666688" : connected ? TEXT : "#454570";
										return (0, react_jsx_runtime.jsx)("path", {
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
					focus && (0, react_jsx_runtime.jsx)(DetailModal, {
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
			const [mapRaw, setMapRaw] = (0, react.useState)(null);
			const [tickets, setTickets] = (0, react.useState)([]);
			const [effortDir, setEffortDir] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [variant, setVariant] = (0, react.useState)("A");
			const load = (0, react.useCallback)(async () => {
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
					setMapRaw(r.mapRaw);
					setTickets(r.tickets);
					setEffortDir(r.effortDir);
				} catch {
					setError("failed");
				} finally {
					setLoading(false);
				}
			}, [scope.sessionId, scope.cwd]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const destination = (0, react.useMemo)(() => {
				if (!mapRaw) return null;
				return mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/)?.[1]?.trim().split("\n")[0]?.trim() ?? null;
			}, [mapRaw]);
			if (loading) return (0, react_jsx_runtime.jsx)("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: BG,
					color: "#888"
				},
				children: "Loading…"
			});
			if (error) return (0, react_jsx_runtime.jsx)("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: BG,
					color: "#888"
				},
				children: "No .plan found in current directory."
			});
			const toggleBtn = (active) => ({
				flex: 1,
				padding: "6px 0",
				border: "none",
				borderRadius: 6,
				cursor: "pointer",
				background: active ? HEADER_BG : "transparent",
				color: active ? TEXT : "#888",
				fontSize: 12
			});
			return (0, react_jsx_runtime.jsxs)("div", {
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
					(0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 2,
							padding: "4px 8px",
							borderBottom: `1px solid ${BORDER}`,
							background: HEADER_BG
						},
						children: [
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: toggleBtn(variant === "A"),
								onClick: () => setVariant("A"),
								children: "📋 Kanban"
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: toggleBtn(variant === "D"),
								onClick: () => setVariant("D"),
								children: "📊 Relation"
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: toggleBtn(variant === "C"),
								onClick: () => setVariant("C"),
								children: " Table"
							})
						]
					}),
					variant === "A" && (0, react_jsx_runtime.jsx)(ViewA, {
						tickets,
						planDir: effortDir,
						scope,
						destination
					}),
					variant === "D" && (0, react_jsx_runtime.jsx)(ViewD, {
						tickets,
						planDir: effortDir,
						scope
					}),
					variant === "C" && (0, react_jsx_runtime.jsx)(ViewC, {
						tickets,
						planDir: effortDir,
						scope
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		const inject = ["betterSidebar", "slots"];
		function apply(ctx) {
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-plan-view:plan",
				title: () => "Plan",
				icon: (size) => (0, react_jsx_runtime.jsxs)("svg", {
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					children: [
						(0, react_jsx_runtime.jsx)("rect", {
							x: "1",
							y: "1",
							width: "14",
							height: "14",
							rx: "3",
							stroke: "currentColor",
							strokeWidth: "1.5"
						}),
						(0, react_jsx_runtime.jsx)("line", {
							x1: "4",
							y1: "5",
							x2: "12",
							y2: "5",
							stroke: "currentColor",
							strokeWidth: "1.2"
						}),
						(0, react_jsx_runtime.jsx)("line", {
							x1: "4",
							y1: "8",
							x2: "12",
							y2: "8",
							stroke: "currentColor",
							strokeWidth: "1.2"
						}),
						(0, react_jsx_runtime.jsx)("line", {
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
				component: (props) => (0, react_jsx_runtime.jsx)(PlanView, { ...props })
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map