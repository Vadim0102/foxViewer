'use strict';
/* Ядро foxViewer: общие утилиты, реестры площадок и фич, «протокол» GIF-сообщений "/tenor <ID>" */
(() => {
  if (globalThis.FOXV) return;
  const api = globalThis.browser ?? globalThis.chrome;

  const MEDIA_RE = /^https:\/\/media\d*\.tenor\.com\//;
  const CMD_RE = /^\/(tenor)\s+(\S+)$/i;

  const NS = {
    api,
    adapters: [],   // площадки (src/platforms/*)
    features: [],   // возможности (src/features/*): { name, init?, onTick?, onMessages? }
    started: false,
    safeMedia: (u) => (typeof u === 'string' && MEDIA_RE.test(u) ? u : null),
  };

  /** Создание DOM без innerHTML (YouTube требует Trusted Types). */
  NS.el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    n.append(...kids.flat().filter((x) => x != null && x !== false));
    return n;
  };

  /** Запрос к background-скрипту. */
  NS.call = async (type, payload = {}) => {
    const res = await api.runtime.sendMessage({ ns: 'foxv', type, ...payload });
    if (!res || !res.ok) throw new Error((res && res.error) || 'нет ответа от расширения');
    return res.data;
  };

  /** resolve с кэшем и защитой от повторных запросов. Ошибки помним 10 секунд. */
  const cache = new Map();
  NS.resolve = (provider, id) => {
    const key = provider + ':' + id;
    const hit = cache.get(key);
    if (hit && !(hit.failedAt && Date.now() - hit.failedAt > 10000)) return hit.p;
    const entry = { p: NS.call('resolve', { provider, id }), failedAt: 0 };
    entry.p.then((d) => { entry.data = d; }, () => { entry.failedAt = Date.now(); });
    cache.set(key, entry);
    return entry.p;
  };

  /** Уже полученные данные (синхронно) или null — чтобы нарисовать гифку до первой отрисовки кадра. */
  NS.peek = (provider, id) => { const h = cache.get(provider + ':' + id); return (h && h.data) || null; };

  /** "/tenor 27161697" или "/tenor https://tenor.com/view/meow-cat-gif-27161697" -> {provider,id} */
  NS.parseCommand = (text) => {
    const m = CMD_RE.exec(String(text || '').replace(/[\u200b\u200c\u200d]/g, '').trim());
    if (!m) return null;
    const provider = m[1].toLowerCase();
    const arg = m[2];
    if (/^\d{4,22}$/.test(arg)) return { provider, id: arg };
    const u = /^https?:\/\/(?:www\.)?tenor\.com\/\S*?[-/](\d{4,22})\/?(?:[?#]\S*)?$/i.exec(arg);
    return u ? { provider, id: u[1] } : null;
  };

  NS.formatCommand = (provider, id) => `/${provider} ${id}`;

  globalThis.FOXV = NS;
})();
