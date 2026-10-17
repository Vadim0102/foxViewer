'use strict';
/*
 * ШАБЛОН адаптера (в manifest.json не подключён). Как добавить площадку:
 *   1. Скопировать файл в src/platforms/<имя>.js и заполнить селекторы (см. список полей в src/core/adapter-base.js).
 *   2. В manifest.json добавить ещё один блок content_scripts: matches площадки + те же файлы, что у vkvideo,
 *      но с вашим файлом вместо src/platforms/vkvideo.js (подробности: docs/ADDING_PLATFORMS.md).
 *   3. При необходимости подогнать размер кнопки в src/features/gifs/gifs.css (класс из trigger.className).
 *
 * Что искать в DevTools:
 *   message     — элемент, внутри которого лежит ТЕКСТ сообщения (не вся строка с ником и временем)
 *   input       — поле ввода; sendButton — кнопка «отправить»
 *   trigger     — соседний элемент панели ввода (обычно кнопка смайлов), рядом с которым встанет кнопка GIF
 *   anchor      — вся панель ввода: над ней откроется окно выбора
 * Предпочитайте data-атрибуты (data-a-target, data-test-id, data-role…) хешированным классам.
 */
(() => {
  const NS = globalThis.FOXV;
  if (!NS || !NS.defineAdapter) return;

  NS.defineAdapter({
    name: 'example-chat',
    hosts: ['example.com'],
    // path: /^\/chat\//,

    message: '.chat-message .text',
    input: '.chat-input [contenteditable]',
    sendButton: '.chat-send',
    trigger: { host: '.chat-emoji-button', place: 'after', className: '' },
    anchor: '.chat-input-panel',

    // keepBottom: true,
    // boxHeight: 160,
    // theme: () => NS.readTheme(document.body, { bg: ['--bg', '#222'], text: ['--text', '#fff'], border: ['--line', '#444'], accent: ['--accent', '#4af'] }),
  });
})();
