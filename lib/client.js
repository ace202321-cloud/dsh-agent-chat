window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-agent-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-agent-chat — client 侧（右侧栏 tab 类型）
		*
		* 官方架构：右侧栏是 DSH 原生栏，插件「只提供 tab 类型」。
		* 两阶段注册（照抄官方 ui-sidebar-documentpreview 的公开路径）：
		*   阶段 1  ctx.sidebarRightTabs.register({ id, kind, title, keepMounted })
		*   阶段 2  ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)
		*
		* 2026-10-18 修订（Codex + Claude Code 双审后）：
		*  - 未读逻辑：已读位置持久化到 localStorage，首包只做基线，请求失败不重置，折叠时不推进
		*  - 轮询：inFlight 锁 + 序号，避免慢请求并发、旧响应覆盖新数据
		*  - React key 加下标，避免重复 #N 时复用错节点
		*  - 去掉依赖未注入服务的 openTab 调用（它一直是静默失败的）
		*  - 按署名筛选时，跳转到被隐藏的目标会自动清空筛选
		*/
		const inject = ["slots", "sidebarRightTabs"];
		const API = "/@dsh-external/dsh-agent-chat/api";
		const POLL_MS = 2e3;
		const SEEN_STORE = "dsh-agent-chat:seen";
		const TAB_ID = "@dsh-external/dsh-agent-chat";
		const TAB_KIND = "agent-chat";
		const TAB_TITLE = "代理对话";
		const PALETTE = [
			"#4e8cff",
			"#e8912d",
			"#22a06b",
			"#c05050",
			"#8e5bd0",
			"#0aa3a3",
			"#b8781a",
			"#5a6b7b"
		];
		/** 状态呈现：颜色 + 中文标签 */
		const STATUS_META = {
			open: {
				color: "#c05050",
				label: "待接"
			},
			claimed: {
				color: "#e8912d",
				label: "进行中"
			},
			done: {
				color: "#22a06b",
				label: "已完成"
			}
		};
		/** 阶段呈现（借 brianyu18/devteam 的 7 阶段） */
		const PHASE_META = {
			think: {
				label: "想",
				color: "#8e5bd0"
			},
			plan: {
				label: "计划",
				color: "#4e8cff"
			},
			build: {
				label: "实现",
				color: "#22a06b"
			},
			review: {
				label: "评审",
				color: "#e8912d"
			},
			test: {
				label: "测试",
				color: "#0aa3a3"
			},
			ship: {
				label: "发布",
				color: "#c05050"
			},
			reflect: {
				label: "复盘",
				color: "#5a6b7b"
			}
		};
		/**
		* 渲染窗口：只渲染最近这么多条，更早的用「加载更早」翻。
		* ⚠️ 这是长对话不卡的关键 —— 上千条消息全部变 DOM 节点会拖死面板。
		* 解析层没问题（O(n) 行扫），卡的是渲染层。
		*/
		const WINDOW_SIZE = 200;
		const h = react.createElement;
		/** 已读位置：按 mailbox 区分存储 */
		function loadSeen(mailbox) {
			if (!mailbox) return -1;
			try {
				const raw = localStorage.getItem(SEEN_STORE);
				if (!raw) return -1;
				const j = JSON.parse(raw);
				return j && j.mailbox === mailbox && typeof j.n === "number" ? j.n : -1;
			} catch {
				return -1;
			}
		}
		function saveSeen(mailbox, n) {
			if (!mailbox) return;
			try {
				localStorage.setItem(SEEN_STORE, JSON.stringify({
					mailbox,
					n
				}));
			} catch {}
		}
		function esc(s) {
			return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
				return {
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					"\"": "&quot;",
					"'": "&#39;"
				}[c];
			});
		}
		function colorOf(sig, sigs) {
			const i = sigs.indexOf(sig);
			return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
		}
		function relTime(t, now) {
			const d = new Date(t);
			if (isNaN(d.getTime())) return t;
			const sec = Math.floor((now - d.getTime()) / 1e3);
			if (sec < 60) return "刚刚";
			if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
			if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
			return Math.floor(sec / 86400) + " 天前";
		}
		function inline(s) {
			return esc(s).replace(/`([^`]+)`/g, "<code style=\"background:#f0f2f4;border-radius:3px;padding:1px 4px;font-size:12px\">$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		}
		function md(text) {
			const out = [];
			const lines = String(text == null ? "" : text).split("\n");
			let i = 0;
			while (i < lines.length) {
				const line = lines[i];
				if (/^\s*```/.test(line)) {
					const buf = [];
					i++;
					while (i < lines.length && !/^\s*```/.test(lines[i])) {
						buf.push(lines[i]);
						i++;
					}
					i++;
					out.push("<pre style=\"background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:8px;overflow:auto;font-size:12px;margin:6px 0\"><code>" + esc(buf.join("\n")) + "</code></pre>");
					continue;
				}
				if (/^\s*~~~/.test(line)) {
					const buf = [];
					i++;
					while (i < lines.length && !/^\s*~~~/.test(lines[i])) {
						buf.push(lines[i]);
						i++;
					}
					i++;
					out.push("<pre style=\"background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:8px;overflow:auto;font-size:12px;margin:6px 0\"><code>" + esc(buf.join("\n")) + "</code></pre>");
					continue;
				}
				if (/^\s*\|.*\|\s*$/.test(line)) {
					const rows = [];
					while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
						rows.push(lines[i]);
						i++;
					}
					const body = rows.map(function(r) {
						return r.trim().replace(/^\||\|$/g, "").split("|").map(function(c) {
							return c.trim();
						});
					}).filter(function(r) {
						return !r.every(function(c) {
							return /^:?-{2,}:?$/.test(c);
						});
					});
					if (body.length) {
						const head = body[0];
						const rest = body.slice(1);
						out.push("<table style=\"border-collapse:collapse;width:100%;font-size:12px;margin:6px 0\"><thead><tr>" + head.map(function(c) {
							return "<th style=\"border:1px solid #d0d7de;background:#f3f5f7;padding:4px 6px;text-align:left\">" + inline(c) + "</th>";
						}).join("") + "</tr></thead><tbody>" + rest.map(function(r) {
							return "<tr>" + r.map(function(c) {
								return "<td style=\"border:1px solid #d0d7de;padding:4px 6px\">" + inline(c) + "</td>";
							}).join("") + "</tr>";
						}).join("") + "</tbody></table>");
					}
					continue;
				}
				if (/^\s*-{3,}\s*$/.test(line)) {
					out.push("<hr style=\"border:none;border-top:1px solid #e1e4e8;margin:8px 0\">");
					i++;
					continue;
				}
				const hh = /^(#{1,6})\s+(.*)$/.exec(line);
				if (hh) {
					const lv = hh[1].length;
					out.push("<div style=\"font-weight:700;font-size:" + ([
						18,
						16,
						15,
						14,
						13,
						12
					][lv - 1] || 12) + "px;margin:10px 0 4px;color:#1f3b63\">" + inline(hh[2]) + "</div>");
					i++;
					continue;
				}
				const li = /^\s*[-*+]\s+(.*)$/.exec(line);
				if (li) {
					const buf = [li[1]];
					i++;
					while (i < lines.length) {
						const m2 = /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
						if (!m2) break;
						buf.push(m2[1]);
						i++;
					}
					out.push("<ul style=\"margin:4px 0 4px 18px;padding:0\">" + buf.map(function(b) {
						return "<li style=\"margin:2px 0\">" + inline(b) + "</li>";
					}).join("") + "</ul>");
					continue;
				}
				if (!line.trim()) {
					i++;
					continue;
				}
				out.push("<div style=\"margin:3px 0\">" + inline(line) + "</div>");
				i++;
			}
			return out.join("");
		}
		/** 右侧栏 tab 正文 */
		function AgentChatBody(_props) {
			const [data, setData] = react.useState({
				ok: true,
				messages: [],
				signatures: []
			});
			const [collapsed, setCollapsed] = react.useState(false);
			const [filterSig, setFilterSig] = react.useState("");
			const [onlyPending, setOnlyPending] = react.useState(false);
			const [windowSize, setWindowSize] = react.useState(WINDOW_SIZE);
			const [now, setNow] = react.useState(Date.now());
			const [seenUpTo, setSeenUpTo] = react.useState(-1);
			const listRef = react.useRef(null);
			const nearBottomRef = react.useRef(true);
			const inFlightRef = react.useRef(false);
			const seqRef = react.useRef(0);
			const mailboxRef = react.useRef(void 0);
			react.useEffect(function() {
				let alive = true;
				let timer = null;
				const tick = async () => {
					if (inFlightRef.current) return;
					inFlightRef.current = true;
					const my = ++seqRef.current;
					const ac = new AbortController();
					const killTimer = setTimeout(function() {
						try {
							ac.abort();
						} catch {}
					}, 6e3);
					try {
						const r = await fetch(API, {
							cache: "no-store",
							signal: ac.signal
						});
						const j = r.ok ? await r.json() : {
							ok: false,
							reason: "HTTP " + r.status,
							messages: [],
							signatures: []
						};
						if (!alive || my !== seqRef.current) return;
						setData(j);
						setNow(Date.now());
					} catch (e) {
						if (!alive || my !== seqRef.current) return;
						setData(function(prev) {
							return {
								ok: false,
								reason: String(e && e.message || e),
								file: prev && prev.file,
								mailbox: prev && prev.mailbox,
								messages: prev && prev.messages,
								signatures: prev && prev.signatures
							};
						});
					} finally {
						clearTimeout(killTimer);
						if (my === seqRef.current) inFlightRef.current = false;
					}
				};
				tick();
				timer = setInterval(function() {
					tick();
				}, POLL_MS);
				return function() {
					alive = false;
					if (timer) clearInterval(timer);
				};
			}, []);
			const msgs = Array.isArray(data.messages) ? data.messages : [];
			const sigs = Array.isArray(data.signatures) ? data.signatures : [];
			const filtered = msgs.filter(function(m) {
				if (filterSig && m.sig !== filterSig) return false;
				if (onlyPending && m.status !== "open" && m.status !== "claimed") return false;
				return true;
			});
			const hiddenCount = Math.max(0, filtered.length - windowSize);
			const shown = hiddenCount > 0 ? filtered.slice(hiddenCount) : filtered;
			let maxN = 0;
			for (const m of msgs) if ((m.n || 0) > maxN) maxN = m.n || 0;
			react.useEffect(function() {
				const mailbox = data && data.mailbox;
				if (mailbox) mailboxRef.current = mailbox;
				if (!data || !data.ok || seenUpTo < 0) return;
				if (collapsed) return;
				if (!nearBottomRef.current) return;
				if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
				if (maxN > seenUpTo) {
					saveSeen(mailboxRef.current, maxN);
					setSeenUpTo(maxN);
				}
			});
			react.useEffect(function() {
				if (!data || !data.ok || !data.mailbox) return;
				if (seenUpTo === -1) {
					const seen = loadSeen(data.mailbox);
					setSeenUpTo(seen >= 0 ? seen : maxN);
				}
			}, [
				data,
				maxN,
				seenUpTo
			]);
			let unread = 0;
			for (const m of msgs) if ((m.n || 0) > seenUpTo) unread++;
			const pendingCount = typeof data.pendingCount === "number" ? data.pendingCount : msgs.filter(function(m) {
				return m.status === "open" || m.status === "claimed";
			}).length;
			const ackOverdueSet = {};
			if (Array.isArray(data.ackOverdue)) for (const n of data.ackOverdue) ackOverdueSet[n] = true;
			const ackOverdueCount = typeof data.ackOverdueCount === "number" ? data.ackOverdueCount : 0;
			react.useLayoutEffect(function() {
				const el = listRef.current;
				if (!el) return;
				if (collapsed) return;
				if (!nearBottomRef.current) return;
				el.scrollTop = el.scrollHeight;
			}, [
				maxN,
				filterSig,
				collapsed
			]);
			react.useEffect(function() {
				if (typeof document === "undefined") return;
				const onVis = function() {
					if (document.visibilityState !== "visible") return;
					const el = listRef.current;
					if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
				};
				document.addEventListener("visibilitychange", onVis);
				return function() {
					document.removeEventListener("visibilitychange", onVis);
				};
			}, []);
			const onScroll = function() {
				const el = listRef.current;
				if (!el) return;
				nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
			};
			const jumpTo = function(targetN) {
				let el = document.getElementById("agent-chat-msg-" + targetN);
				if (!el && filterSig) {
					setFilterSig("");
					setTimeout(function() {
						const again = document.getElementById("agent-chat-msg-" + targetN);
						if (again && again.scrollIntoView) again.scrollIntoView({
							behavior: "smooth",
							block: "center"
						});
					}, 60);
					return;
				}
				if (el && el.scrollIntoView) el.scrollIntoView({
					behavior: "smooth",
					block: "center"
				});
			};
			const header = h("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: "4px",
				padding: "8px 10px",
				borderBottom: "1px solid #e1e4e8",
				background: "#fff",
				flex: "none",
				flexWrap: "wrap"
			} }, h("span", { style: {
				fontWeight: 700,
				fontSize: "13px",
				color: "#1f3b63"
			} }, "代理对话"), unread > 0 ? h("span", { style: {
				background: "#c05050",
				color: "#fff",
				borderRadius: "9px",
				padding: "1px 7px",
				fontSize: "11px"
			} }, unread + " 新") : null, pendingCount > 0 ? h("span", {
				title: Object.keys(data.assignedTo || {}).map(function(k) {
					return k + ": " + data.assignedTo[k];
				}).join("\n"),
				style: {
					background: "#e8912d",
					color: "#fff",
					borderRadius: "9px",
					padding: "1px 7px",
					fontSize: "11px"
				}
			}, pendingCount + " 待办") : null, ackOverdueCount > 0 ? h("span", {
				title: "需回执但超过 5 分钟没回应的消息",
				style: {
					background: "#c05050",
					color: "#fff",
					borderRadius: "9px",
					padding: "1px 7px",
					fontSize: "11px"
				}
			}, "⚠ " + ackOverdueCount + " 超时") : null, h("span", { style: { flex: 1 } }), h("button", {
				onClick: function() {
					setOnlyPending(!onlyPending);
				},
				title: "只显示 open / claimed 的消息",
				style: {
					fontSize: "11px",
					border: "1px solid " + (onlyPending ? "#e8912d" : "#d0d7de"),
					background: onlyPending ? "#fff7ec" : "#fff",
					color: onlyPending ? "#b8781a" : "#555",
					borderRadius: "4px",
					padding: "2px 6px",
					cursor: "pointer"
				}
			}, onlyPending ? "只看未完成 ✓" : "只看未完成"), h("select", {
				value: filterSig,
				onChange: function(e) {
					setFilterSig(e.target.value);
				},
				style: {
					fontSize: "11px",
					border: "1px solid #d0d7de",
					borderRadius: "4px",
					padding: "2px 4px"
				}
			}, h("option", { value: "" }, "全部"), sigs.map(function(s) {
				return h("option", {
					key: s,
					value: s
				}, s);
			})), h("button", {
				onClick: function() {
					setCollapsed(!collapsed);
				},
				style: {
					fontSize: "11px",
					border: "1px solid #d0d7de",
					background: "#fff",
					borderRadius: "4px",
					padding: "2px 8px",
					cursor: "pointer",
					marginLeft: "4px"
				}
			}, collapsed ? "展开" : "收起"));
			const moreBtn = !collapsed && hiddenCount > 0 ? h("div", { style: {
				textAlign: "center",
				padding: "6px 0 10px"
			} }, h("button", {
				onClick: function() {
					setWindowSize(windowSize + WINDOW_SIZE);
				},
				style: {
					fontSize: "11px",
					border: "1px solid #d0d7de",
					background: "#fff",
					borderRadius: "4px",
					padding: "3px 10px",
					cursor: "pointer",
					color: "#1f3b63"
				}
			}, "↑ 加载更早 " + Math.min(hiddenCount, WINDOW_SIZE) + " 条（还有 " + hiddenCount + " 条）")) : null;
			let listChildren;
			if (collapsed) listChildren = null;
			else if (!data.ok) listChildren = h("div", { style: {
				padding: "12px",
				color: "#c05050",
				fontSize: "12px"
			} }, "读不到 thread.md（" + (data.reason || "未知") + "）", h("br"), h("span", { style: { color: "#888" } }, data.file || ""));
			else if (!shown.length) listChildren = h("div", { style: {
				padding: "12px",
				color: "#888",
				fontSize: "12px"
			} }, "暂无消息");
			else listChildren = shown.map(function(m, idx) {
				const c = colorOf(m.sig, sigs);
				const isNew = (m.n || 0) > seenUpTo;
				return h("div", {
					key: String(m.n) + ":" + idx,
					id: "agent-chat-msg-" + m.n,
					style: {
						borderLeft: "3px solid " + c,
						background: isNew ? "#fffdf3" : m.status === "done" ? "#fbfbfb" : "#fff",
						opacity: m.status === "done" ? .82 : 1,
						borderRadius: "4px",
						margin: "6px 0",
						padding: "6px 8px",
						boxShadow: "0 1px 2px rgba(0,0,0,.05)"
					}
				}, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "6px",
					fontSize: "11px",
					color: "#666",
					marginBottom: "4px",
					flexWrap: "wrap"
				} }, h("span", { style: {
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: "18px",
					height: "18px",
					borderRadius: "50%",
					background: c,
					color: "#fff",
					fontSize: "10px",
					fontWeight: 700
				} }, String(m.sig || "?").slice(0, 2)), h("span", { style: {
					fontWeight: 700,
					color: "#333"
				} }, "#" + m.n + " " + m.sig), m.status && STATUS_META[m.status] ? h("span", { style: {
					background: STATUS_META[m.status].color,
					color: "#fff",
					borderRadius: "8px",
					padding: "0 6px",
					fontSize: "10px",
					lineHeight: "15px"
				} }, STATUS_META[m.status].label) : null, m.phase && PHASE_META[m.phase] ? h("span", {
					title: "阶段：" + m.phase,
					style: {
						border: "1px solid " + PHASE_META[m.phase].color,
						color: PHASE_META[m.phase].color,
						borderRadius: "8px",
						padding: "0 5px",
						fontSize: "10px",
						lineHeight: "14px"
					}
				}, PHASE_META[m.phase].label) : null, m.priority === "critical" ? h("span", {
					title: "紧急",
					style: {
						background: "#c05050",
						color: "#fff",
						borderRadius: "8px",
						padding: "0 5px",
						fontSize: "10px",
						lineHeight: "15px"
					}
				}, "紧急") : null, m.ack && (m.status === "open" || m.status === "claimed") ? h("span", {
					title: "需要对方回执" + (ackOverdueSet[m.n] ? "（已超时）" : ""),
					style: {
						background: ackOverdueSet[m.n] ? "#c05050" : "#fff0f0",
						color: ackOverdueSet[m.n] ? "#fff" : "#c05050",
						border: "1px solid #c05050",
						borderRadius: "8px",
						padding: "0 5px",
						fontSize: "10px",
						lineHeight: "14px"
					}
				}, ackOverdueSet[m.n] ? "⚠ 超时未应答" : "需回执") : null, m.assign ? h("span", { style: { color: "#8e5bd0" } }, "→ " + m.assign) : null, m.scope ? h("span", {
					title: m.scope,
					style: {
						color: "#0aa3a3",
						maxWidth: "180px",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					}
				}, "📁 " + m.scope) : null, h("span", { title: m.time }, relTime(m.time, now)), m.replyTo != null ? h("a", {
					onClick: function() {
						jumpTo(Number(m.replyTo));
					},
					style: {
						color: c,
						textDecoration: "underline",
						cursor: "pointer"
					}
				}, "↩ #" + m.replyTo) : null, m.model ? h("span", { style: { color: "#aaa" } }, "(" + String(m.model).slice(0, 28) + ")") : null), h("div", {
					style: {
						fontSize: "12.5px",
						lineHeight: 1.65,
						color: "#222"
					},
					dangerouslySetInnerHTML: { __html: md(m.text || "") }
				}));
			});
			const list = h("div", {
				ref: listRef,
				onScroll,
				style: {
					flex: 1,
					minHeight: 0,
					overflow: "auto",
					padding: "8px 10px",
					display: collapsed ? "none" : "block"
				}
			}, moreBtn, listChildren);
			return h("div", { style: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				fontFamily: "system-ui,-apple-system,\"Segoe UI\",sans-serif",
				background: "#fafbfc"
			} }, header, list);
		}
		/**
		* 把我们的 tab 打开（或聚焦）。
		*
		* ⚠️ 关键教训（v0.4.2）：装了 `dsh-better-sidebar` 之后，右侧栏的「+」菜单
		* 列的是**它自己的** tab 注册表（`ctx.betterSidebar.registerTab`），而不是
		* DSH 原生的 `sidebarRightTabs`。所以只注册原生通道的插件会从菜单里消失。
		*
		* 因此这里按「用户实际看到的那份列表」优先：
		*   1. betterSidebar.openTab({ type })      ← 装了 better-sidebar 时的正道
		*   2. sidebarRight.openTab({ kind, ... })  ← 原生 surface
		*   3. sidebarRightTabs.openTab({ id })     ← 更老的原生 API
		* 全失败就把实际可用的方法名打到控制台。
		*/
		function openOurTab(svc) {
			const bs = svc.betterSidebar;
			if (bs && typeof bs.openTab === "function") {
				try {
					bs.openTab({
						type: TAB_ID,
						title: TAB_TITLE
					});
					return true;
				} catch {}
				try {
					bs.openTab({ type: TAB_ID });
					return true;
				} catch {}
			}
			const sr = svc.sidebarRight;
			if (sr && typeof sr.openTab === "function") try {
				sr.openTab({
					...svc.sessionId ? { sessionId: svc.sessionId } : {},
					kind: TAB_KIND,
					params: {},
					revealIfOpened: true
				});
				return true;
			} catch {}
			const st = svc.sidebarRightTabs;
			if (st && typeof st.openTab === "function") try {
				st.openTab({ id: TAB_ID });
				return true;
			} catch {}
			try {
				console.warn("[dsh-agent-chat] 无法自动打开「代理对话」tab。可用方法：", "\n  betterSidebar:", bs ? Object.keys(bs) : "(未注入)", "\n  sidebarRight:", sr ? Object.keys(sr) : "(未注入)", "\n  sidebarRightTabs:", st ? Object.keys(st) : "(未注入)");
			} catch {}
			return false;
		}
		/** 会话头部的小按钮：用户关掉 tab 后，还能一键叫回来 */
		function makeHeaderEntry(ctx, getBs) {
			return function HeaderEntry(props) {
				const [state, setState] = react.useState("idle");
				return h("button", {
					type: "button",
					title: "打开 / 聚焦「代理对话」面板",
					"data-agent-chat-entry": "true",
					onClick: function(e) {
						try {
							e && e.stopPropagation && e.stopPropagation();
						} catch {}
						const ok = openOurTab({
							betterSidebar: getBs(),
							sidebarRight: ctx.sidebarRight,
							sidebarRightTabs: ctx.sidebarRightTabs,
							sessionId: props && props.sessionId
						});
						setState(ok ? "ok" : "fail");
						setTimeout(function() {
							setState("idle");
						}, ok ? 600 : 2e3);
					},
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "4px",
						fontSize: "12px",
						padding: "2px 8px",
						borderRadius: "6px",
						border: "1px solid " + (state === "fail" ? "#c05050" : state === "ok" ? "#22a06b" : "#d0d7de"),
						background: state === "fail" ? "#fff5f5" : state === "ok" ? "#f2fbf6" : "#fff",
						color: state === "fail" ? "#c05050" : "#1f3b63",
						cursor: "pointer",
						lineHeight: "18px",
						whiteSpace: "nowrap"
					}
				}, h("span", { "aria-hidden": true }, "💬"), h("span", null, state === "fail" ? "打不开" : "代理对话"));
			};
		}
		/**
		* 通过 ctx.inject 拿到的 betterSidebar 服务（可能不存在）。
		* ⚠️ 不能直接读 ctx.betterSidebar —— cordis 会抛
		* "cannot get property \"betterSidebar\" without inject"。
		*/
		let betterSidebarService = null;
		function apply(ctx) {
			ctx.effect(function() {
				return ctx.sidebarRightTabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					title: function() {
						return TAB_TITLE;
					},
					keepMounted: true
				});
			}, "dsh-agent-chat: tab type");
			ctx.effect(function() {
				return ctx.slots.inject("sidebar.right.pane.tab", function() {
					return ctx.slots.register({
						name: "sidebar.right.pane.tab",
						key: TAB_ID
					}, AgentChatBody);
				});
			}, "dsh-agent-chat: tab body");
			try {
				ctx.inject(["betterSidebar"], function(scoped) {
					try {
						const bs = scoped.betterSidebar;
						if (!bs || typeof bs.registerTab !== "function") return;
						betterSidebarService = bs;
						scoped.effect(function() {
							return bs.registerTab({
								id: TAB_ID,
								title: TAB_TITLE,
								description: "多代理对话流（只读渲染 thread.md）",
								order: 120,
								single: true,
								component: AgentChatBody
							});
						}, "dsh-agent-chat: better-sidebar tab");
					} catch (e) {
						try {
							console.warn("[dsh-agent-chat] betterSidebar 注册失败:", e);
						} catch {}
					}
				});
			} catch (e) {
				try {
					console.warn("[dsh-agent-chat] 无法注入 betterSidebar（可能没装 dsh-better-sidebar）:", e);
				} catch {}
			}
			ctx.effect(function() {
				return ctx.slots.inject("conversation.session.header.actions", function() {
					return ctx.slots.register({
						name: "conversation.session.header.actions",
						id: "dsh-agent-chat-entry",
						order: 60
					}, makeHeaderEntry(ctx, function() {
						return betterSidebarService;
					}));
				});
			}, "dsh-agent-chat: header entry");
		}
		//#endregion
		exports.TAB_ID = TAB_ID;
		exports.TAB_KIND = TAB_KIND;
		exports.TAB_TITLE = TAB_TITLE;
		exports.apply = apply;
		exports.inject = inject;
		exports.openOurTab = openOurTab;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map