'use strict';
/* Окно с поиском GIF/стикеров. Живёт в Shadow DOM, чтобы стили YouTube не мешали. */
(() => {
  const NS = globalThis.FOXV;
  const { el } = NS;

  const CSS = `
    .panel { box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
      background: var(--g-bg); color: var(--g-text);
      border: 1px solid var(--g-border); border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.5); font: 13px/1.4 Roboto, Arial, sans-serif; }
    .top { display: flex; gap: 6px; padding: 8px 8px 4px; }
    input { flex: 1; min-width: 0; box-sizing: border-box; padding: 7px 12px; border-radius: 16px;
      border: 1px solid rgba(128,128,128,.5); background: transparent; color: inherit; font: inherit; outline: none; }
    input:focus { border-color: var(--g-accent); }
    .close, .tab { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; border-radius: 14px; }
    .close { width: 30px; font-size: 16px; }
    .close:hover, .tab:hover { background: rgba(128,128,128,.25); }
    .tabs { display: flex; gap: 4px; padding: 2px 8px 6px; }
    .tab { padding: 4px 12px; }
    .tab[aria-selected="true"] { background: rgba(128,128,128,.4); font-weight: 500; }
    .status { padding: 6px 12px; text-align: center; opacity: .75; }
    .status[hidden] { display: none; }
    .grid { flex: 1; overflow-y: auto; padding: 0 8px 8px; display: flex; gap: 6px; align-items: flex-start; min-height: 0; }
    .col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .grid.busy { opacity: .5; pointer-events: none; }
    .tile { position: relative; display: block; width: 100%; height: 0; padding: 0 0 100% 0; margin: 0; flex: none; border: 0;
      border-radius: 8px; overflow: hidden; cursor: pointer; appearance: none; -webkit-appearance: none;
      background: rgba(128,128,128,.2); }
    .tile:hover { outline: 2px solid var(--g-accent); }
    .tile img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .grid.stickers .tile img { object-fit: contain; }
  `;

  // Цвета окна по умолчанию (как на YouTube). Адаптер может переопределить любые через theme().
  const DEFAULT_THEME = {
    bg: 'var(--yt-spec-menu-background, #282828)',
    text: 'var(--yt-spec-text-primary, #fff)',
    border: 'var(--yt-spec-10-percent-layer, rgba(128,128,128,.4))',
    accent: '#3ea6ff',
  };

  const TABS = { recent: 'Недавние', gifs: 'GIF', stickers: 'Стикеры' };

  async function getRecent() {
    try {
      const o = await NS.api.storage.local.get('recent');
      return Array.isArray(o.recent) ? o.recent : [];
    } catch { return []; }
  }
  async function pushRecent(item) {
    try {
      const list = (await getRecent()).filter((x) => x.id !== item.id);
      list.unshift({ id: item.id, thumb: item.thumb || null, alt: item.alt || '' });
      await NS.api.storage.local.set({ recent: list.slice(0, 30) });
    } catch { /* не критично */ }
  }

  NS.createPicker = function createPicker({ getAnchorRect, isTrigger, onPick, getTheme, alignToAnchor }) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;left:8px;right:8px;bottom:60px;z-index:2147483647;display:none;';
    const root = host.attachShadow({ mode: 'closed' });

    let tab = 'gifs', query = '', seq = 0, busy = false, open = false, debounceT = 0, inited = false;

    const search = el('input', { type: 'search', placeholder: 'Поиск GIF и стикеров (Tenor)…', spellcheck: false });
    const closeBtn = el('button', { type: 'button', class: 'close', title: 'Закрыть', onClick: () => close() }, '✕');
    const tabEls = {};
    const tabBar = el('div', { class: 'tabs', role: 'tablist' },
      ...Object.entries(TABS).map(([k, label]) => {
        const b = el('button', { type: 'button', class: 'tab', role: 'tab', onClick: () => setTab(k) }, label);
        tabEls[k] = b;
        return b;
      }));
    const status = el('div', { class: 'status' });
    const grid = el('div', { class: 'grid' });
    const panel = el('div', { class: 'panel' }, el('div', { class: 'top' }, search, closeBtn), tabBar, status, grid);
    root.append(el('style', {}, CSS), panel);

    /* Ленивое получение превью, если в выдаче поиска его не нашли */
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        io.unobserve(img);
        NS.resolve('tenor', img.dataset.id)
          .then((r) => { const u = NS.safeMedia(r.gif); if (u) img.src = u; })
          .catch(() => { img.alt = '✕'; });
      }
    }, { root: grid, rootMargin: '150px' });

    function setStatus(text) {
      status.textContent = text || '';
      status.hidden = !text;
    }

    function updateTabs() {
      for (const [k, b] of Object.entries(tabEls)) b.setAttribute('aria-selected', String(k === tab));
      grid.classList.toggle('stickers', tab === 'stickers');
    }

    function render(items) {
      io.disconnect();
      grid.replaceChildren();
      if (!items.length) { setStatus(tab === 'recent' ? 'Пока пусто — отправьте что-нибудь' : 'Ничего не найдено'); return; }
      setStatus('');
      const clamp = (r) => Math.min(2.5, Math.max(0.4, r));
      const cols = [el('div', { class: 'col' }), el('div', { class: 'col' }), el('div', { class: 'col' })];
      const heights = [0, 0, 0];
      for (const it of items) {
        const img = el('img', { alt: it.alt || '', loading: 'lazy', draggable: false });
        img.dataset.id = it.id;
        const ratio = clamp(it.w > 0 && it.h > 0 ? it.h / it.w : 1);
        const tile = el('button', { type: 'button', class: 'tile', title: it.alt || '', onClick: () => pick(it) }, img);
        tile.style.paddingBottom = ratio * 100 + '%';
        img.addEventListener('load', () => {
          if (img.naturalWidth > 0) tile.style.paddingBottom = clamp(img.naturalHeight / img.naturalWidth) * 100 + '%';
        });
        const thumb = NS.safeMedia(it.thumb);
        if (thumb) img.src = thumb; else io.observe(img);
        const k = heights.indexOf(Math.min(...heights));   // кладём в самую короткую колонку
        heights[k] += ratio;
        cols[k].append(tile);
      }
      grid.append(...cols);
      grid.scrollTop = 0;
    }

    async function load() {
      const token = ++seq;
      setStatus('Загрузка…');
      try {
        const items = tab === 'recent' ? await getRecent() : await NS.call('search', { q: query, format: tab });
        if (token === seq) render(items);
      } catch (e) {
        if (token === seq) { grid.replaceChildren(); setStatus('Ошибка: ' + e.message); }
      }
    }

    function setTab(k) {
      tab = k;
      if (k === 'recent') { query = ''; search.value = ''; }
      updateTabs();
      load();
    }

    async function pick(item) {
      if (busy) return;
      busy = true;
      grid.classList.add('busy');
      // заранее получаем ссылки и прогреваем картинку: сообщение отрисуется сразу, без подгрузки
      NS.resolve('tenor', item.id).then((r) => { const u = NS.safeMedia(r.gif); if (u) new Image().src = u; }).catch(() => {});
      try {
        const res = await onPick(item);
        if (res && res.ok) { await pushRecent(item); close(); }
        else setStatus((res && res.error) || 'Не удалось отправить');
      } catch (e) {
        setStatus('Ошибка: ' + e.message);
      } finally {
        busy = false;
        grid.classList.remove('busy');
      }
    }

    function applyTheme() {
      let t = null;
      try { t = getTheme && getTheme(); } catch { /* тему не получили — берём стандартную */ }
      const theme = { ...DEFAULT_THEME, ...(t || {}) };
      for (const [k, v] of Object.entries(theme)) host.style.setProperty('--g-' + k, v);
    }

    function reposition() {
      const r = getAnchorRect();
      const bottom = r ? Math.max(0, window.innerHeight - r.top + 6) : 60;
      host.style.bottom = bottom + 'px';
      // Чат на сайте — обычно узкая боковая панель: выравниваем окно по ширине панели ввода, а не по всему окну.
      let left = 8, right = 8;
      if (r && alignToAnchor) {
        const vw = document.documentElement.clientWidth;
        left = Math.max(8, r.left);
        right = Math.max(8, vw - r.right);
        if (vw - left - right < 260) left = Math.max(8, vw - right - 260);
      }
      host.style.left = left + 'px';
      host.style.right = right + 'px';
      const avail = window.innerHeight - bottom - 8;
      panel.style.height = Math.max(160, Math.min(340, avail)) + 'px';
    }

    async function openPicker() {
      if (!host.isConnected) document.documentElement.append(host);
      open = true;
      applyTheme();
      host.style.display = 'block';
      reposition();
      search.focus();
      if (!inited) {
        inited = true;
        tab = (await getRecent()).length ? 'recent' : 'gifs';
        updateTabs();
        load();
      }
    }
    function close() { open = false; host.style.display = 'none'; }

    search.addEventListener('input', () => {
      query = search.value.trim();
      if (tab === 'recent' && query) { tab = 'gifs'; updateTabs(); }
      clearTimeout(debounceT);
      debounceT = setTimeout(load, 400);
    });
    for (const type of ['keydown', 'keyup', 'keypress']) {
      search.addEventListener(type, (e) => {
        e.stopPropagation(); // чтобы горячие клавиши страницы не перехватывали ввод
        if (type === 'keydown' && e.key === 'Enter') { clearTimeout(debounceT); load(); }
        if (type === 'keydown' && e.key === 'Escape') close();
      });
    }
    document.addEventListener('pointerdown', (e) => {
      if (!open) return;
      const path = e.composedPath();
      if (path.includes(host) || path.some((n) => isTrigger(n))) return;
      close();
    }, true);
    window.addEventListener('resize', () => { if (open) reposition(); });

    updateTabs();
    return { toggle: () => (open ? close() : openPicker()), open: openPicker, close, isOpen: () => open };
  };
})();
