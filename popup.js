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

	const SKIP_COOKIE_NAMES = new Set(['ckBH_lastBoard']);

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

	async function cookieGet(details) {
		try {
			const list = await chrome.cookies.getAll(details);
			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	}

	function absorbInto(fromList, overwrite, merged) {
		for (const c of fromList) {
			if (SKIP_COOKIE_NAMES.has(c.name)) continue;
			if (overwrite || !merged.has(c.name)) merged.set(c.name, c.value);
		}
	}

	function scoreMerged(merged) {
		if (!(merged instanceof Map) || merged.size === 0) return -1;
		let s = merged.size * 10;
		const names = new Set([...merged.keys()]);
		if (names.has('BAHARUNE')) s += 5000;
		if (names.has('BAHAID')) s += 2000;
		if (names.has('nologinuser')) s += 800;
		for (const p of names) if (p.startsWith('MB_')) s += 50;
		for (const p of names) if (p.startsWith('ANIME')) s += 10;
		for (const p of names) if (p.startsWith('ckBaha')) s += 5;
		for (const p of names) if (p === 'ckBahamutCsrfToken') s += 1;
		return s;
	}

	/** 僅動畫瘋情境：與 DevTools「自 ani.gamer.com.tw 請求 api.gamer.com.tw」同一 partitioned jar。 */
	async function collectOneStore(storeId) {
		const merged = new Map();
		const baseDetail = {};
		if (storeId) Object.assign(baseDetail, { storeId });
		const pk = { topLevelSite: 'https://ani.gamer.com.tw' };
		const aniScopedUrls = ['https://ani.gamer.com.tw/', 'https://api.gamer.com.tw/'];
		absorbInto(await cookieGet({ ...baseDetail, domain: 'gamer.com.tw', partitionKey: pk }), true, merged);
		for (const url of aniScopedUrls) {
			absorbInto(await cookieGet({ ...baseDetail, url, partitionKey: pk }), true, merged);
		}
		return merged;
	}

	async function preferredCookieStoreId() {
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.id || !tab.url) return null;
			let hostname;
			try {
				hostname = new URL(tab.url).hostname;
			} catch {
				return null;
			}
			if (hostname !== 'ani.gamer.com.tw') return null;
			const stores = await chrome.cookies.getAllCookieStores();
			const hit = stores.find((s) => Array.isArray(s.tabIds) && s.tabIds.includes(tab.id));
			return hit?.id ?? null;
		} catch {
			return null;
		}
	}

	async function collectBahamutCookieEntries() {
		const preferredId = await preferredCookieStoreId();
		if (preferredId != null) {
			const merged = await collectOneStore(preferredId);
			if (merged.size > 0) {
				return [...merged.entries()];
			}
		}

		const stores = await chrome.cookies.getAllCookieStores();
		let best = null;
		let bestScore = -1;

		for (const { id } of stores) {
			const merged = await collectOneStore(id);
			const sc = scoreMerged(merged);
			if (sc > bestScore) {
				bestScore = sc;
				best = merged;
			}
		}

		let merged = best;
		if (!merged || merged.size === 0) {
			merged = await collectOneStore(undefined);
		}
		if (!merged || merged.size === 0) {
			return [];
		}
		return [...merged.entries()];
	}

	async function buildCookieString() {
		const entries = await collectBahamutCookieEntries();
		if (!entries.length) {
			return { line: '', count: 0 };
		}
		const line = entries.map(([name, value]) => `${name}=${value}`).join('; ');
		return { line, count: entries.length };
	}

	async function copyCookie() {
		clearToast();
		copyBtn.disabled = true;
		try {
			const { line, count } = await buildCookieString();
			if (!count || !line) {
				showToast(t('noCookies'), 'err');
				return;
			}
			await navigator.clipboard.writeText(line);
			showToast(t('toastCopied'), 'ok');
		} catch (e) {
			showToast(t('toastCopyFailed'), 'err');
		} finally {
			copyBtn.disabled = false;
		}
	}

	function applyI18n() {
		popupTitle.textContent = t('popupTitle');
		copyBtn.textContent = t('copyCookieButton');
		underBtnHint.textContent = t('underButtonHint');
	}

	applyI18n();
	copyBtn.addEventListener('click', () => {
		copyCookie().catch(() => {});
	});
});
