/* Imagegen PNG 图标系统：保留原生文字、点击区域和业务逻辑。 */
(function () {
  const names = Object.freeze([
    'home', 'calendar', 'skincare', 'trophy', 'video', 'sun', 'cloud', 'moon',
    'play', 'add', 'check', 'film', 'folder', 'edit', 'pause', 'target', 'clock',
    'fire', 'sparkles', 'map', 'alarm', 'download', 'basket', 'search', 'save',
    'fullscreen', 'bolt', 'seed', 'star', 'rocket', 'crown', 'medal', 'close', 'trash', 'nutrition'
  ]);
  const assetBase = new URL('../assets/3d/', document.currentScript.src);

  const tokenMap = new Map([
    ['🍽️', 'nutrition'],
    ['🌤️', 'cloud'], ['⏱️', 'clock'], ['🏠', 'home'], ['🗓️', 'calendar'], ['🧴', 'skincare'],
    ['🏆', 'trophy'], ['🎬', 'video'], ['📺', 'video'], ['☀️', 'sun'], ['🌙', 'moon'],
    ['▶', 'play'], ['＋', 'add'], ['✓', 'check'], ['🎞️', 'film'], ['📁', 'folder'],
    ['✍️', 'edit'], ['⏸', 'pause'], ['🎯', 'target'], ['🔥', 'fire'], ['✨', 'sparkles'],
    ['🗺️', 'map'], ['⏰', 'alarm'], ['✏️', 'edit'], ['📥', 'download'], ['🧺', 'basket'],
    ['🔍', 'search'], ['💾', 'save'], ['⛶', 'fullscreen'], ['🎉', 'sparkles'], ['🟩', 'check'],
    ['⚡', 'bolt'], ['🌱', 'seed'], ['🌟', 'star'], ['🚀', 'rocket'], ['👑', 'crown'], ['🏅', 'medal'],
    ['🏋️', 'bolt'], ['🆕', 'seed'], ['🔀', 'target'], ['📋', 'save'], ['⚙️', 'edit'], ['📊', 'nutrition']
  ]);
  const tokens = Array.from(tokenMap.keys()).sort((a, b) => b.length - a.length);
  const tokenPattern = new RegExp('(' + tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');

  function makeIcon(name) {
    if (name === 'write') name = 'edit';
    if (!names.includes(name)) name = 'sparkles';
    const span = document.createElement('span');
    span.className = `icon3d icon3d-${name}`;
    span.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = new URL(`${name}.png`, assetBase).href;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    span.appendChild(img);
    return span;
  }

  function buttonIcon(button) {
    const label = button.textContent.trim();
    if (button.classList.contains('vid-del') || /删除/.test(label)) return 'trash';
    if (/取消|关闭/.test(label)) return 'close';
    if (/稍后/.test(label)) return 'clock';
    if (/编辑|补记/.test(label)) return 'edit';
    if (/保存/.test(label)) return 'save';
    if (/解析/.test(label)) return 'search';
    if (/导入/.test(label)) return 'download';
    if (/完成并|标记/.test(label)) return 'check';
    if (/跳过/.test(label)) return 'clock';
    if (/选择训练日/.test(label)) return 'target';
    if (/添加|新增|新建/.test(label)) return 'add';
    if (/计划安排/.test(label)) return 'calendar';
    if (/跟练|训练|播放器|开练/.test(label)) return 'play';
    if (/视频库/.test(label)) return 'video';
    if (/睡眠/.test(label)) return 'moon';
    if (/护理|皮肤/.test(label)) return 'skincare';
    if (/餐/.test(label)) return 'nutrition';
    return 'edit';
  }

  function enhance(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest('.icon3d, script, style, textarea, option')) return NodeFilter.FILTER_REJECT;
        return tokens.some(token => node.nodeValue.includes(token)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const parts = node.nodeValue.split(tokenPattern);
      if (parts.length < 2) return;
      const fragment = document.createDocumentFragment();
      parts.forEach(part => fragment.appendChild(tokenMap.has(part) ? makeIcon(tokenMap.get(part)) : document.createTextNode(part)));
      node.replaceWith(fragment);
    });
    const buttons = [...(root.matches?.('button') ? [root] : []), ...root.querySelectorAll('button')];
    buttons.forEach(button => {
      // Date cells show a check only when the day's target is met.
      if (button.hasAttribute('data-no-icon')) return;
      if (button.querySelector('.icon3d')) return;
      const name = buttonIcon(button);
      if (button.classList.contains('vid-del')) {
        button.setAttribute('aria-label', button.title || '删除视频');
        button.textContent = '';
      }
      button.prepend(makeIcon(name));
    });
  }

  function relevantRoot(node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element?.querySelectorAll || element.closest('.icon3d, script, style, textarea, option')) return null;
    const button = element.closest('button');
    if (button) return button;
    if (tokens.some(token => (node.textContent || '').includes(token)) || element.querySelector('button')) return element;
    return null;
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhance(document.body);
    new MutationObserver(mutations => {
      const roots = new Set();
      mutations.forEach(mutation => {
        const changed = mutation.type === 'characterData' ? [mutation.target] : mutation.addedNodes;
        changed.forEach(node => {
          const root = relevantRoot(node);
          if (root) roots.add(root);
        });
      });
      roots.forEach(enhance);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  window.Icon3D = { enhance, makeIcon, names };
})();
