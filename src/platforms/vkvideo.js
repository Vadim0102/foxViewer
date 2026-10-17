'use strict';
/*
 * VK Видео Live (live.vkvideo.ru и vkvideo.ru).
 *
 * Классы у VK хешированные (Chat_root__cOk0, ChatMessage_root_UHMEJ…) и меняются при сборках,
 * поэтому везде, где можно, опираемся на data-role / data-test-id. Там, где их нет — на ПРЕФИКС класса ([class*="…"]).
 *
 * Два варианта страницы:
 *  - страница стрима: чат лежит внутри <div class="StreamChatToggler_chatWrapper_…"> (боковая панель, её можно свернуть);
 *  - отдельное окно чата (popout / вставка в OBS): чат прямо в корне приложения, без обёртки.
 * Поэтому ищем элементы сначала внутри обёртки, а если её нет — по всему документу.
 *
 * Поле ввода — Editor.js: <div data-role="publisherInput"> … <div class="ce-paragraph" contenteditable="true">.
 * Кнопка отправки disabled, пока редактор не сообщит об изменении текста (это происходит с небольшой задержкой).
 */
(() => {
  const NS = globalThis.FOXV;
  if (!NS || !NS.defineAdapter) return;

  const CHAT_WRAPPER = '[class*="StreamChatToggler_chatWrapper"]';
  const CHAT_VIEW = '[data-test-id="chatContainer"]';

  const chatRoot = () => document.querySelector(CHAT_WRAPPER) || document.querySelector(CHAT_VIEW);
  const inChat = (sel) => () => {
    const root = chatRoot();
    return (root && root.querySelector(sel)) || document.querySelector(sel);
  };

  NS.defineAdapter({
    name: 'vkvideo-live-chat',
    hosts: ['vkvideo.ru'],

    // текст сообщения; ChatSystemMessage («Стример не в сети…») сюда не попадает
    message: '[data-test-id="ChatMessage:root"] [data-role="markup"]',

    input: inChat('[data-role="publisherInput"] [contenteditable="true"]'),
    sendButton: inChat('[data-test-id="publisherSubmitButton"]'),
    noInputError: 'Поле ввода недоступно: войдите в аккаунт VK (или чат отключён)',

    // наша кнопка — сразу справа от кнопки смайлов
    trigger: {
      host: inChat('[data-test-id="publisherSmileButton"]'),
      place: 'after',
      className: 'foxv-trigger--vk',
    },

    anchor: inChat('#chat-pub-root'),

    // в узком боковом чате полная гифка 200px — слишком крупно
    boxHeight: 160,

    // после вставки гифки чат должен остаться прижатым к низу
    keepBottom: true,

    // VKUI хранит цвета в CSS-переменных на корне приложения; окно выбора живёт вне корня, поэтому переносим значения
    theme: () => NS.readTheme(document.querySelector('.vkuitokens__defaultColor') || document.body, {
      bg: ['--vkui--color_background_modal', '#2c2d2e'],
      text: ['--vkui--color_text_primary', '#e1e3e6'],
      border: ['--vkui--color_separator_primary', 'rgba(255,255,255,.12)'],
      accent: ['--vkui--color_text_accent', '#71aaeb'],
    }),
  });
})();
