'use strict';
/*
 * Точка входа: выбирает площадку (адаптер) и запускает зарегистрированные фичи.
 *
 * Контракт фичи (src/features/<имя>/…, регистрируется через NS.features.push):
 *   init(adapter)               -> один раз при старте
 *   onTick(adapter)             -> часто (на мутации DOM и по таймеру) — например, вставить свою кнопку
 *   onMessages(adapter, nodes)  -> новые/изменённые элементы с текстом сообщений; nodes === null — просканировать всё
 * Ошибка в одной фиче не мешает остальным.
 */
(() => {
  const NS = globalThis.FOXV;
  if (!NS || NS.started) return;
  const adapter = NS.adapters.find((a) => { try { return a.match(); } catch { return false; } });
  if (!adapter) return;
  NS.started = true;

  const each = (hook, ...args) => {
    for (const f of NS.features) {
      if (typeof f[hook] !== 'function') continue;
      try { f[hook](adapter, ...args); } catch (e) { console.error(`[foxViewer] feature "${f.name}" ${hook}:`, e); }
    }
  };

  each('init');

  const tick = () => {
    each('onTick');
    each('onMessages', null);
  };

  let timer = 0;
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = 0; tick(); }, 120); };
  // Сообщения обрабатываем прямо в колбэке наблюдателя: это происходит до первой отрисовки и до того,
  // как сайт измерит высоту списка, поэтому чат не дёргается. Полный скан — только как страховка.
  new MutationObserver((records) => {
    const nodes = new Set();
    for (const r of records) {
      const own = adapter.messageOf && adapter.messageOf(r.target);
      if (own) nodes.add(own);
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        const m = adapter.messageOf && adapter.messageOf(n);
        if (m) nodes.add(m);
        if (adapter.messagesIn) for (const x of adapter.messagesIn(n)) nodes.add(x);
      }
    }
    if (nodes.size) each('onMessages', nodes);
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 1500); // страховка: сайт может перерисовать сообщение без заметных нам мутаций
  tick();
})();
