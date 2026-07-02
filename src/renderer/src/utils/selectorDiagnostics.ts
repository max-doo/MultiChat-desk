/**
 * messageContainer 选择器诊断工具（dev-only）
 * 探针逻辑同源拷贝自 src/shared/utils/webviewScripts.ts:1509-1572，
 * 保证"探针命中 = 生产命中"。修改 webviewScripts.ts 的匹配逻辑时必须同步本文件。
 */

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
