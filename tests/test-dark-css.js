/* 夜间模式样式契约（纯 node，无需 Electron）：
   ① dark.css 可被 css-tree 无致命错误解析；
   ② 每条规则选择器都作用域化在 html.dark 之下（不允许污染浅色模式）；
   ③ 选择器引用的每个类名都必须真实存在于 index.html 或 src/js/*.js（词边界匹配），
     历史上删除的 live-clock / live-date / st-param-label 不得再被引用。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const projectRoot = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(projectRoot, 'src', 'dark.css'), 'utf8');

function parseDarkCss() {
  const parseErrors = [];
  const cssLines = css.split('\n');
  const rawDeclLines = {}; /* 行号 → 该行文本：用于识别自定义属性声明的 Raw（css-tree 已知行为） */
  cssLines.forEach((line, i) => { rawDeclLines[i + 1] = line; });
  const ast = csstree.parse(css, {
    filename: 'src/dark.css',
    positions: true,
    onParseError: (error) => parseErrors.push({
      message: String(error.message || error),
      line: error.source && error.line ? error.line : null
    })
  });
  const rawNodes = [];
  csstree.walk(ast, {
    visit: 'Raw',
    enter(node) {
      /* css-tree 对自定义属性（--var: value）的值按 Raw 解析，属正常现象非语法错误 */
      const decl = node.loc && rawDeclLines[Number(node.loc.start.line)];
      if (decl && /^\s*--[\w-]+\s*:/.test(decl)) return;
      rawNodes.push({
        value: String(node.value || '').slice(0, 60),
        line: node.loc ? node.loc.start.line : null
      });
    }
  });
  return { ast, parseErrors, rawNodes };
}

function eachSelector(ast, enter) {
  csstree.walk(ast, {
    visit: 'Rule',
    enter(rule) {
      csstree.walk(rule.prelude, {
        visit: 'Selector',
        enter(selector) {
          enter(selector, selector.children.toArray(), rule);
        }
      });
    }
  });
}

function classNamesInSelectors(ast) {
  const found = new Map(); // name -> [line, ...]
  eachSelector(ast, (selector) => {
    csstree.walk(selector, {
      visit: 'ClassSelector',
      enter(node) {
        const line = node.loc ? node.loc.start.line : null;
        if (!found.has(node.name)) found.set(node.name, []);
        found.get(node.name).push(line);
      }
    });
  });
  return found;
}

function sourceCorpus() {
  const files = [
    path.join(projectRoot, 'src', 'index.html'),
    ...fs.readdirSync(path.join(projectRoot, 'src', 'js'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(projectRoot, 'src', 'js', f))
  ];
  return files.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
}

/* 类名在 JS/HTML 里多为动态拼接，词边界匹配足够：前后不得是字母数字下划线连字符，
   防止 st-tr 被 st-tri、ac-day 被 ac-day-unrecorded 之类前缀误判为存在。 */
function classIsReferenced(name, text) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`).test(text);
}

test('dark.css parses without fatal syntax errors', () => {
  const { parseErrors, rawNodes } = parseDarkCss();
  assert.deepEqual(parseErrors, [], `css-tree 报告解析错误：${JSON.stringify(parseErrors)}`);
  assert.deepEqual(rawNodes, [], `出现无法解析的 Raw 节点：${JSON.stringify(rawNodes)}`);
});

test('every rule selector is scoped under html.dark', () => {
  const { ast } = parseDarkCss();
  const offenders = [];
  eachSelector(ast, (selector, children) => {
    const first = children[0];
    const second = children[1];
    const scoped = first && first.type === 'TypeSelector' && first.name === 'html'
      && second && second.type === 'ClassSelector' && second.name === 'dark';
    if (!scoped) {
      const line = selector.loc ? selector.loc.start.line : '?';
      offenders.push({ line, selector: csstree.generate(selector) });
    }
  });
  assert.deepEqual(offenders, [], `以下选择器未以 html.dark 开头：${JSON.stringify(offenders)}`);
});

test('every class referenced in dark.css exists in index.html or src/js/*.js', () => {
  const { ast } = parseDarkCss();
  const classLines = classNamesInSelectors(ast);
  const corpus = sourceCorpus();
  const missing = [];
  for (const [name, lines] of classLines) {
    const referenced = corpus.some(({ text }) => classIsReferenced(name, text));
    if (!referenced) missing.push({ name, lines: [...new Set(lines)] });
  }
  assert.deepEqual(missing, [], `dark.css 引用但 index.html / src/js/*.js 中不存在的类名：${JSON.stringify(missing)}`);
});

test('dark.css no longer references known-removed classes', () => {
  const { ast } = parseDarkCss();
  const names = [...classNamesInSelectors(ast).keys()];
  const removed = ['live-clock', 'live-date', 'st-param-label'];
  const present = removed.filter((name) => names.includes(name));
  assert.deepEqual(present, [], `dark.css 引用了已删除的类名：${present.join(', ')}`);
});
