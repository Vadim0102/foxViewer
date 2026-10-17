'use strict';
/*
 * Адаптер чата YouTube (страница https://www.youtube.com/live_chat*, то есть содержимое iframe#chatframe).
 * Чтобы поддержать другой сайт — скопируйте этот файл, поменяйте селекторы и добавьте сайт в manifest.json.
 *
 * Контракт адаптера:
 *   match()               -> подходит ли адаптер текущей странице
 *   ensureTrigger(onClick)-> гарантирует, что кнопка открытия окна есть в интерфейсе (вызывается часто, должна быть дешёвой)
 *   isTrigger(node)       -> является ли узел нашей кнопкой
 *   getAnchorRect()       -> DOMRect панели ввода (над ней рисуется окно)
 *   sendText(text)        -> Promise<{ok, error?}>: отправить сообщение в чат
 *   messageNodes()        -> элементы с ТЕКСТОМ сообщений (для рендера)
 *   scroller()            -> (необязательно) прокручиваемый список сообщений, чтобы удерживать «прилипание» к низу
 */
(() => {
  const NS = globalThis.FOXV;
  const q = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const INPUT_SEL = 'yt-live-chat-message-input-renderer div#input[contenteditable]';
  const MSG_SEL = 'yt-live-chat-text-message-renderer #message, yt-live-chat-paid-message-renderer #message';
  const SEND_SEL = 'yt-live-chat-message-input-renderer #send-button button';

  function setFieldText(field, text) {
    field.focus();
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

  function pressEnter(field) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    field.dispatchEvent(new KeyboardEvent('keydown', init));
    field.dispatchEvent(new KeyboardEvent('keypress', init));
    field.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  async function sendText(text) {
    const field = q(INPUT_SEL);
    if (!field) return { ok: false, error: 'Поле ввода недоступно: войдите в аккаунт (или чат отключён)' };

    // сохраняем черновик пользователя, чтобы не затереть
    const draft = Array.from(field.childNodes, (n) => n.cloneNode(true));
    const restoreDraft = () => {
      field.replaceChildren(...draft.map((n) => n.cloneNode(true)));
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };

    setFieldText(field, text);

    let sent = false;
    for (let i = 0; i < 15 && !sent; i++) {
      await sleep(100);
      const btn = q(SEND_SEL);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); sent = true; }
    }
    if (!sent) pressEnter(field);

    // YouTube очищает поле после отправки
    let cleared = false;
    for (let i = 0; i < 15 && !cleared; i++) {
      await sleep(100);
      cleared = !field.textContent.trim();
    }

    if (draft.length) restoreDraft();
    else if (!cleared) { field.replaceChildren(); field.dispatchEvent(new Event('input', { bubbles: true })); }

    return cleared
      ? { ok: true }
      : { ok: false, error: 'Не отправилось (медленный режим или ограничения чата)' };
  }

  NS.adapters.push({
    name: 'youtube-live-chat',

    match: () => location.hostname === 'www.youtube.com' && location.pathname.startsWith('/live_chat'),

    ensureTrigger(onClick) {
      const host = q('yt-live-chat-message-input-renderer #emoji-picker-button');
      if (!host || host.querySelector('[data-foxv-trigger]')) return;
      host.append(NS.el('button', {
        type: 'button', class: 'foxv-trigger', title: 'GIF и стикеры', 'aria-label': 'GIF и стикеры',
        dataset: { foxvTrigger: '1' },
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); onClick(); },
      }, NS.el('span', {}, 'GIF')));
    },

    isTrigger: (n) => !!(n && n.hasAttribute && n.hasAttribute('data-foxv-trigger')),

    getAnchorRect() {
      const p = q('#input-panel') || q('yt-live-chat-message-input-renderer');
      return p ? p.getBoundingClientRect() : null;
    },

    sendText,

    scroller: () => q('#item-scroller'),

    messageNodes: () => document.querySelectorAll(MSG_SEL),

    /** Для инкрементальной обработки: к какому сообщению относится узел и какие сообщения лежат внутри узла. */
    messageOf(node) {
      const e = node && (node.nodeType === 1 ? node : node.parentElement);
      return e && e.closest ? e.closest(MSG_SEL) : null;
    },
    messagesIn: (node) => (node.querySelectorAll ? node.querySelectorAll(MSG_SEL) : []),
  });
})();
