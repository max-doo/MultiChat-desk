/**
 * messageContainer 选择器诊断工具（dev-only）
 * 探针逻辑同源拷贝自 src/shared/utils/webviewScripts.ts:1509-1572，
 * 保证"探针命中 = 生产命中"。修改 webviewScripts.ts 的匹配逻辑时必须同步本文件。
 */
import type { AutomationStep } from '../config/selectors'

export interface CandidateReport {
  selector: string
  hitCount: number
  visibleHitCount: number
  firstHit: {
    tag: string
    className: string | null
    id: string | null
    dataTestid: string | null
    /** 元素可见正文长度（脱敏：仅长度，不含正文内容） */
    visibleTextLen: number
  } | null
  error?: string
}

export interface ProbeReport {
  ok: boolean
  candidates: CandidateReport[]
  error?: string
}

/**
 * 构建在平台页内执行的探针脚本字符串。
 * @param selectors 候选选择器数组（来自 selectors.models[id].messageContainer）
 * @returns 可传入 webview.executeJavaScript 的脚本字符串
 */
export function buildProbeScript(selectors: string[]): string {
  // 探针四函数同源拷贝自 webviewScripts.ts:1509-1572，注释行号对应原文件
  return `(function () {
    var containerSelectors = ${JSON.stringify(selectors)};

    // 来源: webviewScripts.ts:1512
    function safeQueryAll(root, selector) {
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch (e) {
        return [];
      }
    }

    // 来源: webviewScripts.ts:1553
    function isVisible(element) {
      try {
        if (!element || !element.isConnected) return false;
        if (!element.getClientRects || element.getClientRects().length === 0) return false;
        var rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        var cur = element;
        while (cur && cur.nodeType === 1) {
          var style = window.getComputedStyle(cur);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          var opacity = Number(style.opacity || '1');
          if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
          cur = cur.parentElement;
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    // 来源: webviewScripts.ts:1524-1538（shadow root 兜底）
    function queryAllWithShadow(selector) {
      var hits = safeQueryAll(document, selector);
      if (hits.length > 0) return hits;
      var docRoot = document.body || document.documentElement;
      if (docRoot && document.createTreeWalker) {
        var walker = document.createTreeWalker(docRoot, NodeFilter.SHOW_ELEMENT);
        var node = walker.currentNode;
        while (node) {
          var el = node;
          if (el && el.shadowRoot) {
            hits = hits.concat(safeQueryAll(el.shadowRoot, selector));
          }
          node = walker.nextNode();
        }
      }
      return hits;
    }

    function describeFirst(el) {
      if (!el) return null;
      var text = '';
      try {
        text = (el.innerText || el.textContent || '') + '';
      } catch (e) {
        text = '';
      }
      // 脱敏：仅长度，不含正文
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        visibleTextLen: text.replace(/\u200B/g, '').trim().length
      };
    }

    var candidates = containerSelectors.map(function (selector) {
      var hits = [];
      var err = null;
      try {
        hits = queryAllWithShadow(selector);
      } catch (e) {
        err = String(e && e.message ? e.message : e);
      }
      // 去重（来源: webviewScripts.ts:1545-1551，用 indexOf 实现以适配注入环境）
      var unique = [];
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        if (!h) continue;
        if (unique.indexOf(h) === -1) unique.push(h);
      }
      var firstVisible = null;
      var visibleCount = 0;
      for (var j = 0; j < unique.length; j++) {
        if (isVisible(unique[j])) {
          visibleCount++;
          if (!firstVisible) firstVisible = unique[j];
        }
      }
      var report = {
        selector: selector,
        hitCount: hits.length,
        visibleHitCount: visibleCount,
        firstHit: describeFirst(firstVisible)
      };
      if (err) report.error = err;
      return report;
    });

    return JSON.stringify({ ok: true, candidates: candidates });
  })();`
}

/**
 * 解析 executeJavaScript 返回的探针结果。
 * 异常兜底返回 { ok: false, candidates: [], error }。
 */
export function parseProbeResult(raw: unknown): ProbeReport {
  if (typeof raw !== 'string') {
    return { ok: false, candidates: [], error: '探针返回非字符串' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.candidates)) {
      return { ok: false, candidates: [], error: '探针返回结构异常' }
    }
    return {
      ok: !!parsed.ok,
      candidates: parsed.candidates as CandidateReport[]
    }
  } catch (e) {
    return { ok: false, candidates: [], error: `结果解析失败: ${String(e)}` }
  }
}

export interface StepReport {
  index: number
  selector: string
  found: boolean
  matchedVia: 'selector' | 'semantic-fallback' | 'menu-opener-fallback' | null
  firstHit: {
    tag: string
    className: string | null
    id: string | null
    dataTestid: string | null
    /** 元素可见正文长度（脱敏：仅长度，不含正文内容） */
    visibleTextLen: number
  } | null
  error?: string
}

export interface ResearchProbeReport {
  ok: boolean
  steps: StepReport[]
  error?: string
}

/**
 * 构建在平台页内执行的 researchMode 探针脚本字符串。
 * @param steps researchMode 步骤数组（来自 selectors.models[id].researchMode.steps）
 * @returns 可传入 webview.executeJavaScript 的脚本字符串
 */
export function buildResearchProbeScript(steps: AutomationStep[]): string {
  // 探针复刻 webviewScripts.ts:640-781 的 findElement+findMenuOpener（同源只读，不点击）
  return `(function () {
    var steps = ${JSON.stringify(steps)};

    // 来源: webviewScripts.ts:640-748 findElement（只读复刻，去掉 normalizeClickable 的点击相关）
    function matchText(content, ariaLabel, o) {
      var flags = o.caseSensitive ? '' : 'i';
      var targets = o.regex
        ? [o.regex]
        : (o.text != null ? (Array.isArray(o.text) ? o.text : [o.text]) : []);
      // 来源: webviewScripts.ts:662-665 exclude 命中任一即否（区分 Search/Research 的关键，同源）
      var excludeList = o.exclude || [];
      for (var exi = 0; exi < excludeList.length; exi++) {
        try { if (new RegExp(excludeList[exi], flags).test(content) || new RegExp(excludeList[exi], flags).test(ariaLabel)) return false; } catch (e) {}
      }
      for (var ti = 0; ti < targets.length; ti++) {
        var t = targets[ti];
        if (!t) continue;
        if (o.regex) {
          var pat = t;
          if (o.wordBoundary !== false) {
            if (!/^\\^/.test(pat)) pat = '\\\\b(?:' + pat + ')';
            if (!/\\$$/.test(pat)) pat = pat + '\\\\b';
          }
          try {
            var re = new RegExp(pat, flags);
            if (re.test(content) || re.test(ariaLabel)) return true;
          } catch (e) {}
        } else if (o.exact) {
          if (content === t || ariaLabel === t) return true;
        } else {
          var lc = (content || '').toLowerCase();
          var la = (ariaLabel || '').toLowerCase();
          var lt = String(t).toLowerCase();
          if (lc.includes(lt) || la.includes(lt)) return true;
        }
      }
      return false;
    }

    function describeFirst(el) {
      if (!el) return null;
      var text = '';
      try { text = (el.innerText || el.textContent || '') + ''; } catch (e) { text = ''; }
      // 脱敏：仅长度，不含正文
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        visibleTextLen: text.replace(/\\u200B/g, '').trim().length
      };
    }

    function findElementForStep(step) {
      var selector = step.selector;
      var text = step.text;
      var o = step;
      var selectorList = Array.isArray(selector) ? selector : [selector];
      for (var si = 0; si < selectorList.length; si++) {
        var sel = selectorList[si];
        var elements = null;
        try { elements = document.querySelectorAll(sel); } catch (e) { continue; }
        if (!text && !o.regex) {
          for (var vi = 0; vi < elements.length; vi++) {
            var vel = elements[vi];
            if (vel.getBoundingClientRect().width > 0 || vel.offsetParent !== null) {
              return { el: vel, via: 'selector' };
            }
          }
          if (elements && elements[0]) return { el: elements[0], via: 'selector' };
          continue;
        }
        for (var mi = 0; mi < elements.length; mi++) {
          var el = elements[mi];
          if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) continue;
          var content = (el.innerText || el.textContent || '').trim();
          var ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          if (matchText(content, ariaLabel, o)) return { el: el, via: 'selector' };
        }
      }
      // 来源: webviewScripts.ts:726-745 策略二降级（语义兜底）
      if (text || (o && o.regex)) {
        var semanticSelectors = 'button, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemradio"], [role="tab"], label, input[type="checkbox"], input[type="radio"]';
        var semanticElements = [];
        try { semanticElements = document.querySelectorAll(semanticSelectors); } catch (e) {}
        for (var sei = 0; sei < semanticElements.length; sei++) {
          var sel2 = semanticElements[sei];
          if (sel2.getBoundingClientRect().width === 0 && sel2.offsetParent === null) continue;
          var content2 = (sel2.innerText || sel2.textContent || '').trim();
          var ariaLabel2 = sel2.getAttribute('aria-label') || sel2.getAttribute('title') || '';
          if (matchText(content2, ariaLabel2, o)) return { el: sel2, via: 'semantic-fallback' };
        }
      }
      return null;
    }

    // 来源: webviewScripts.ts:765-781 findMenuOpener
    function findMenuOpener() {
      var openerRegex = /\\+|plus|more|tools?|menu|菜单|更多|工具|附加|添加/i;
      var all = document.querySelectorAll('[aria-haspopup="menu"], [aria-haspopup="true"], button, [role="button"]');
      var candidates = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) continue;
        var aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        var txt = (el.innerText || el.textContent || '').trim();
        var hasMenu = /^(menu|true)$/i.test(el.getAttribute('aria-haspopup') || '');
        var score = (hasMenu ? 2 : 0) + (openerRegex.test(aria) ? 2 : 0) + (openerRegex.test(txt) ? 1 : 0);
        if (score > 0) candidates.push({ el: el, score: score, top: el.getBoundingClientRect().top });
      }
      if (!candidates.length) return null;
      candidates.sort(function(a, b) { return b.score - a.score || (b.top - a.top); });
      return { el: candidates[0].el, via: 'menu-opener-fallback' };
    }

    var reports = steps.map(function (step, idx) {
      var err = null;
      var found = null;
      try {
        found = findElementForStep(step);
        if (!found && step.menuOpenerFallback) {
          found = findMenuOpener();
        }
      } catch (e) {
        err = String(e && e.message ? e.message : e);
      }
      var r = {
        index: idx,
        selector: Array.isArray(step.selector) ? step.selector[0] : String(step.selector),
        found: !!found,
        matchedVia: found ? found.via : null,
        firstHit: found ? describeFirst(found.el) : null
      };
      if (err) r.error = err;
      return r;
    });

    return JSON.stringify({ ok: true, steps: reports });
  })();`
}

/**
 * 解析 executeJavaScript 返回的 researchMode 探针结果。
 * 异常兜底返回 { ok: false, steps: [], error }。
 */
export function parseResearchProbeResult(raw: unknown): ResearchProbeReport {
  if (typeof raw !== 'string') {
    return { ok: false, steps: [], error: '探针返回非字符串' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.steps)) {
      return { ok: false, steps: [], error: '探针返回结构异常' }
    }
    return { ok: !!parsed.ok, steps: parsed.steps as StepReport[] }
  } catch (e) {
    return { ok: false, steps: [], error: `结果解析失败: ${String(e)}` }
  }
}

// ─────────────────────────────────────────────────────────────
// DOM 结构探测（dev-only 检拾模式）
// ─────────────────────────────────────────────────────────────

/** 序列化节点指纹：白名单属性 + 正文仅长度（脱敏，不含正文内容） */
export interface NodeFingerprint {
  tag: string
  className: string | null
  id: string | null
  dataTestid: string | null
  /** 白名单属性：role/aria-label/aria-haspopup/name/type/href，其余丢弃 */
  attrs: Record<string, string | null>
  childCount: number
  /** 元素可见正文长度（脱敏：仅长度，不含正文内容） */
  visibleTextLen: number
  isVisible: boolean
}

/** 子树节点：指纹 + 递归 children（截断到 childDepth 层） */
export interface TreeNode extends NodeFingerprint {
  children: TreeNode[]
}

export interface DomProbeOptions {
  /** 祖先链深度，默认 8 */
  ancestorDepth?: number
  /** 子树深度，默认 3 */
  childDepth?: number
}

export interface DomProbeReport {
  ok: boolean
  /** 命中元素的选择器（picker 模式下为构造的候选选择器） */
  selector?: string
  target?: NodeFingerprint
  /** 从根方向 → 目标，最远祖先在前 */
  ancestors?: NodeFingerprint[]
  subtree?: TreeNode
  error?: string
  /** 用户按 Esc 取消 */
  cancelled?: boolean
}

const DOM_ATTR_WHITELIST = ['role', 'aria-label', 'aria-haspopup', 'name', 'type', 'href']
const DEFAULT_ANCESTOR_DEPTH = 8
const DEFAULT_CHILD_DEPTH = 3

/**
 * 构建在平台页内执行的 DOM 结构序列化脚本（选择器驱动，dev-only）。
 * querySelector(selector) 取首个命中，向上取 ancestorDepth 层祖先，向下取 childDepth 层子树。
 * @param opts.selector CSS 选择器（可逗号分隔多候选，取首个命中）
 * @param opts.ancestorDepth 祖先深度，默认 8
 * @param opts.childDepth 子树深度，默认 3
 */
export function buildDomProbeScript(opts: { selector: string; ancestorDepth?: number; childDepth?: number }): string {
  const selector = opts.selector
  const ancestorDepth = opts.ancestorDepth ?? DEFAULT_ANCESTOR_DEPTH
  const childDepth = opts.childDepth ?? DEFAULT_CHILD_DEPTH
  return `(function () {
    var selector = ${JSON.stringify(selector)};
    var ancestorDepth = ${ancestorDepth};
    var childDepth = ${childDepth};
    var ATTR_WHITELIST = ${JSON.stringify(DOM_ATTR_WHITELIST)};

    function isVisible(element) {
      try {
        if (!element || !element.isConnected) return false;
        if (!element.getClientRects || element.getClientRects().length === 0) return false;
        var rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        var cur = element;
        while (cur && cur.nodeType === 1) {
          var style = window.getComputedStyle(cur);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          var opacity = Number(style.opacity || '1');
          if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
          cur = cur.parentElement;
        }
        return true;
      } catch (e) { return false; }
    }

    function fingerprint(el) {
      if (!el || el.nodeType !== 1) return null;
      var text = '';
      try { text = (el.innerText || el.textContent || '') + ''; } catch (e) { text = ''; }
      var attrs = {};
      for (var i = 0; i < ATTR_WHITELIST.length; i++) {
        var k = ATTR_WHITELIST[i];
        try { attrs[k] = el.getAttribute(k); } catch (e) { attrs[k] = null; }
      }
      var childCount = 0;
      try { childCount = el.children ? el.children.length : 0; } catch (e) { childCount = 0; }
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        attrs: attrs,
        childCount: childCount,
        visibleTextLen: text.replace(/\\u200B/g, '').trim().length,
        isVisible: isVisible(el)
      };
    }

    function buildSubtree(el, depth) {
      var fp = fingerprint(el);
      if (!fp) return null;
      var node = { tag: fp.tag, className: fp.className, id: fp.id, dataTestid: fp.dataTestid, attrs: fp.attrs, childCount: fp.childCount, visibleTextLen: fp.visibleTextLen, isVisible: fp.isVisible, children: [] };
      if (depth <= 0) return node;
      var children = el.children || [];
      for (var i = 0; i < children.length; i++) {
        var sub = buildSubtree(children[i], depth - 1);
        if (sub) node.children.push(sub);
      }
      return node;
    }

    function suggestSelector(el) {
      if (!el) return null;
      var tag = (el.tagName || '').toLowerCase();
      var testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid=' + JSON.stringify(testid) + ']';
      var id = el.getAttribute('id');
      if (id) return tag + '#' + id;
      var cn = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
      if (cn) return tag + '.' + cn;
      return tag;
    }

    var target = null;
    try { target = document.querySelector(selector); } catch (e) { return JSON.stringify({ ok: false, error: '选择器语法错误: ' + String(e && e.message ? e.message : e) }); }
    if (!target) return JSON.stringify({ ok: false, error: '选择器未命中任何元素' });

    var ancestors = [];
    var cur = target.parentElement;
    for (var i = 0; i < ancestorDepth && cur; i++) {
      var fp = fingerprint(cur);
      if (fp) ancestors.unshift(fp);
      cur = cur.parentElement;
    }

    return JSON.stringify({
      ok: true,
      selector: suggestSelector(target),
      target: fingerprint(target),
      ancestors: ancestors,
      subtree: buildSubtree(target, childDepth)
    });
  })();`
}

/**
 * 解析 executeJavaScript 返回的 DOM 探测结果。
 */
export function parseDomProbeResult(raw: unknown): DomProbeReport {
  if (typeof raw !== 'string') {
    return { ok: false, error: '探针返回非字符串' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '探针返回结构异常' }
    }
    return parsed as DomProbeReport
  } catch (e) {
    return { ok: false, error: `结果解析失败: ${String(e)}` }
  }
}

/**
 * 构建在平台页内执行的检拾（picker）脚本字符串（dev-only）。
 * 注入全屏透明覆盖层 + 高亮框 + 浮标；mousemove 用 elementFromPoint 高亮，click 选中后序列化并回传，Esc 取消。
 * 单次 executeJavaScript 往返：注入即挂起监听，点选/取消/超时后 resolve。
 * @param opts.ancestorDepth 祖先深度，默认 8
 * @param opts.childDepth 子树深度，默认 3
 */
export function buildPickerScript(opts: DomProbeOptions = {}): string {
  const ancestorDepth = opts.ancestorDepth ?? DEFAULT_ANCESTOR_DEPTH
  const childDepth = opts.childDepth ?? DEFAULT_CHILD_DEPTH
  return `(function () {
    var ancestorDepth = ${ancestorDepth};
    var childDepth = ${childDepth};
    var ATTR_WHITELIST = ${JSON.stringify(DOM_ATTR_WHITELIST)};
    var PICKER_TIMEOUT_MS = 120000;

    // 防重入：先清理旧注入物
    function cleanup() {
      var ids = ['mc-picker-overlay', 'mc-picker-highlight', 'mc-picker-tip'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
    }
    cleanup();

    var currentEl = null;

    function isVisible(element) {
      try {
        if (!element || !element.isConnected) return false;
        if (!element.getClientRects || element.getClientRects().length === 0) return false;
        var rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        var cur = element;
        while (cur && cur.nodeType === 1) {
          var style = window.getComputedStyle(cur);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          var opacity = Number(style.opacity || '1');
          if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
          cur = cur.parentElement;
        }
        return true;
      } catch (e) { return false; }
    }

    function fingerprint(el) {
      if (!el || el.nodeType !== 1) return null;
      var text = '';
      try { text = (el.innerText || el.textContent || '') + ''; } catch (e) { text = ''; }
      var attrs = {};
      for (var i = 0; i < ATTR_WHITELIST.length; i++) {
        var k = ATTR_WHITELIST[i];
        try { attrs[k] = el.getAttribute(k); } catch (e) { attrs[k] = null; }
      }
      var childCount = 0;
      try { childCount = el.children ? el.children.length : 0; } catch (e) { childCount = 0; }
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        attrs: attrs,
        childCount: childCount,
        visibleTextLen: text.replace(/\\u200B/g, '').trim().length,
        isVisible: isVisible(el)
      };
    }

    function buildSubtree(el, depth) {
      var fp = fingerprint(el);
      if (!fp) return null;
      var node = { tag: fp.tag, className: fp.className, id: fp.id, dataTestid: fp.dataTestid, attrs: fp.attrs, childCount: fp.childCount, visibleTextLen: fp.visibleTextLen, isVisible: fp.isVisible, children: [] };
      if (depth <= 0) return node;
      var children = el.children || [];
      for (var i = 0; i < children.length; i++) {
        var sub = buildSubtree(children[i], depth - 1);
        if (sub) node.children.push(sub);
      }
      return node;
    }

    function suggestSelector(el) {
      if (!el) return null;
      var tag = (el.tagName || '').toLowerCase();
      var testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid=' + JSON.stringify(testid) + ']';
      var id = el.getAttribute('id');
      if (id) return tag + '#' + id;
      var cn = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
      if (cn) return tag + '.' + cn;
      return tag;
    }

    function describeTip(el) {
      if (!el) return '';
      var tag = (el.tagName || '').toLowerCase();
      var testid = el.getAttribute('data-testid');
      var id = el.getAttribute('id');
      var cn = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      var parts = [tag];
      if (id) parts.push('#' + id);
      if (cn) parts.push('.' + cn);
      if (testid) parts.push('[data-testid=' + testid + ']');
      return parts.join('');
    }

    var overlay = document.createElement('div');
    overlay.id = 'mc-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;';

    var highlight = document.createElement('div');
    highlight.id = 'mc-picker-highlight';
    highlight.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,0.12);display:none;';

    var tip = document.createElement('div');
    tip.id = 'mc-picker-tip';
    tip.style.cssText = 'position:fixed;z-index:2147483648;pointer-events:none;background:#1e293b;color:#fff;font:12px/1.4 monospace;padding:2px 6px;border-radius:3px;display:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    document.body.appendChild(overlay);
    document.body.appendChild(highlight);
    document.body.appendChild(tip);

    function updateHighlight(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      // 跳过注入物自身
      if (el && (el.id === 'mc-picker-overlay' || el.id === 'mc-picker-highlight' || el.id === 'mc-picker-tip')) {
        el = null;
      }
      currentEl = el;
      if (!el) {
        highlight.style.display = 'none';
        tip.style.display = 'none';
        return;
      }
      var rect = el.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';
      tip.style.display = 'block';
      tip.textContent = describeTip(el);
      var tipLeft = e.clientX + 12;
      var tipTop = e.clientY + 12;
      if (tipLeft + 200 > window.innerWidth) tipLeft = e.clientX - 200;
      tip.style.left = tipLeft + 'px';
      tip.style.top = tipTop + 'px';
    }

    function onMove(e) { updateHighlight(e); }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var el = currentEl;
      cleanup();
      document.removeEventListener('keydown', onKey, true);
      if (!el) {
        window.__mcPickerResolve({ ok: false, error: '未选中任何元素' });
        return;
      }
      var ancestors = [];
      var cur = el.parentElement;
      for (var i = 0; i < ancestorDepth && cur; i++) {
        var fp = fingerprint(cur);
        if (fp) ancestors.unshift(fp);
        cur = cur.parentElement;
      }
      window.__mcPickerResolve({
        ok: true,
        selector: suggestSelector(el),
        target: fingerprint(el),
        ancestors: ancestors,
        subtree: buildSubtree(el, childDepth)
      });
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        overlay.removeEventListener('mousemove', onMove);
        overlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        window.__mcPickerResolve({ ok: false, cancelled: true });
      }
    }

    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);

    // 超时自清
    setTimeout(function () {
      var ol = document.getElementById('mc-picker-overlay');
      if (!ol) return; // 已通过 click/Esc 清理
      cleanup();
      document.removeEventListener('keydown', onKey, true);
      window.__mcPickerResolve({ ok: false, error: '检拾超时' });
    }, PICKER_TIMEOUT_MS);

    return new Promise(function (resolve) {
      window.__mcPickerResolve = resolve;
    });
  })();`
}
