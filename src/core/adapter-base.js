'use strict';
/*
 * Общая база для адаптеров чатов. Новая площадка = один небольшой файл с конфигом (см. platforms/_template.js),
 * вся «механика» (вставка кнопки, отправка текста, поиск прокрутки, наблюдение за сообщениями) живёт здесь.
 *
 * NS.defineAdapter(cfg) собирает адаптер по контракту из platforms/youtube.js и регистрирует его в NS.adapters.
 *
 * Поля cfg (везде, где «sel|fn», можно дать CSS-селектор строкой или функцию, возвращающую элемент):
 *   name         имя адаптера
 *   hosts        ['vkvideo.ru'] — совпадение по hostname (поддомены тоже); либо match: () => boolean
 *   path         (необязательно) RegExp для location.pathname
 *   message      CSS-селектор ЭЛЕМЕНТОВ С ТЕКСТОМ сообщения (в них рисуется гифка)
 *   input        sel|fn — поле ввода (contenteditable, textarea или input)
 *   sendButton   sel|fn — кнопка «отправить» (если нет или не активна — жмём Enter)
 *   trigger      { host: sel|fn, place: 'after'|'before'|'append', className? } — где вставить кнопку GIF
 *   anchor       sel|fn — панель ввода: над ней рисуется окно выбора
 *   scroller     sel|fn — (необязательно) список сообщений; если не задан, ищем ближайший прокручиваемый предок
 *   keepBottom   true — после вставки гифки удерживать чат «прилипшим» к низу
 *   boxHeight    высота гифки в сообщении, px (по умолчанию 200)
 *   theme        () => { bg, text, border, accent } — цвета окна выбора (см. NS.readTheme)
 *   alignPicker  false — не выравнивать окно по ширине панели ввода (по умолчанию выравниваем)
 *   noInputError текст ошибки, если поля ввода нет (не вошли в аккаунт и т.п.)
 */
(() => {
  const NS = globalThis.FOXV;
  if (!NS || NS.defineAdapter) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const pick = (v) => {
    try {
      if (typeof v === 'function') return v() || null;
      if (typeof v === 'string') return document.querySelector(v);
    } catch { /* битый селектор / страница в переходе */ }
    return null;
  };

  /** Кнопка GIF. extraClass нужен, чтобы подогнать размер/цвет под площадку (стили — в src/features/gifs/gifs.css). */
  NS.makeTrigger = (onClick, extraClass = '') => NS.el('button', {
    type: 'button', class: ('foxv-trigger ' + extraClass).trim(), title: 'GIF и стикеры', 'aria-label': 'GIF и стикеры',
    dataset: { foxvTrigger: '1' },
    onClick: (e) => { e.preventDefault(); e.stopPropagation(); onClick(); },
  }, NS.el('span', {}, 'GIF'));

  /** Читает CSS-переменные площадки: NS.readTheme(el, { bg: ['--x-bg', '#222'], ... }) -> { bg: '...' } */
  NS.readTheme = (from, map) => {
    const cs = getComputedStyle(from || document.documentElement);
    const out = {};
    for (const [k, [name, fallback]] of Object.entries(map)) out[k] = cs.getPropertyValue(name).trim() || fallback;
    return out;
  };

  /* ---------- работа с полем ввода ---------- */
  const isTextControl = (f) => f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement;

  function writeText(field, text) {
    field.focus();
    if (isTextControl(field)) {
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (set) set.call(field, text); else field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(field);
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { /* ignore */ }
    if (!ok || field.textContent !== text) {
      field.textContent = text;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  const isEmpty = (f) => !f || (isTextControl(f) ? !f.value.trim() : !f.textContent.trim());

  function readDraft(f) {
    if (isTextControl(f)) return f.value.trim() ? { value: f.value } : null;
    const nodes = Array.from(f.childNodes, (n) => n.cloneNode(true));
    // пустой параграф редактора может содержать <br> — это не черновик
    const real = nodes.some((n) => n.textContent.trim() || (n.nodeType === 1 && n.tagName !== 'BR'));
    return real ? { nodes } : null;
  }

  function restoreDraft(f, d) {
    if (d.value !== undefined) writeText(f, d.value);
    else {
      f.replaceChildren(...d.nodes.map((n) => n.cloneNode(true)));
      f.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function clearField(f) {
    if (isTextControl(f)) { writeText(f, ''); return; }
    f.replaceChildren();
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pressEnter(field) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    field.dispatchEvent(new KeyboardEvent('keydown', init));
    field.dispatchEvent(new KeyboardEvent('keypress', init));
    field.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  const isDisabled = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true';

  NS.defineAdapter = function defineAdapter(cfg) {
    let sending = false;
    let scrollEl = null;

    const hostOk = () => {
      const h = location.hostname;
      return (cfg.hosts || []).some((x) => h === x || h.endsWith('.' + x));
    };

    async function sendText(text) {
      if (sending) return { ok: false, error: 'Предыдущая отправка ещё идёт' };
      const field0 = pick(cfg.input);
      if (!field0) return { ok: false, error: cfg.noInputError || 'Поле ввода недоступно: войдите в аккаунт (или чат отключён)' };
      sending = true;
      try {
        const draft = readDraft(field0); // черновик пользователя не затираем
        writeText(field0, text);

        let sent = false;
        for (let i = 0; i < 20 && !sent; i++) {
          await sleep(100);
          const btn = pick(cfg.sendButton);
          if (btn && !isDisabled(btn)) { btn.click(); sent = true; }
        }
        if (!sent) pressEnter(pick(cfg.input) || field0);

        // Редактор может пересоздать поле после отправки — каждый раз ищем его заново.
        let cleared = false;
        for (let i = 0; i < 20 && !cleared; i++) {
          await sleep(100);
          cleared = isEmpty(pick(cfg.input));
        }

        const field = pick(cfg.input);
        if (field) {
          if (draft) restoreDraft(field, draft);
          else if (!cleared) clearField(field);
        }
        return cleared ? { ok: true } : { ok: false, error: 'Не отправилось (медленный режим или ограничения чата)' };
      } finally {
        sending = false;
      }
    }

    const adapter = {
      name: cfg.name,
      boxHeight: cfg.boxHeight,
      keepBottom: !!cfg.keepBottom,
      alignPicker: cfg.alignPicker !== false,

      match() {
        try {
          if (cfg.match) return !!cfg.match();
          if (!hostOk()) return false;
          return cfg.path ? cfg.path.test(location.pathname) : true;
        } catch { return false; }
      },

      ensureTrigger(onClick) {
        const t = cfg.trigger;
        if (!t) return;
        const host = pick(t.host);
        if (!host) return;
        const parent = t.place === 'append' ? host : host.parentElement;
        if (!parent || parent.querySelector('[data-foxv-trigger]')) return;
        const btn = NS.makeTrigger(onClick, t.className);
        if (t.place === 'before') host.before(btn);
        else if (t.place === 'append') host.append(btn);
        else host.after(btn);
      },

      isTrigger: (n) => !!(n && n.hasAttribute && n.hasAttribute('data-foxv-trigger')),

      getAnchorRect() {
        const a = pick(cfg.anchor) || pick(cfg.input);
        if (!a) return null;
        const r = a.getBoundingClientRect();
        return r.width > 0 ? r : null; // скрытая панель (чат свёрнут) — как будто якоря нет
      },

      sendText,

      scroller() {
        if (cfg.scroller) return pick(cfg.scroller);
        if (scrollEl && scrollEl.isConnected) return scrollEl;
        const m = document.querySelector(cfg.message);
        if (!m) return null;
        for (let e = m.parentElement; e && e !== document.documentElement; e = e.parentElement) {
          const oy = getComputedStyle(e).overflowY;
          if (oy === 'auto' || oy === 'scroll') return (scrollEl = e);
        }
        return null;
      },

      theme: cfg.theme,

      messageNodes: () => document.querySelectorAll(cfg.message),
      messageOf(node) {
        const e = node && (node.nodeType === 1 ? node : node.parentElement);
        return e && e.closest ? e.closest(cfg.message) : null;
      },
      messagesIn: (node) => (node.querySelectorAll ? node.querySelectorAll(cfg.message) : []),
    };

    NS.adapters.push(adapter);
    return adapter;
  };
})();
