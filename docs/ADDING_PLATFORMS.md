# Как добавить площадку

## 1. Соберите данные о странице чата

В DevTools найдите и запишите:

| Что | Пример у VK Видео |
|---|---|
| элемент с **текстом** сообщения (не вся строка с ником) | `[data-test-id="ChatMessage:root"] [data-role="markup"]` |
| поле ввода | `[data-role="publisherInput"] [contenteditable="true"]` |
| кнопка отправки | `[data-test-id="publisherSubmitButton"]` |
| соседний элемент, рядом с которым встанет кнопка GIF | `[data-test-id="publisherSmileButton"]` |
| вся панель ввода | `#chat-pub-root` |

Советы:

- Предпочитайте `data-*` атрибуты. Хешированные классы вида `Chat_root__cOk0` меняются при каждой сборке сайта. Если без класса не обойтись, берите префикс: `[class*="StreamChatToggler_chatWrapper"]`.
- Проверьте, как ведёт себя поле ввода: обычное `textarea`, `contenteditable` или редактор вроде Slate/Editor.js. Кнопка отправки может включаться с задержкой.
- Проверьте, чат находится в `iframe` или в основном документе. Для `iframe` у блока в манифесте нужен `all_frames: true`.
- Удобно сохранить HTML чата целиком (например, через «Copy outerHTML»). По такому дампу селекторы можно проверить без запуска расширения.

## 2. Создайте адаптер

```bash
cp src/platforms/_template.js src/platforms/<имя>.js
```

Заполните конфиг. Минимальный пример:

```js
FOXV.defineAdapter({
  name: 'example-chat',
  hosts: ['example.com'],
  message: '.chat-message .text',
  input: '.chat-input [contenteditable]',
  sendButton: '.chat-send',
  trigger: { host: '.chat-emoji-button', place: 'after' },
  anchor: '.chat-input-panel',
});
```

Необязательные поля: `path`, `scroller`, `keepBottom`, `boxHeight`, `theme`, `alignPicker`, `noInputError`. Они описаны в начале `src/core/adapter-base.js`.

## 3. Подключите в манифесте

Добавьте блок в `content_scripts` в `manifest.json`: те же файлы, что у остальных площадок, но с вашим адаптером и своим `matches`.

```json
{
  "matches": ["https://example.com/*"],
  "all_frames": true,
  "run_at": "document_idle",
  "css": ["src/features/gifs/gifs.css"],
  "js": [
    "src/core/core.js",
    "src/core/adapter-base.js",
    "src/features/gifs/picker.js",
    "src/features/gifs/renderer.js",
    "src/features/gifs/index.js",
    "src/platforms/<имя>.js",
    "src/main.js"
  ]
}
```

## 4. Подгоните внешний вид

- размер и цвет кнопки: класс из `trigger.className`, стили в `src/features/gifs/gifs.css`;
- цвета окна выбора: поле `theme` (читайте переменные сайта через `FOXV.readTheme`);
- высота гифки в сообщении: `boxHeight`.

## 5. Проверьте

```bash
npm run check
```

Затем вручную в браузере:

- кнопка GIF появилась в панели ввода и открывает окно;
- выбор гифки отправляет `/tenor <ID>` и черновик в поле не пропадает;
- в чате сообщение превращается в картинку, а чат остаётся прижатым к низу;
- окно выбора не вылезает за пределы панели чата.
