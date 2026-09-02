//#region src/shared/result.ts
function e(e, t) {
	throw Error(`${t}: unhandled variant ${JSON.stringify(e)}`);
}
//#endregion
//#region src/shared/messaging/protocol.ts
var t = (e) => {
	if (typeof e != "object" || !e) return !1;
	let t = e;
	if (t.from !== "sidepanel" && t.from !== "content") return !1;
	let n = t.message;
	return typeof n == "object" && !!n && typeof n.type == "string";
}, n = [
	"chrome:",
	"chrome-extension:",
	"chrome-untrusted:",
	"devtools:",
	"edge:",
	"about:",
	"data:",
	"blob:",
	"view-source:",
	"javascript:"
], r = ["chrome.google.com", "chromewebstore.google.com"];
function i(e) {
	if (!e) return {
		auditable: !1,
		reason: "invalid"
	};
	let t;
	try {
		t = new URL(e);
	} catch {
		return {
			auditable: !1,
			reason: "invalid"
		};
	}
	return t.protocol === "file:" ? {
		auditable: !1,
		reason: "file"
	} : n.includes(t.protocol) ? {
		auditable: !1,
		reason: "scheme"
	} : t.protocol === "https:" && r.includes(t.hostname) ? {
		auditable: !1,
		reason: "host"
	} : { auditable: !0 };
}
//#endregion
//#region src/background/service-worker.ts
var a = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Set(), s, c = "content.js";
chrome.runtime.onInstalled.addListener(() => {
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !1 }).catch(() => {});
});
async function l() {
	let [e] = await chrome.tabs.query({
		active: !0,
		lastFocusedWindow: !0
	});
	return e;
}
async function u() {
	let e = await l();
	if (e?.id !== void 0 && a.has(e.id)) return e.id;
	if (s !== void 0 && a.has(s)) return s;
	if (a.size === 1) return [...a.keys()][0];
}
function d(e, t) {
	let n = t === void 0 ? {
		from: "content",
		message: e
	} : {
		from: "content",
		tabId: t,
		message: e
	};
	for (let e of o) try {
		e.postMessage(n);
	} catch {
		o.delete(e);
	}
}
function f(e, t) {
	let n = a.get(e);
	if (!n) return !1;
	try {
		return n.postMessage({
			from: "sidepanel",
			tabId: e,
			message: t
		}), !0;
	} catch {
		return a.delete(e), !1;
	}
}
function p(e, t) {
	d({
		type: "ERROR",
		payload: t === void 0 ? { code: e } : {
			code: e,
			detail: t
		}
	});
}
async function m(e, t) {
	if (!i(t).auditable) return {
		ok: !1,
		code: "RESTRICTED_PAGE"
	};
	try {
		return await chrome.scripting.executeScript({
			target: {
				tabId: e,
				allFrames: !1
			},
			files: [c]
		}), s = e, { ok: !0 };
	} catch {
		return {
			ok: !1,
			code: "INJECTION_FAILED"
		};
	}
}
chrome.runtime.onMessage.addListener((e, t, n) => {
	let r = e;
	if (typeof r?.type != "string") return !1;
	switch (r.type) {
		case "ACTIVATE_PAGE": return (async () => {
			let e = await l();
			if (!e?.id) {
				n({
					ok: !1,
					error: { code: "NO_ACTIVE_TAB" }
				});
				return;
			}
			let t = await m(e.id, e.url);
			n(t.ok ? {
				ok: !0,
				value: void 0
			} : {
				ok: !1,
				error: { code: t.code }
			});
		})(), !0;
		case "GET_PAGE_STATUS": return (async () => {
			let e = await l();
			n({
				ok: !0,
				value: { activated: e?.id !== void 0 && a.has(e.id) }
			});
		})(), !0;
		case "DEACTIVATE": return (async () => {
			let e = await u();
			n(e !== void 0 && f(e, { type: "DEACTIVATE" }) ? {
				ok: !0,
				value: void 0
			} : {
				ok: !1,
				error: { code: "NOT_ACTIVATED" }
			});
		})(), !0;
		default: return !1;
	}
}), chrome.runtime.onConnect.addListener((e) => {
	if (e.name === "content") {
		let n = e.sender?.tab?.id;
		if (n === void 0) {
			e.disconnect();
			return;
		}
		a.set(n, e), s = n, e.onDisconnect.addListener(() => {
			a.delete(n), d({
				type: "PAGE_STATUS",
				payload: { activated: !1 }
			}, n);
		}), e.onMessage.addListener((e) => {
			t(e) && h(n, e.message);
		});
		return;
	}
	if (e.name === "sidepanel") {
		o.add(e), e.onDisconnect.addListener(() => o.delete(e)), e.onMessage.addListener((e) => {
			t(e) && g(e.message);
		}), (async () => {
			let t = await u(), n = t !== void 0;
			e.postMessage({
				from: "content",
				message: {
					type: "PAGE_STATUS",
					payload: { activated: n }
				}
			}), t !== void 0 && f(t, { type: "REQUEST_PAGE_INFO" });
		})();
		return;
	}
	e.disconnect();
});
function h(t, n) {
	switch (n.type) {
		case "PAGE_ACTIVATED":
		case "DEACTIVATED":
		case "ELEMENT_HOVERED":
		case "ELEMENT_SELECTED":
		case "SELECTION_STATE":
		case "SNAPSHOT_READY":
		case "PIN_CLICKED":
		case "ELEMENT_RESOLVED":
		case "TOOLBAR_ACTION":
		case "ERROR":
			d(n, t);
			return;
		case "ACTIVATE_PAGE":
		case "DEACTIVATE":
		case "GET_PAGE_STATUS":
		case "REQUEST_PAGE_INFO":
		case "PAGE_STATUS":
		case "START_SELECTION":
		case "CANCEL_SELECTION":
		case "REQUEST_SNAPSHOT":
		case "AUDIT_PROGRESS":
		case "RENDER_PINS":
		case "CLEAR_PINS":
		case "FOCUS_ELEMENT": return;
		default: e(n, "routeFromContent");
	}
}
async function g(t) {
	switch (t.type) {
		case "ACTIVATE_PAGE": {
			let e = await l();
			if (!e?.id) {
				p("NO_ACTIVE_TAB");
				return;
			}
			let t = await m(e.id, e.url);
			t.ok || p(t.code ?? "UNKNOWN");
			return;
		}
		case "DEACTIVATE":
		case "START_SELECTION":
		case "CANCEL_SELECTION":
		case "REQUEST_PAGE_INFO":
		case "REQUEST_SNAPSHOT":
		case "RENDER_PINS":
		case "CLEAR_PINS":
		case "FOCUS_ELEMENT": {
			let e = await u();
			(e === void 0 || !f(e, t)) && p("NOT_ACTIVATED");
			return;
		}
		case "PAGE_ACTIVATED":
		case "GET_PAGE_STATUS":
		case "PAGE_STATUS":
		case "DEACTIVATED":
		case "ELEMENT_HOVERED":
		case "ELEMENT_SELECTED":
		case "SELECTION_STATE":
		case "SNAPSHOT_READY":
		case "AUDIT_PROGRESS":
		case "PIN_CLICKED":
		case "ELEMENT_RESOLVED":
		case "TOOLBAR_ACTION":
		case "ERROR": return;
		default: e(t, "routeFromPanel");
	}
}
//#endregion
