'use strict';
/* Превращает сообщения "/tenor <ID>" в картинки. Исходный текст не удаляется, а прячется (font-size:0). */
(() => {
  const NS = globalThis.FOXV;
  const { el } = NS;

  const BOX_H = 200; // по умолчанию; адаптер может задать свою высоту через boxHeight
  const failed = new WeakMap(); // msg -> {text, t}: не долбим Tenor при ошибке

  // видео играют только когда видны на экране
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) v.play?.().catch(() => {});
      else v.pause?.();
    }
  }, { threshold: 0.01 });

  // Просим YouTube пересчитать высоту списка и «прилипание» к низу после того, как мы изменили высоту сообщения.
  let nudgeQueued = false;
  function nudge() {
    if (nudgeQueued) return;
    nudgeQueued = true;
    requestAnimationFrame(() => { nudgeQueued = false; window.dispatchEvent(new Event('resize')); });
  }

  function ownText(msg, wrap) {
    let s = '';
    for (const n of msg.childNodes) if (n !== wrap) s += n.textContent;
    return s.trim();
  }

  function fill(wrap, r, boxH) {
    wrap.classList.remove('loading');
    const webm = NS.safeMedia(r.webm), mp4 = NS.safeMedia(r.mp4), gif = NS.safeMedia(r.gif);
    wrap.title = r.alt || wrap.dataset.src;
    // ширина по пропорциям при фиксированной высоте — высота сообщения не меняется
    if (r.w > 0 && r.h > 0) wrap.style.width = Math.max(80, Math.round(boxH * r.w / r.h)) + 'px';

    const useImg = () => {
      if (!gif) { wrap.remove(); return false; }
      wrap.replaceChildren(el('img', { class: 'foxv-media', src: gif, alt: r.alt || '', decoding: 'async', draggable: false }));
      return true;
    };

    if (webm || mp4) {
      const v = el('video', { class: 'foxv-media', muted: true, loop: true, autoplay: true, playsInline: true, preload: 'auto' });
      v.setAttribute('muted', '');
      if (webm) v.append(el('source', { src: webm, type: 'video/webm' }));
      if (mp4) v.append(el('source', { src: mp4, type: 'video/mp4' }));
      let failed = false;
      v.addEventListener('error', () => { if (!failed) { failed = true; io.unobserve(v); useImg(); } }, true);
      wrap.replaceChildren(v);
      io.observe(v);
    } else {
      useImg();
    }
  }

  async function render(adapter, msg, cmd, original) {
    const wrap = el('a', {
      class: 'foxv-wrap loading', href: `https://tenor.com/view/${cmd.id}`,
      target: '_blank', rel: 'noopener noreferrer',
    });
    wrap.dataset.src = original;
    const boxH = adapter.boxHeight || BOX_H;
    wrap.style.height = boxH + 'px';
    msg.classList.add('foxv-has');
    msg.append(wrap);
    const cached = NS.peek(cmd.provider, cmd.id);
    if (cached) { fill(wrap, cached, boxH); nudge(); return; }   // отрисовано синхронно
    nudge();
    try {
      fill(wrap, await NS.resolve(cmd.provider, cmd.id), boxH);
      nudge();
    } catch {
      wrap.remove();
      failed.set(msg, { text: original, t: Date.now() });
      msg.classList.remove('foxv-has'); // не получилось — остаётся обычный текст
    }
  }

  NS.scan = (adapter, nodes) => {
    // Если чат был прижат к низу, а мы добавили гифку (+высота), возвращаем его к низу сами.
    // Замеряем ДО правок: к этому моменту сайт уже прокрутил список к новому сообщению.
    const sc = adapter.keepBottom && adapter.scroller ? adapter.scroller() : null;
    const stick = !!sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 60;
    let changed = false;

    for (const msg of (nodes || adapter.messageNodes())) {
      const wrap = msg.querySelector(':scope > .foxv-wrap');
      const text = ownText(msg, wrap);
      if (wrap) {
        if (wrap.dataset.src === text) continue;
        wrap.remove();                       // сайт перерисовал сообщение — разберёмся заново
        msg.classList.remove('foxv-has');
        changed = true;
      }
      const f = failed.get(msg);
      if (f && f.text === text && Date.now() - f.t < 15000) continue;
      const cmd = NS.parseCommand(text);
      if (cmd) { render(adapter, msg, cmd, text); changed = true; }
    }

    if (stick && changed) sc.scrollTop = sc.scrollHeight;
  };
})();
