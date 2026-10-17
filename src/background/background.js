'use strict';
/*
 * Фоновый скрипт: ходит на tenor.com (у content-скриптов нет прав на кросс-доменные запросы).
 *   resolve(id)          -> ссылки на медиа по ID гифки (парсим og:/twitter: meta со страницы /view/<id>)
 *   search(q, format)    -> список {id, thumb, alt} (парсим HTML страницы /search/<q>-gifs)
 *
 * Официальный Tenor API закрыт (30.06.2026), поэтому всё делается через публичный сайт, без ключей.
 */
const api = globalThis.browser ?? globalThis.chrome;

const TENOR = 'https://tenor.com';
const ID_RE = /^\d{4,22}$/;
const MEDIA_RE = /^https:\/\/media\d*\.tenor\.com\/[^\s"'<>]+$/;
const IMG_IN_HTML_RE = /(?:https:)?\/\/media\d*\.tenor\.com\/[^\s"'<>),]+?\.(?:gif|webp|png|jpe?g)(?:\?[^\s"'<>),]*)?/i;

const safeMedia = (u) => (typeof u === 'string' && MEDIA_RE.test(u) ? u : null);

/* ---------- ограничение параллелизма ---------- */
let active = 0;
const queue = [];
function limited(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < 4 && queue.length) {
    const t = queue.shift();
    active++;
    t.fn().then(t.resolve, t.reject).finally(() => { active--; pump(); });
  }
}

async function fetchText(url) {
  const r = await fetch(url, { credentials: 'omit', redirect: 'follow', headers: { Accept: 'text/html' } });
  if (!r.ok) throw new Error('Tenor: HTTP ' + r.status);
  return r.text();
}

/* ---------- парсинг ---------- */
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseMeta(html) {
  const out = {};
  const metaRe = /<meta\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(m[1]))) attrs[a[1].toLowerCase()] = a[2] ?? a[3];
    const key = attrs.property || attrs.name;
    if (key && attrs.content !== undefined && !(key in out)) out[key] = decodeEntities(attrs.content);
  }
  return out;
}

const resolveCache = new Map();
const RESOLVE_TTL = 6 * 3600 * 1000;

async function resolve(id) {
  const hit = resolveCache.get(id);
  if (hit && Date.now() - hit.t < RESOLVE_TTL) return hit.data;

  const html = await limited(() => fetchText(`${TENOR}/view/${id}`));
  const meta = parseMeta(html);

  let webm = null, mp4 = null;
  for (const key of ['og:video:secure_url', 'og:video', 'twitter:player:stream']) {
    const u = safeMedia(meta[key]);
    if (!u) continue;
    if (!webm && /\.webm(\?|$)/i.test(u)) webm = u;
    if (!mp4 && /\.mp4(\?|$)/i.test(u)) mp4 = u;
  }
  const gifHd = safeMedia(meta['og:image']);
  const gif = safeMedia(meta['twitter:image']) || gifHd;
  if (!gif && !webm && !mp4) throw new Error('Не нашёл медиа для ID ' + id);

  const data = {
    id,
    gif, gifHd, webm, mp4,
    w: parseInt(meta['og:image:width'], 10) || 0,
    h: parseInt(meta['og:image:height'], 10) || 0,
    alt: (meta['og:title'] || '').split(/\s+(?:GIF|Sticker)/i)[0].slice(0, 120),
  };
  if (resolveCache.size > 500) resolveCache.delete(resolveCache.keys().next().value);
  resolveCache.set(id, { t: Date.now(), data });
  return data;
}

/* Парсер выдачи поиска. Если Tenor поменяет вёрстку — править нужно только эту функцию. */
function parseSearch(html) {
  const items = [];
  const seen = new Set();
  const re = /<a\b[^>]*\bhref="([^"]*\/view\/[^"#?]*?[-/](\d{4,22}))(?:[?#][^"]*)?"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && items.length < 60) {
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const inner = m[3];
    let thumb = null;
    const t = IMG_IN_HTML_RE.exec(inner);
    if (t) thumb = safeMedia(decodeEntities(t[0].startsWith('//') ? 'https:' + t[0] : t[0]));
    const alt = /\balt="([^"]*)"/i.exec(inner);
    const tag = /<img\b[^>]*>/i.exec(inner);
    const w = tag ? parseInt((/\bwidth="(\d+)"/i.exec(tag[0]) || [])[1], 10) || 0 : 0;
    const h = tag ? parseInt((/\bheight="(\d+)"/i.exec(tag[0]) || [])[1], 10) || 0 : 0;
    items.push({ id, thumb, w, h, alt: alt ? decodeEntities(alt[1]).slice(0, 120) : '' });
  }
  return items;
}

const searchCache = new Map();
const SEARCH_TTL = 10 * 60 * 1000;

async function search(q, format) {
  q = String(q || '').trim().slice(0, 80) || 'trending';
  format = format === 'stickers' ? 'stickers' : 'gifs';
  const key = format + '|' + q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.t < SEARCH_TTL) return hit.items;

  const slug = q.toLowerCase().replace(/[\s/\\?#%]+/g, '-').replace(/^-+|-+$/g, '');
  const url = `${TENOR}/search/${encodeURIComponent(slug)}-gifs` + (format === 'stickers' ? '?format=stickers' : '');
  const html = await limited(() => fetchText(url));
  const items = parseSearch(html);
  if (searchCache.size > 60) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(key, { t: Date.now(), items });
  return items;
}

/* ---------- сообщения от content-скриптов ---------- */
async function handle(msg) {
  switch (msg.type) {
    case 'resolve':
      if (msg.provider !== 'tenor' || !ID_RE.test(String(msg.id))) throw new Error('bad id');
      return resolve(String(msg.id));
    case 'search':
      return search(msg.q, msg.format);
    default:
      throw new Error('unknown message');
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.ns !== 'foxv') return false;
  handle(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // ответ асинхронный
});
