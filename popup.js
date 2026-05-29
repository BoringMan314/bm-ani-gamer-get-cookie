'use strict';

document.addEventListener('DOMContentLoaded', () => {
	const popupTitle = document.getElementById('popupTitle');
	const copyBtn = document.getElementById('copyBtn');
	const underBtnHint = document.getElementById('underBtnHint');
	const toast = document.getElementById('toast');

	if (!popupTitle || !copyBtn || !underBtnHint || !toast) {
		return;
	}

	function t(key) {
		return chrome.i18n.getMessage(key) || key;
	}

	const ANI_ORIGIN = 'https://ani.gamer.com.tw/';

	function includeForAniGamerPlus(name) {
		if (name === 'nologinuser' || name === 'ckM' || name === 'age_limit_content' || name === 'avtrv') {
			return true;
		}
		if (
			name.startsWith('BAHA') ||
			name.startsWith('MB_') ||
			name.startsWith('ANIME_')
		) {
			return true;
		}
		return false;
	}

	function showToast(message, kind) {
		toast.hidden = false;
		toast.textContent = message;
		toast.dataset.kind = kind;
	}

	function clearToast() {
		toast.hidden = true;
		toast.textContent = '';
		delete toast.dataset.kind;
	}

	function pageUrlForTab(tab) {
		if (!tab?.url) return ANI_ORIGIN;
		try {
			const u = new URL(tab.url);
			if (u.hostname !== 'ani.gamer.com.tw') return ANI_ORIGIN;
			u.hash = '';
			return u.href;
		} catch {
			return ANI_ORIGIN;
		}
	}

	function cookiePickScore(cookie, host, urlPath) {
		const raw = cookie.domain || '';
		const dom = raw.replace(/^\./, '');
		const hostOnly = raw !== '' && !raw.startsWith('.') && raw === host;
		let s = (cookie.path || '/').length;
		if (hostOnly) s += 2000;
		else if (host === dom) s += 1000;
		else if (dom && host.endsWith('.' + dom)) s += 200;
		if (urlPath.startsWith(cookie.path || '/')) s += 50;
		return s;
	}

	function mergeDebuggerCookies(cookies, pageUrl, merged) {
		const u = new URL(pageUrl);
		const host = u.hostname;
		const urlPath = u.pathname || '/';
		const best = new Map();
		for (const c of cookies) {
			if (!includeForAniGamerPlus(c.name)) continue;
			const prev = best.get(c.name);
			if (!prev || cookiePickScore(c, host, urlPath) > cookiePickScore(prev, host, urlPath)) {
				best.set(c.name, c);
			}
		}
		for (const [name, c] of best) merged.set(name, c.value);
	}

	async function collectForStore(storeId, pageUrl) {
		const merged = new Map();
		const base = { url: pageUrl };
		if (storeId != null) base.storeId = storeId;

		let list = [];
		try {
			list = await chrome.cookies.getAll(base);
		} catch {
			return merged;
		}
		if (!Array.isArray(list)) return merged;

		for (const c of list) {
			if (!includeForAniGamerPlus(c.name) || merged.has(c.name)) continue;
			try {
				const one = await chrome.cookies.get({ ...base, name: c.name });
				if (one && includeForAniGamerPlus(one.name)) merged.set(one.name, one.value);
			} catch {}
		}
		return merged;
	}

	async function collectViaDebugger(tab, pageUrl) {
		const target = { tabId: tab.id };
		let attached = false;
		try {
			await chrome.debugger.attach(target, '1.3');
			attached = true;
			const urls = [pageUrl];
			if (pageUrl !== ANI_ORIGIN) urls.push(ANI_ORIGIN);
			const res = await chrome.debugger.sendCommand(target, 'Network.getCookies', { urls });
			const merged = new Map();
			mergeDebuggerCookies(res?.cookies || [], pageUrl, merged);
			return merged.size > 0 ? merged : null;
		} catch {
			return null;
		} finally {
			if (attached) {
				try {
					await chrome.debugger.detach(target);
				} catch {}
			}
		}
	}

	async function activeAniTab() {
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.id || !tab.url) return null;
			if (new URL(tab.url).hostname !== 'ani.gamer.com.tw') return null;
			return tab;
		} catch {
			return null;
		}
	}

	async function storeIdsForTab(tab) {
		try {
			const stores = await chrome.cookies.getAllCookieStores();
			return stores
				.filter((s) => Array.isArray(s.tabIds) && s.tabIds.includes(tab.id))
				.map((s) => s.id);
		} catch {
			return [];
		}
	}

	async function collectBahamutCookieEntries() {
		const tab = await activeAniTab();
		if (!tab) return [];

		const pageUrl = pageUrlForTab(tab);
		const viaDebugger = await collectViaDebugger(tab, pageUrl);
		if (viaDebugger?.size) return [...viaDebugger.entries()];

		const storeIds = await storeIdsForTab(tab);
		const tryIds = storeIds.length > 0 ? storeIds : [undefined];
		for (const storeId of tryIds) {
			const merged = await collectForStore(storeId, pageUrl);
			if (merged.size > 0) return [...merged.entries()];
		}
		return [];
	}

	async function copyCookie() {
		clearToast();
		copyBtn.disabled = true;
		try {
			const entries = await collectBahamutCookieEntries();
			if (!entries.length) {
				showToast(t('noCookies'), 'err');
				return;
			}
			const line = entries
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, value]) => `${name}=${value}`)
				.join('; ');
			await navigator.clipboard.writeText(line);
			showToast(t('toastCopied'), 'ok');
		} catch {
			showToast(t('toastCopyFailed'), 'err');
		} finally {
			copyBtn.disabled = false;
		}
	}

	popupTitle.textContent = t('popupTitle');
	copyBtn.textContent = t('copyCookieButton');
	underBtnHint.textContent = t('underButtonHint');
	copyBtn.addEventListener('click', () => {
		copyCookie().catch(() => {});
	});
});
