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
