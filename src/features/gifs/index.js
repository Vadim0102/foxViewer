'use strict';
/* Фича «GIF и стикеры»: кнопка в панели ввода + окно поиска (picker.js) + отрисовка "/tenor <ID>" в чате (renderer.js). */
(() => {
  const NS = globalThis.FOXV;
  if (!NS) return;
  let picker = null;

  NS.features.push({
    name: 'gifs',

    init(adapter) {
      picker = NS.createPicker({
        getAnchorRect: () => adapter.getAnchorRect(),
        isTrigger: (n) => adapter.isTrigger(n),
        getTheme: () => (adapter.theme ? adapter.theme() : null),
        alignToAnchor: !!adapter.alignPicker,
        onPick: (item) => adapter.sendText(NS.formatCommand('tenor', item.id)),
      });
    },

    onTick(adapter) { adapter.ensureTrigger(() => picker.toggle()); },

    onMessages(adapter, nodes) { NS.scan(adapter, nodes || undefined); },
  });
})();
