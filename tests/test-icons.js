const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'face-icons-profile-'));
app.setPath('userData', profilePath);
app.commandLine.appendSwitch('disk-cache-dir', path.join(profilePath, 'cache'));

const cases = [];
const test = (name, run) => cases.push({ name, run });
let rendererWindow;

async function openRenderer(body) {
  if (!rendererWindow) {
    rendererWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    await rendererWindow.loadFile(path.join(__dirname, 'fixtures', 'icons.html'));
    await rendererWindow.webContents.executeJavaScript(`(() => {
    window.__rafCalls = 0;
    const nativeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      window.__rafCalls += 1;
      return nativeRaf(callback);
    };
    })()`);
  }
  await rendererWindow.webContents.executeJavaScript(`(async () => {
    document.body.innerHTML = ${JSON.stringify(body)};
    Icon3D.enhance(document.body);
    await Promise.resolve();
    window.__rafCalls = 0;
  })()`);
  return rendererWindow;
}

async function inRenderer(body, expression) {
  const win = await openRenderer(body);
  return win.webContents.executeJavaScript(expression);
}

test('initial emoji becomes a generated PNG icon', async () => {
  const result = await inRenderer('<div id="item">🏠 首页</div>', `({
    icons: document.querySelectorAll('#item > .icon3d.icon3d-home img').length,
    text: document.querySelector('#item').textContent.trim()
  })`);
  assert.deepEqual(result, { icons: 1, text: '首页' });
});

test('enhancing the same root twice is idempotent', async () => {
  const result = await inRenderer('<div id="item">✨ 今日状态</div>', `(() => {
    const root = document.querySelector('#item');
    Icon3D.enhance(root);
    const first = root.innerHTML;
    Icon3D.enhance(root);
    return {
      unchanged: root.innerHTML === first,
      icons: root.querySelectorAll(':scope > .icon3d').length,
      nestedIcons: root.querySelectorAll('.icon3d .icon3d').length
    };
  })()`);
  assert.deepEqual(result, { unchanged: true, icons: 1, nestedIcons: 0 });
});

test('dynamically added emoji content is enhanced', async () => {
  const result = await inRenderer('<main id="root"></main>', `(async () => {
    const node = document.createElement('div');
    node.id = 'dynamic';
    node.textContent = '🔥 连续打卡';
    document.querySelector('#root').appendChild(node);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      icons: node.querySelectorAll('.icon3d.icon3d-fire img').length,
      text: node.textContent.trim()
    };
  })()`);
  assert.deepEqual(result, { icons: 1, text: '连续打卡' });
});

test('plain clock characterData does not schedule replacement or pollute the page', async () => {
  const result = await inRenderer(
    '<time id="clock">09:41</time><p id="copy">正常文字</p>',
    `(async () => {
      window.__rafCalls = 0;
      document.querySelector('#clock').firstChild.nodeValue = '09:42';
      await new Promise(resolve => setTimeout(resolve, 40));
      return {
        rafCalls: window.__rafCalls,
        clock: document.querySelector('#clock').textContent,
        copy: document.querySelector('#copy').textContent,
        icons: document.querySelectorAll('.icon3d').length
      };
    })()`
  );
  assert.deepEqual(result, {
    rafCalls: 0,
    clock: '09:42',
    copy: '正常文字',
    icons: 0
  });
});

test('button label is preserved when its emoji is enhanced', async () => {
  const result = await inRenderer('<button id="start">▶ 开始训练</button>', `({
    icons: document.querySelectorAll('#start > .icon3d.icon3d-play img').length,
    label: document.querySelector('#start').textContent.trim()
  })`);
  assert.deepEqual(result, { icons: 1, label: '开始训练' });
});

test('null and empty roots are safe no-ops', async () => {
  const result = await inRenderer('', `(() => {
    Icon3D.enhance(null);
    const empty = document.createElement('div');
    Icon3D.enhance(empty);
    return { childNodes: empty.childNodes.length, icons: empty.querySelectorAll('.icon3d').length };
  })()`);
  assert.deepEqual(result, { childNodes: 0, icons: 0 });
});

test('every generated icon can be decoded from its packaged relative path', async () => {
  const win = await openRenderer('');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const failures = [];
    for (const name of Icon3D.names) {
      const img = Icon3D.makeIcon(name).querySelector('img');
      try { await img.decode(); } catch { failures.push(name); }
      if (!img.naturalWidth || img.alt !== '' || img.draggable) failures.push(name + ': invalid image');
    }
    return failures;
  })()`);
  assert.deepEqual(result, []);
});

test('plain and dynamically relabeled buttons keep readable labels and one icon', async () => {
  const result = await inRenderer('<button id="action" disabled>保存设置</button>', `(async () => {
    const button = document.querySelector('#action');
    const initial = { icon: button.querySelector('.icon3d-save') !== null, disabled: button.disabled, label: button.textContent };
    button.textContent = '⏸ 暂停计时';
    await new Promise(resolve => setTimeout(resolve, 20));
    Icon3D.enhance(button);
    return { initial, label: button.textContent.trim(), pause: !!button.querySelector('.icon3d-pause'), icons: button.querySelectorAll('.icon3d').length };
  })()`);
  assert.deepEqual(result, { initial: { icon: true, disabled: true, label: '保存设置' }, label: '暂停计时', pause: true, icons: 1 });
});

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try {
      await run();
      process.stdout.write(`ok - ${name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    }
  }
  process.stdout.write(`\n${cases.length - failures} passed, ${failures} failed\n`);
  rendererWindow?.destroy();
  app.exit(failures ? 1 : 0);
}).catch(error => {
  process.stderr.write(`${error.stack}\n`);
  rendererWindow?.destroy();
  app.exit(1);
});
