/* CDP probe: 实测 .cm-gutters 在"点击编辑 vs 滚动"两个状态下的实测宽度 */
const http = require('http');

const CDP_PORT = 9223;
const TARGET_URL = 'http://127.0.0.1:5300/';

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const targets = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
  const page = targets.find(t => t.url === TARGET_URL && t.type === 'page');
  if (!page) {
    console.log('no page matching', TARGET_URL);
    console.log(targets.map(t => `${t.type} | ${t.url}`).join('\n'));
    process.exit(1);
  }
  console.log('target:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  await new Promise(r => { ws.onopen = r; });

  async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result?.result?.value;
  }

  // 不 reload：直接测用户当前正在看的 EditorView 实例
  for (let i = 0; i < 10; i++) {
    const has = await evalJs(`!!document.querySelector('.cm-editor')`);
    if (has) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const probe = `(() => {
    const editor = document.querySelector('.cm-editor');
    if (!editor) return { error: 'no .cm-editor in DOM' };
    const g = editor.querySelector('.cm-gutters');
    const ln = editor.querySelector('.cm-gutter.cm-lineNumbers');
    const gg = editor.querySelector('.cm-gutter.cm-gitGutter');
    const sc = editor.querySelector('.cm-scroller');
    const first = ln ? ln.querySelector('.cm-gutterElement') : null;
    const spacer = ln ? ln.querySelector('.cm-gutterElement[style*="visibility"]') : null;
    // 列出全部 gutterElement 的文本+实测宽度，看清 spacer / 数字行号分别多宽
    const elWidths = ln ? Array.from(ln.querySelectorAll('.cm-gutterElement')).map(el => ({
      text: JSON.stringify(el.textContent),
      w: el.getBoundingClientRect().width,
      offsetW: el.offsetWidth,
      vis: getComputedStyle(el).visibility,
      hasActiveCls: el.classList.contains('cm-activeLineGutter')
    })) : [];
    // 去重一下，同宽度的合并
    const grouped = {};
    for (const e of elWidths) {
      const k = e.text + '|' + e.vis;
      if (!grouped[k]) grouped[k] = { text: e.text, vis: e.vis, widths: [] };
      grouped[k].widths.push(e.w);
    }
    return {
      guttersRect: g ? g.getBoundingClientRect().width : null,
      guttersComputed: g ? getComputedStyle(g).width : null,
      lnW: ln ? ln.offsetWidth : null,
      lnComputedW: ln ? getComputedStyle(ln).width : null,
      lnRectW: ln ? ln.getBoundingClientRect().width : null,
      lnEl: ln ? ln.querySelectorAll('.cm-gutterElement').length : null,
      lnFirstText: first ? JSON.stringify(first.textContent) : null,
      spacerText: spacer ? JSON.stringify(spacer.textContent) : null,
      lnElGrouped: Object.values(grouped).slice(0, 10).map(g2 => ({ text: g2.text, vis: g2.vis, widths: g2.widths.slice(0, 5), count: g2.widths.length })),
      ggW: gg ? gg.offsetWidth : null,
      ggComputedW: gg ? getComputedStyle(gg).width : null,
      ggEl: gg ? gg.querySelectorAll('.cm-gutterElement').length : null,
      scrollTop: sc ? sc.scrollTop : null,
      scrollerW: sc ? sc.clientWidth : null
    };
  })()`;

  const initial = await evalJs(probe);
  console.log('\n=== initial ===');
  console.log(JSON.stringify(initial, null, 2));

  // 直查 gitGutter 列的 DOM 与 computed style，看 renderEmptyElements 是否生效
  const ggDirect = await evalJs(`(() => {
    const gg = document.querySelector('.cm-editor .cm-gutter.cm-gitGutter');
    if (!gg) return {found:false};
    const children = gg.children;
    const first = children[0];
    // 看 gitGutter 是否带 spacer / 多少元素是空的 vs 有 marker
    const detail = Array.from(children).map(c => ({
      cls: c.className,
      w: c.offsetWidth,
      h: c.offsetHeight,
      vis: getComputedStyle(c).visibility,
      hasKids: c.childNodes.length,
      kidTags: Array.from(c.childNodes).map(n => n.nodeName + (n.className ? '.' + n.className : ''))
    }));
    return {
      found: true,
      childCount: children.length,
      innerHTML_len: gg.innerHTML.length,
      ggStyleWidth: getComputedStyle(gg).width,
      ggOffsetWidth: gg.offsetWidth,
      details: detail.slice(0, 5),
      // 编辑器是否仍是 HMR 之后的实例：查 cm-gitGutter 所在 .cm-gutters 的 nextSibling 是否是 .cm-content
      parentClass: gg.parentElement ? gg.parentElement.className : null,
      siblingsInGutters: gg.parentElement ? Array.from(gg.parentElement.children).map(c => c.className) : null
    };
  })()`);
  console.log('\n=== gitGutter DOM direct ===');
  console.log(JSON.stringify(ggDirect, null, 2));

  if (initial.error) {
    console.log('\n编辑器可能没打开，body 前 300 字：');
    const body = await evalJs(`document.body.innerText.slice(0,300)`);
    console.log(body);
    process.exit(0);
  }

  await evalJs(`(() => {
    const content = document.querySelector('.cm-editor .cm-content');
    if (content) content.focus();
    return null;
  })()`);
  await new Promise(r => setTimeout(r, 400));
  const afterClick = await evalJs(probe);
  console.log('\n=== after click/focus ===');
  console.log(JSON.stringify(afterClick, null, 2));

  await evalJs(`(() => {
    const sc = document.querySelector('.cm-editor .cm-scroller');
    if (sc) sc.scrollTop = sc.scrollTop + 600;
    return null;
  })()`);
  await new Promise(r => setTimeout(r, 500));
  const afterScroll = await evalJs(probe);
  console.log('\n=== after scroll ===');
  console.log(JSON.stringify(afterScroll, null, 2));

  await evalJs(`(() => {
    const content = document.querySelector('.cm-editor .cm-content');
    if (content) content.focus();
    return null;
  })()`);
  await new Promise(r => setTimeout(r, 400));
  const afterClick2 = await evalJs(probe);
  console.log('\n=== after click 2 ===');
  console.log(JSON.stringify(afterClick2, null, 2));

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
