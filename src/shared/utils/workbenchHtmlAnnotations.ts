import {
  WORKBENCH_HTML_ANNOTATION_MESSAGE_SOURCE
} from '../types/htmlAnnotations'
import { injectWorkbenchHtmlRuntimeAssets } from './workbenchHtmlEditor'

export const WORKBENCH_HTML_ANNOTATION_STYLE_ID = '__mha_style'
export const WORKBENCH_HTML_ANNOTATION_SCRIPT_ID = '__mha_runtime'

export const WORKBENCH_HTML_ANNOTATION_STYLE = `
::highlight(multichat-html-annotations) {
  background-color: rgba(251, 191, 36, 0.42);
  color: inherit;
  text-decoration: underline dashed rgba(217, 119, 6, 0.6);
}
::highlight(multichat-html-annotation-focus) {
  background-color: rgba(251, 191, 36, 0.72);
  color: inherit;
  text-decoration: underline solid rgba(217, 119, 6, 0.9);
}
`

const MAX_ANNOTATION_TEXT = 20_000

/**
 * HTML 渲染预览内的标注运行时。
 *
 * 运行时只负责可见文本索引、锚点定位、CSS Highlight、点击命中和选区采集；
 * 评论正文、持久化和编辑 UI 全部留在宿主 renderer。
 */
export const WORKBENCH_HTML_ANNOTATION_RUNTIME = String.raw`
(function () {
  'use strict';

  var MESSAGE_SOURCE = ${JSON.stringify(WORKBENCH_HTML_ANNOTATION_MESSAGE_SOURCE)};
  var HIGHLIGHT_NAME = 'multichat-html-annotations';
  var FOCUS_NAME = 'multichat-html-annotation-focus';
  var SKIP_SELECTOR =
    'script,style,noscript,template,textarea,input,select,option,button,' +
    '[contenteditable="true"],[hidden],[aria-hidden="true"]';
  var MAX_TEXT = ${MAX_ANNOTATION_TEXT};
  var COMPACT_RE = /[\s\u200b-\u200d\ufeff]/g;
  var COMPACT_TEST_RE = /[\s\u200b-\u200d\ufeff]/;
  var SUPPORTED = !!(window.CSS && CSS.highlights && window.Highlight);

  var annotations = [];
  var targets = [];
  var activeId = '';
  var lastRange = null;
  var observer = null;
  var resolveTimer = null;
  var lastDismissAt = 0;

  function post(type, payload) {
    try {
      parent.postMessage(
        Object.assign({ source: MESSAGE_SOURCE, type: type }, payload || {}),
        '*'
      );
    } catch (err) {
      /* parent may already be gone */
    }
  }

  function emitDismiss(force) {
    var now = Date.now();
    if (!force && now - lastDismissAt < 120) return;
    lastDismissAt = now;
    post('dismiss');
  }

  function compactText(value) {
    return String(value || '').replace(COMPACT_RE, '');
  }

  function compactWithOffsets(value) {
    var offsets = [];
    var compact = '';
    for (var i = 0; i < value.length; i += 1) {
      if (COMPACT_TEST_RE.test(value[i])) continue;
      offsets.push(i);
      compact += value[i];
    }
    return { compact: compact, offsets: offsets };
  }

  function occurrencesOf(text, exact) {
    var positions = [];
    if (!exact) return positions;
    var from = 0;
    while (from <= text.length) {
      var index = text.indexOf(exact, from);
      if (index < 0) break;
      positions.push(index);
      from = index + Math.max(1, exact.length);
    }
    return positions;
  }

  function isVisibleTextNode(node, cache) {
    var parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest(SKIP_SELECTOR) || parent.closest('svg')) return false;
    if (cache.has(parent)) return cache.get(parent);
    var visible = false;
    try {
      var style = window.getComputedStyle(parent);
      visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse';
    } catch (err) {
      visible = false;
    }
    cache.set(parent, visible);
    return visible;
  }

  function buildTextIndex() {
    var root = document.body || document.documentElement;
    if (!root) return { text: '', nodes: [], byNode: new WeakMap() };
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var byNode = new WeakMap();
    var cache = new WeakMap();
    var text = '';
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var value = node.nodeValue || '';
      if (!value || !isVisibleTextNode(node, cache)) continue;
      var start = text.length;
      var item = { node: node, start: start, end: start + value.length };
      nodes.push(item);
      byNode.set(node, item);
      text += value;
    }
    return { text: text, nodes: nodes, byNode: byNode };
  }

  function contextScore(text, start, end, anchor) {
    var score = 0;
    var prefix = compactText(anchor.prefix);
    if (prefix) {
      var before = text.slice(Math.max(0, start - prefix.length), start);
      if (before === prefix) score += prefix.length >= 8 ? 6 : 3;
      else if (before.indexOf(prefix) >= 0) score += 1;
    }
    var suffix = compactText(anchor.suffix);
    if (suffix) {
      var after = text.slice(end, end + suffix.length);
      if (after === suffix) score += suffix.length >= 8 ? 6 : 3;
      else if (after.indexOf(suffix) >= 0) score += 1;
    }
    return score;
  }

  function rangeFromOffsets(index, start, end) {
    var startPart = null;
    var endPart = null;
    for (var i = 0; i < index.nodes.length; i += 1) {
      var part = index.nodes[i];
      if (!startPart && start >= part.start && start < part.end) startPart = part;
      if (end > part.start && end <= part.end) {
        endPart = part;
        break;
      }
    }
    if (!startPart || !endPart) return null;
    try {
      var range = document.createRange();
      range.setStart(startPart.node, start - startPart.start);
      range.setEnd(endPart.node, end - endPart.start);
      return range;
    } catch (err) {
      return null;
    }
  }

  function resolveTargets(index) {
    var compactInfo = compactWithOffsets(index.text);
    var nextTargets = [];
    var unlocated = [];

    for (var i = 0; i < annotations.length; i += 1) {
      var annotation = annotations[i];
      var anchor = annotation && annotation.anchor;
      var exact = compactText(anchor && anchor.exact);
      if (!exact) {
        unlocated.push(annotation && annotation.id);
        continue;
      }

      var positions = occurrencesOf(compactInfo.compact, exact);
      if (!positions.length) {
        unlocated.push(annotation.id);
        continue;
      }

      var best = -1;
      var bestScore = -Infinity;
      for (var p = 0; p < positions.length; p += 1) {
        var candidate = positions[p];
        var score = contextScore(
          compactInfo.compact,
          candidate,
          candidate + exact.length,
          anchor
        );
        if (typeof anchor.occurrence === 'number') {
          score +=
            p === anchor.occurrence
              ? 4
              : -Math.min(2, Math.abs(p - anchor.occurrence));
        }
        if (typeof anchor.offsetHint === 'number') {
          score -= Math.min(
            6,
            Math.abs(compactInfo.offsets[candidate] - anchor.offsetHint) / 2000
          );
        }
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      if (best < 0) {
        unlocated.push(annotation.id);
        continue;
      }

      var start = compactInfo.offsets[best];
      var end = compactInfo.offsets[best + exact.length - 1] + 1;
      var range = rangeFromOffsets(index, start, end);
      if (!range) {
        unlocated.push(annotation.id);
        continue;
      }
      nextTargets.push({ id: annotation.id, range: range });
    }

    return { targets: nextTargets, unlocated: unlocated };
  }

  function clearHighlights() {
    if (!SUPPORTED) return;
    try {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      CSS.highlights.delete(FOCUS_NAME);
    } catch (err) {
      /* noop */
    }
  }

  function renderHighlights() {
    if (!SUPPORTED) {
      post('resolved', {
        unlocated: annotations.map(function (item) {
          return item && item.id;
        })
      });
      return;
    }

    var index = buildTextIndex();
    var resolved = resolveTargets(index);
    targets = resolved.targets;
    clearHighlights();

    if (targets.length) {
      var ranges = targets.map(function (item) {
        return item.range;
      });
      try {
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
      } catch (err) {
        targets = [];
      }
    }

    var focusTarget =
      activeId &&
      targets.find(function (item) {
        return item.id === activeId;
      });
    if (focusTarget) {
      try {
        CSS.highlights.set(FOCUS_NAME, new Highlight(focusTarget.range));
      } catch (err) {
        /* noop */
      }
    } else if (activeId) {
      activeId = '';
      post('dismiss');
    }

    post('resolved', {
      matched: targets.length,
      unlocated: resolved.unlocated
    });
  }

  function scheduleResolve() {
    if (resolveTimer) clearTimeout(resolveTimer);
    resolveTimer = setTimeout(function () {
      resolveTimer = null;
      renderHighlights();
    }, 220);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (
          mutations[i].type === 'childList' ||
          mutations[i].type === 'characterData'
        ) {
          scheduleResolve();
          return;
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function rectOfRange(range) {
    var rect = null;
    try {
      rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        var rects = range.getClientRects();
        if (rects.length) rect = rects[0];
      }
    } catch (err) {
      return null;
    }
    if (!rect) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  function textOffsetAt(container, offset, isEnd, index) {
    if (!container) return null;
    if (container.nodeType === 3) {
      var direct = index.byNode.get(container);
      if (!direct) return null;
      return direct.start + Math.max(0, Math.min(offset, direct.end - direct.start));
    }
    if (container.nodeType !== 1) return null;

    var child = isEnd ? container.childNodes[offset - 1] : container.childNodes[offset];
    if (!child) return null;
    if (child.nodeType === 3) {
      var childPart = index.byNode.get(child);
      if (!childPart) return null;
      return isEnd ? childPart.end : childPart.start;
    }
    if (child.nodeType !== 1) return null;

    var walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
    var found = null;
    while (walker.nextNode()) {
      var part = index.byNode.get(walker.currentNode);
      if (!part) continue;
      found = part;
      if (!isEnd) break;
    }
    if (!found) return null;
    return isEnd ? found.end : found.start;
  }

  function buildAnchor(index, start, end) {
    var quote = index.text.slice(start, end);
    var compactExact = compactText(quote);
    if (!compactExact || quote.length > MAX_TEXT) return null;
    var before = compactText(index.text.slice(0, start));
    return {
      exact: quote,
      prefix: index.text.slice(Math.max(0, start - 64), start),
      suffix: index.text.slice(end, Math.min(index.text.length, end + 64)),
      occurrence: occurrencesOf(before, compactExact).length,
      offsetHint: start
    };
  }

  function rememberSelection() {
    try {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      lastRange = selection.getRangeAt(0).cloneRange();
    } catch (err) {
      /* noop */
    }
  }

  function captureSelection(requestId) {
    var range = null;
    try {
      var selection = window.getSelection();
      if (selection && selection.rangeCount && !selection.isCollapsed) {
        range = selection.getRangeAt(0).cloneRange();
      } else if (lastRange) {
        range = lastRange.cloneRange();
      }
    } catch (err) {
      range = null;
    }
    if (!range) {
      post('capture-error', { id: requestId, error: 'no-selection' });
      return;
    }

    var index = buildTextIndex();
    var start = textOffsetAt(
      range.startContainer,
      range.startOffset,
      false,
      index
    );
    var end = textOffsetAt(range.endContainer, range.endOffset, true, index);
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      start < 0 ||
      end <= start ||
      end > index.text.length
    ) {
      post('capture-error', { id: requestId, error: 'invalid-selection' });
      return;
    }

    var quote = index.text.slice(start, end);
    if (!quote.trim()) {
      post('capture-error', { id: requestId, error: 'empty-selection' });
      return;
    }
    if (quote.length > MAX_TEXT) {
      post('capture-error', { id: requestId, error: 'too-large' });
      return;
    }

    var anchor = buildAnchor(index, start, end);
    var rect = rectOfRange(range);
    if (!anchor || !rect) {
      post('capture-error', { id: requestId, error: 'invalid-selection' });
      return;
    }

    post('capture-result', {
      id: requestId,
      quote: quote,
      anchor: anchor,
      rect: rect
    });
  }

  function hitTest(x, y) {
    for (var i = 0; i < targets.length; i += 1) {
      var target = targets[i];
      try {
        if (
          !target.range.startContainer.isConnected ||
          !target.range.endContainer.isConnected
        ) {
          scheduleResolve();
          continue;
        }
        var rects = target.range.getClientRects();
        for (var j = 0; j < rects.length; j += 1) {
          var rect = rects[j];
          if (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          ) {
            return {
              target: target,
              rect: {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
              }
            };
          }
        }
      } catch (err) {
        /* range may be detached after a page rerender */
      }
    }
    return null;
  }

  function onClick(event) {
    try {
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        return;
      }
    } catch (err) {
      /* noop */
    }

    var hit = hitTest(event.clientX, event.clientY);
    if (!hit) {
      if (activeId) {
        activeId = '';
        renderHighlights();
      }
      emitDismiss(true);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    activeId = hit.target.id;
    renderHighlights();
    post('hit', {
      id: hit.target.id,
      rect: hit.rect
    });
  }

  function onScroll() {
    if (activeId) {
      activeId = '';
      renderHighlights();
      emitDismiss(true);
      return;
    }
    emitDismiss(false);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !activeId) return;
    event.preventDefault();
    activeId = '';
    renderHighlights();
    emitDismiss(true);
  }

  function onMessage(event) {
    var data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE) return;
    if (event.source && event.source !== parent) return;

    if (data.type === 'ping') {
      post('ready');
      return;
    }
    if (data.type === 'sync') {
      annotations = Array.isArray(data.annotations)
        ? data.annotations.filter(function (item) {
            return item && typeof item.id === 'string' && item.anchor;
          })
        : [];
      if (
        activeId &&
        !annotations.some(function (item) {
          return item.id === activeId;
        })
      ) {
        activeId = '';
      }
      renderHighlights();
      return;
    }
    if (data.type === 'capture') {
      captureSelection(data.id);
      return;
    }
    if (data.type === 'focus') {
      activeId = typeof data.id === 'string' ? data.id : '';
      renderHighlights();
    }
  }

  document.addEventListener('selectionchange', rememberSelection);
  document.addEventListener('mouseup', rememberSelection, true);
  document.addEventListener('keyup', rememberSelection, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('message', onMessage);
  window.addEventListener('resize', scheduleResolve);

  if (document.readyState === 'complete') {
    startObserver();
  } else {
    window.addEventListener('load', startObserver, { once: true });
  }

  post('ready');
})();
`

export function buildWorkbenchHtmlAnnotationDocument(
  html: string,
  runtimeUrl: string,
  styleUrl: string
): string {
  const escapedRuntime = runtimeUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const escapedStyle = styleUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const styleTag = `<link rel="stylesheet" id="${WORKBENCH_HTML_ANNOTATION_STYLE_ID}" href="${escapedStyle}">`
  const runtimeTag = `<script id="${WORKBENCH_HTML_ANNOTATION_SCRIPT_ID}" src="${escapedRuntime}"></script>`
  return injectWorkbenchHtmlRuntimeAssets(html, styleTag, runtimeTag)
}
