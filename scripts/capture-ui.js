/* Capture the real Electron window for design review. Usage: electron scripts/capture-ui.js [width] [height] [output]. */
const fs = require('fs');
const path = require('path');
const electron = require('electron');
if (!electron.app) {
  process.stderr.write('This capture must run with the project Electron launcher: node_modules\\.bin\\electron.cmd scripts\\capture-ui.js\n');
  process.exit(2);
}
const { app } = electron;
// Captures always use empty sample data, never the user's health records.
const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'face-reshape-capture-'));
app.setPath('userData', profile);
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }));

const width = Math.max(980, Number(process.argv[2]) || 1240);
const height = Math.max(640, Number(process.argv[3]) || 820);
const output = path.resolve(process.argv[4] || `.impeccable/review/${width}x${height}.png`);
const captureView = process.argv[5] || 'today';
let captured = false;

app.on('browser-window-created', (_event, window) => {
  window.setSize(width, height);
  window.webContents.once('did-finish-load', async () => {
    if (captured) return;
    captured = true;
    try {
      const readState = () => window.webContents.executeJavaScript(`({
          title: document.title,
          view: document.querySelector('#page-title')?.textContent,
          icons: document.querySelectorAll('.icon3d').length,
          emojiLeft: /[🏠🗓️🧴🏆🎬📺☀️🌤️🌙🔥✨]/u.test(document.body.innerText),
          hero: Boolean(document.querySelector('.today-title')),
          startButton: Boolean(document.querySelector('#td-go')),
          statusReady: document.querySelector('#today-status-pill')?.textContent !== '加载中…',
          navMarkup: document.querySelector('.nav-ico')?.innerHTML
        })`);
      const deadline = Date.now() + 5000;
      let state;
      do {
        state = await readState();
        if (state.hero && state.startButton && state.icons >= 8 && !state.emojiLeft && state.statusReady) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      if (!state.hero || !state.startButton || state.icons < 8 || state.emojiLeft || !state.statusReady) {
        throw new Error(`UI contract failed: ${JSON.stringify(state)}`);
      }
      const routes = await window.webContents.executeJavaScript(`(async () => {
        const results = [];
        for (const view of ['today', 'plan', 'skincare', 'nutrition', 'achievements']) {
          const button = document.querySelector('.nav-item[data-view="' + view + '"]');
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          button.click();
          await new Promise(resolve => setTimeout(resolve, 80));
          const root = document.querySelector('#view-root');
          results.push({
            view,
            active: document.querySelector('.nav-item.active')?.dataset.view,
            icons: root.querySelectorAll('.icon3d').length,
            emojiLeft: /\\p{Extended_Pictographic}|[▶＋✓⏸⛶]/u.test(root.innerText),
            horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
            navHit: Boolean(hit?.closest('.nav-item') === button)
          });
        }
        document.querySelector('.nav-item[data-view="today"]').click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const start = document.querySelector('#td-go');
        const r = start.getBoundingClientRect();
        const startHit = Boolean(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#td-go'));
        return { results, startHit };
      })()`);
      const routeFailure = routes.results.find(item => item.active !== item.view || item.emojiLeft || item.horizontalOverflow || !item.navHit);
      if (routeFailure || !routes.startHit) throw new Error(`Route contract failed: ${JSON.stringify(routes)}`);
      if (!['today', 'plan', 'skincare', 'nutrition', 'achievements'].includes(captureView)) throw new Error(`Unknown capture view: ${captureView}`);
      await window.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="${captureView}"]').click()`);
      window.show();
      await new Promise(resolve => setTimeout(resolve, 700));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const image = await window.webContents.capturePage();
      const png = image.toPNG();
      if (image.isEmpty() || !png.length) throw new Error('Electron returned an empty screenshot');
      fs.writeFileSync(output, png);
      process.stdout.write(`CAPTURED ${output}\n${JSON.stringify(state)}\n${JSON.stringify(routes)}\n`);
      app.quit();
    } catch (error) {
      process.stderr.write(`${error.stack || error}\n`);
      app.exit(1);
    }
  });
});

require('../main.js');
