/**
 * 工作台 HTML 可视化编辑：注入到预览文档内的编辑运行时。
 *
 * 预览 iframe 保持 `sandbox="allow-scripts"`，不放开同源。编辑脚本作为
 * workbench-file:// 同源资源注入，DOM 操作只在 iframe 内完成，父窗口通过
 * postMessage 收发选中框、命令和序列化结果。
 */

export const WORKBENCH_HTML_EDIT_QUERY = 'workbench-edit'
export const WORKBENCH_HTML_EDIT_RUNTIME_QUERY = 'workbench-edit-runtime'
export const WORKBENCH_HTML_EDIT_STYLE_QUERY = 'workbench-edit-style'

export const WORKBENCH_HTML_EDIT_MESSAGE_SOURCE = 'multichat-workbench-html-edit'
export const WORKBENCH_HTML_EDIT_STYLE_ID = '__mve_style'
export const WORKBENCH_HTML_EDIT_SCRIPT_ID = '__mve_runtime'

export const WORKBENCH_HTML_EDIT_STYLE = `
.__mve_hover{outline:1.5px dashed #3b82f6 !important;outline-offset:1px}
.__mve_sel{outline:2px solid #3b82f6 !important;outline-offset:1px}
.__mve_dragging{opacity:.4 !important}
.__mve_dropbefore{box-shadow:0 -3px 0 0 #3b82f6,inset 0 3px 0 0 #3b82f6 !important}
.__mve_dropafter{box-shadow:0 3px 0 0 #3b82f6,inset 0 -3px 0 0 #3b82f6 !important}
.__mve_dropbefore.__mve_horiz{box-shadow:-3px 0 0 0 #3b82f6,inset 3px 0 0 0 #3b82f6 !important}
.__mve_dropafter.__mve_horiz{box-shadow:3px 0 0 0 #3b82f6,inset -3px 0 0 0 #3b82f6 !important}
`

export const WORKBENCH_HTML_EDIT_RUNTIME = String.raw`
(function () {
  'use strict';

  var HOVER = '__mve_hover';
  var SEL = '__mve_sel';
  var DRAGGING = '__mve_dragging';
  var DROPBEFORE = '__mve_dropbefore';
  var DROPAFTER = '__mve_dropafter';
  var HORIZ = '__mve_horiz';
  var STYLE_ID = '__mve_style';
  var SCRIPT_ID = '__mve_runtime';
  var MESSAGE_SOURCE = 'multichat-workbench-html-edit';

  var selectedEl = null;
  var hoverEl = null;
  var dragSrc = null;
  var dropHintEl = null;
  var observer = null;
  var dirty = false;
  var reportedDirty = false;
  var scrollFrame = 0;
  var observerStarted = false;

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

  function isElement(node) {
    return !!node && node.nodeType === 1;
  }

  function notifyDirty() {
    if (!dirty) dirty = true;
    if (dirty && !reportedDirty) {
      reportedDirty = true;
      post('dirty');
    }
  }

  function resetDirty() {
    dirty = false;
    reportedDirty = false;
  }

  function siblingsOf(el) {
    if (!el || !el.parentElement) return [];
    return Array.prototype.slice.call(el.parentElement.children);
  }

  function isFlowHorizontal(parent) {
    if (!parent) return false;
    var cs = getComputedStyle(parent);
    if (cs.display === 'flex' || cs.display === 'inline-flex') {
      return cs.flexDirection.indexOf('row') === 0;
    }
    if (cs.display === 'grid' || cs.display === 'inline-grid') return true;
    return false;
  }

  function isInteractive(el) {
    if (!isElement(el)) return false;
    if (el.closest('form')) return true;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'FORM' || tag === 'OPTION') {
      return true;
    }
    // 链接和按钮无论是否带可探测钩子，都属于页面行为入口；只开放文字与样式。
    if (tag === 'A' || tag === 'BUTTON') return true;
    if (el.hasAttribute('contenteditable') || el.getAttribute('role') === 'button') return true;
    if (el.hasAttribute('onclick')) return true;
    var hooks = ['data-action', 'data-toggle', 'data-tip', 'data-href', 'data-click', 'data-role'];
    for (var i = 0; i < hooks.length; i += 1) {
      if (el.hasAttribute(hooks[i])) return true;
    }
    return false;
  }

  function hasInteractiveAncestor(el) {
    var node = el;
    while (isElement(node) && node !== document.body && node !== document.documentElement) {
      if (isInteractive(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * 只允许“同标签兄弟 >= 2 且不含行为钩子”的元素做结构编辑。
   * 孤立标题、纯展示按钮因此只会出现文字/样式操作。
   */
  function canReorder(el) {
    if (!isElement(el) || el === document.body || el === document.documentElement) return false;
    if (hasInteractiveAncestor(el)) return false;
    var siblings = siblingsOf(el);
    if (siblings.length < 2) return false;
    var sameTag = 0;
    for (var i = 0; i < siblings.length; i += 1) {
      if (siblings[i].tagName === el.tagName) sameTag += 1;
    }
    return sameTag >= 2;
  }

  function buildCrumb(el) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (isElement(node) && node !== document.documentElement && guard < 6) {
      var text = node.tagName.toLowerCase();
      if (node.id) {
        text += '#' + node.id;
      } else if (typeof node.className === 'string' && node.className) {
        var classes = node.className.split(/\s+/);
        for (var i = 0; i < classes.length; i += 1) {
          if (classes[i] && classes[i].indexOf('__mve_') !== 0) {
            text += '.' + classes[i];
            break;
          }
        }
      }
      parts.unshift(text);
      node = node.parentElement;
      guard += 1;
    }
    return parts.join(' › ');
  }

  function rectOf(el) {
    var rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom
    };
  }

  function styleSource(el) {
    try {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.anchorNode) {
        return el;
      }
      var node = selection.anchorNode;
      if (node.nodeType === 3) node = node.parentNode;
      return isElement(node) && el.contains(node) ? node : el;
    } catch (err) {
      return el;
    }
  }

  function currentColors() {
    if (!selectedEl) return { textColor: '', backgroundColor: '' };
    var source = styleSource(selectedEl);
    var styles = getComputedStyle(source);
    return {
      textColor: styles.color,
      backgroundColor: styles.backgroundColor
    };
  }

  function postSelection() {
    if (!selectedEl) return;
    if (!document.documentElement.contains(selectedEl)) {
      deselect();
      return;
    }
    var structural = canReorder(selectedEl);
    var colors = currentColors();
    post('selection', {
      rect: rectOf(selectedEl),
      crumb: buildCrumb(selectedEl),
      textColor: colors.textColor,
      backgroundColor: colors.backgroundColor,
      canReorder: structural,
      canAdd: structural,
      canDuplicate: structural,
      canDelete: structural,
      interactive: hasInteractiveAncestor(selectedEl)
    });
  }

  function select(el) {
    if (!isElement(el) || el === document.documentElement) return;
    if (selectedEl && selectedEl !== el) selectedEl.classList.remove(SEL);
    selectedEl = el;
    el.classList.remove(HOVER);
    el.classList.add(SEL);
    postSelection();
  }

  function deselect() {
    var hadDrag = !!dragSrc;
    if (dragSrc) {
      dragSrc.classList.remove(DRAGGING);
      dragSrc = null;
    }
    if (selectedEl) selectedEl.classList.remove(SEL);
    selectedEl = null;
    clearDropHints();
    post('selection-cleared');
    if (hadDrag) post('drag-ended');
  }

  function scheduleSelectionRect() {
    if (!selectedEl || scrollFrame) return;
    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = 0;
      postSelection();
    });
  }

  function onOver(e) {
    var target = e.target;
    if (!isElement(target)) return;
    if (hoverEl && hoverEl !== target) hoverEl.classList.remove(HOVER);
    if (target !== selectedEl && target !== document.documentElement) {
      target.classList.add(HOVER);
      hoverEl = target;
    }
    /* 冻结页面 JS 的 hover 弹层/下拉，CSS :hover 不受影响 */
    e.stopPropagation();
  }

  function onOut(e) {
    var target = e.target;
    if (isElement(target)) target.classList.remove(HOVER);
    if (hoverEl === target) hoverEl = null;
    e.stopPropagation();
  }

  function onClick(e) {
    var target = e.target;
    if (!isElement(target) || target === document.documentElement) return;
    e.preventDefault();
    e.stopPropagation();
    select(target);
  }

  function preventSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      deselect();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      post('save-request');
    }
  }

  function hasTextSelection(el) {
    var selection = null;
    try {
      selection = window.getSelection();
    } catch (err) {
      return false;
    }
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.anchorNode) {
      return false;
    }
    var node = selection.anchorNode;
    if (node.nodeType === 3) node = node.parentNode;
    return !!node && el.contains(node);
  }

  function bumpFont(el, factor) {
    var current = parseFloat(getComputedStyle(el).fontSize) || 16;
    var next = Math.max(8, Math.min(160, current * factor));
    el.style.fontSize = next.toFixed(1) + 'px';
  }

  function removeEditorClasses(root) {
    var nodes = [root];
    if (root.querySelectorAll) {
      nodes = nodes.concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    }
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!isElement(node) || !node.classList) continue;
      node.classList.remove(HOVER, SEL, DRAGGING, DROPBEFORE, DROPAFTER, HORIZ);
      if (!node.getAttribute('class')) node.removeAttribute('class');
    }
  }

  function stripIds(root) {
    if (isElement(root) && root.hasAttribute('id')) root.removeAttribute('id');
    if (!root.querySelectorAll) return;
    var nodes = root.querySelectorAll('[id]');
    for (var i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute('id');
  }

  function resetPlaceholderText(root) {
    var leaves = root.querySelectorAll('*');
    var headings = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
    for (var i = 0; i < leaves.length; i += 1) {
      var node = leaves[i];
      if (!node.children.length && node.textContent && node.textContent.trim()) {
        node.textContent = headings[node.tagName] ? '新标题' : '双击编辑这段文字';
      }
    }
    if (!root.children.length && root.textContent && root.textContent.trim()) {
      root.textContent = '新内容';
    }
  }

  function insertClone(resetText) {
    var el = selectedEl;
    if (!el || !canReorder(el)) return;
    var clone = el.cloneNode(true);
    removeEditorClasses(clone);
    stripIds(clone);
    if (resetText) resetPlaceholderText(clone);
    el.insertAdjacentElement('afterend', clone);
    notifyDirty();
    select(clone);
  }

  function deleteSelected() {
    var el = selectedEl;
    if (!el || !canReorder(el)) return;
    deselect();
    el.remove();
    notifyDirty();
  }

  function runCommand(command, value, preserveFocus) {
    var el = selectedEl;
    if (!el) return;
    if (!preserveFocus) {
      try {
        window.focus();
      } catch (err) {
        /* noop */
      }
    }
    var textSelected = hasTextSelection(el);

    if (command === 'bold') {
      if (textSelected) {
        document.execCommand('bold');
      } else {
        var weight = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
        el.style.fontWeight = weight >= 600 ? '400' : '700';
      }
    } else if (command === 'italic') {
      if (textSelected) {
        document.execCommand('italic');
      } else {
        el.style.fontStyle = getComputedStyle(el).fontStyle === 'italic' ? 'normal' : 'italic';
      }
    } else if (command === 'color') {
      document.execCommand('styleWithCSS', false, true);
      if (textSelected) document.execCommand('foreColor', false, value);
      else el.style.color = value;
    } else if (command === 'backgroundColor') {
      document.execCommand('styleWithCSS', false, true);
      if (textSelected) document.execCommand('hiliteColor', false, value);
      else el.style.backgroundColor = value === 'transparent' ? 'transparent' : value;
    } else if (command === 'fontUp') {
      bumpFont(el, 1.15);
    } else if (command === 'fontDown') {
      bumpFont(el, 1 / 1.15);
    } else if (command === 'add') {
      insertClone(true);
      return;
    } else if (command === 'duplicate') {
      insertClone(false);
      return;
    } else if (command === 'delete') {
      deleteSelected();
      return;
    }

    notifyDirty();
    postSelection();
  }

  function findDropTarget(x, y) {
    if (!dragSrc || !dragSrc.parentElement) return null;
    var horizontal = isFlowHorizontal(dragSrc.parentElement);
    var siblings = siblingsOf(dragSrc);
    var best = null;
    var before = true;
    var bestDistance = Infinity;
    for (var i = 0; i < siblings.length; i += 1) {
      var sibling = siblings[i];
      if (sibling === dragSrc) continue;
      var rect = sibling.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      var mid = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      var position = horizontal ? x : y;
      var distance = Math.abs(position - mid);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sibling;
        before = position < mid;
      }
    }
    return best ? { target: best, before: before, horizontal: horizontal } : null;
  }

  function clearDropHints() {
    if (dropHintEl) {
      dropHintEl.classList.remove(DROPBEFORE, DROPAFTER, HORIZ);
      dropHintEl = null;
    }
  }

  function beginDrag() {
    if (!selectedEl || !canReorder(selectedEl)) return;
    dragSrc = selectedEl;
    dragSrc.classList.add(DRAGGING);
    post('drag-active');
  }

  function dragMove(x, y) {
    if (!dragSrc) return;
    var hit = findDropTarget(x, y);
    if (hit && hit.target === dropHintEl) {
      var wantBefore = !!hit.before;
      var wantHoriz = !!hit.horizontal;
      var hasBefore = dropHintEl.classList.contains(DROPBEFORE);
      var hasAfter = dropHintEl.classList.contains(DROPAFTER);
      var hasHoriz = dropHintEl.classList.contains(HORIZ);
      if ((wantBefore ? hasBefore && !hasAfter : hasAfter && !hasBefore) && wantHoriz === hasHoriz) {
        return;
      }
    }
    clearDropHints();
    if (hit) {
      dropHintEl = hit.target;
      dropHintEl.classList.add(hit.before ? DROPBEFORE : DROPAFTER);
      if (hit.horizontal) dropHintEl.classList.add(HORIZ);
    }
  }

  function endDrag(x, y, cancelled) {
    var source = dragSrc;
    clearDropHints();
    if (!source) {
      post('drag-ended');
      return;
    }
    var hit = cancelled ? null : findDropTarget(x, y);
    dragSrc = null;
    source.classList.remove(DRAGGING);
    if (hit && hit.target !== source) {
      if (hit.before) hit.target.parentNode.insertBefore(source, hit.target);
      else hit.target.insertAdjacentElement('afterend', source);
      notifyDirty();
      select(source);
    }
    post('drag-ended');
  }

  function serialize() {
    var root = document.documentElement.cloneNode(true);
    var style = root.querySelector('#' + STYLE_ID);
    if (style) style.remove();
    var runtime = root.querySelector('#' + SCRIPT_ID);
    if (runtime) runtime.remove();

    var marked = root.querySelectorAll('[class]');
    for (var i = 0; i < marked.length; i += 1) {
      var node = marked[i];
      var kept = [];
      var classes = node.getAttribute('class').split(/\s+/);
      for (var j = 0; j < classes.length; j += 1) {
        if (classes[j] && classes[j].indexOf('__mve_') !== 0) kept.push(classes[j]);
      }
      if (kept.length) node.setAttribute('class', kept.join(' '));
      else node.removeAttribute('class');
    }

    var doctype = '<!DOCTYPE html>';
    var current = document.doctype;
    if (current) {
      doctype = '<!DOCTYPE ' + current.name;
      if (current.publicId) doctype += ' PUBLIC "' + current.publicId + '"';
      if (current.systemId) doctype += ' "' + current.systemId + '"';
      doctype += '>';
    }
    return doctype + '\n' + root.outerHTML;
  }

  function startObserver() {
    if (observerStarted || !document.documentElement) return;
    observerStarted = true;
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        var mutation = mutations[i];
        var target = mutation.target;
        if (isElement(target) && (target.id === STYLE_ID || target.id === SCRIPT_ID)) {
          continue;
        }
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          notifyDirty();
          scheduleSelectionRect();
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

  function afterPageLoad(callback) {
    var started = false;
    function run() {
      if (started) return;
      started = true;
      callback();
    }
    if (document.readyState === 'complete') {
      setTimeout(run, 160);
      return;
    }
    window.addEventListener(
      'load',
      function () {
        setTimeout(run, 160);
      },
      { once: true }
    );
    // 页面常驻未完成资源时 load 可能迟迟不触发；保底启动脏状态追踪。
    setTimeout(run, 800);
  }

  function onMessage(event) {
    var data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE) return;
    if (event.source && event.source !== parent) return;

    if (data.type === 'ping') {
      post('ready');
    } else if (data.type === 'serialize') {
      post('serialized', { id: data.id, html: serialize() });
    } else if (data.type === 'command') {
      runCommand(data.command, data.value, !!data.preserveFocus);
    } else if (data.type === 'saved') {
      resetDirty();
    } else if (data.type === 'drag-start') {
      beginDrag();
    } else if (data.type === 'drag-move') {
      dragMove(data.x, data.y);
    } else if (data.type === 'drag-end') {
      endDrag(data.x, data.y, false);
    } else if (data.type === 'drag-cancel') {
      endDrag(0, 0, true);
    } else if (data.type === 'deselect') {
      deselect();
    }
  }

  try {
    document.designMode = 'on';
  } catch (err) {
    /* noop */
  }
  try {
    document.execCommand('styleWithCSS', false, true);
  } catch (err) {
    /* noop */
  }

  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', preventSubmit, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', scheduleSelectionRect, true);
  window.addEventListener('resize', scheduleSelectionRect, true);
  window.addEventListener('message', onMessage, false);

  afterPageLoad(startObserver);
  post('ready');
})();
`

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function injectBeforeClosingTag(html: string, tag: string, snippet: string): string | null {
  const match = new RegExp(`</${tag}\\s*>`, 'i').exec(html)
  if (!match) return null
  return html.slice(0, match.index) + snippet + html.slice(match.index)
}

function injectAfterOpeningTag(html: string, tag: string, snippet: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html)
  if (!match) return null
  const index = match.index + match[0].length
  return html.slice(0, index) + snippet + html.slice(index)
}

/**
 * 在原始 HTML 中注入编辑样式与运行时。运行时和样式走同源外部资源，
 * 避免页面自带 CSP 只允许 `'self'` 时内联脚本被拦截。
 */
/**
 * 向任意 HTML 文档注入同源样式与运行时资源。
 * 调用方负责使用唯一的资源 URL，避免和页面自身或另一套运行时冲突。
 */
export function injectWorkbenchHtmlRuntimeAssets(
  html: string,
  styleTag: string,
  runtimeTag: string
): string {
  let next = injectBeforeClosingTag(html, 'head', styleTag)
  if (next === null) next = injectAfterOpeningTag(html, 'head', styleTag)
  if (next === null) next = injectBeforeClosingTag(html, 'body', styleTag)
  if (next === null) next = injectAfterOpeningTag(html, 'html', styleTag)
  if (next === null) next = html + styleTag

  const withRuntime =
    injectBeforeClosingTag(next, 'body', runtimeTag) ??
    injectBeforeClosingTag(next, 'html', runtimeTag) ??
    next + runtimeTag

  return withRuntime
}

export function buildWorkbenchHtmlEditDocument(
  html: string,
  runtimeUrl: string,
  styleUrl: string
): string {
  const styleTag = `<link rel="stylesheet" id="${WORKBENCH_HTML_EDIT_STYLE_ID}" href="${escapeAttribute(styleUrl)}">`
  const runtimeTag = `<script id="${WORKBENCH_HTML_EDIT_SCRIPT_ID}" src="${escapeAttribute(runtimeUrl)}"></script>`
  return injectWorkbenchHtmlRuntimeAssets(html, styleTag, runtimeTag)
}
