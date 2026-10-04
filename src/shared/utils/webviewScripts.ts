/**
 * Webview 注入脚本工具
 * 将原本内联在 WebviewCard 中的注入脚本抽取到此文件，方便维护和修改
 */

import type { ModelSelector } from '../config/selectors'
import { getHtmlToMarkdownScript } from './htmlToMarkdown'
import { noteMessageSelectors, generationStopSelectors, mindmapCodeSelectors, responseMessageSelectors } from '../config/selectors'
import { MINDMAP_TAGS } from './mindmap'
import { NOTE_CLICK_PREFIX, NOTE_DISMISS_PREFIX } from '../types/notes'

const IS_DEV = process.env.NODE_ENV !== 'production'

/**
 * 文件上传数据类型
 */
export interface FileUploadData {
  filePath: string
  fileName: string
  mimeType: string
  size: number
}

/** 获取文件拖拽上传的目标坐标。 */
export function generateFileDropPointScript(selectors: ModelSelector): string {
  return `
      (function () {
        const textareaSelectors = ${JSON.stringify(selectors.textarea || [])};
        let target = null;
        for (const selector of textareaSelectors) {
          const el = document.querySelector(selector);
          if (el) { target = el; break; }
        }
        if (!target) target = document.body || document.documentElement;
        if (!target) return { x: 10, y: 10 };
        try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
        const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const x = rect.left + Math.max(10, rect.width / 2);
        const y = rect.top + Math.max(10, rect.height / 2);
        return { x, y };
      })();
    `
}

/** 辅助确认上传文件名是否出现；未命中不影响主进程拖拽结果。 */
export function generateDetectUploadedFileScript(fileName: string): string {
  return `
      (async function () {
        const fileName = ${JSON.stringify(fileName)};
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
          if (bodyText && bodyText.includes(fileName)) return true;
          const nodes = document.querySelectorAll('[aria-label],[title],[data-file-name]');
          for (const node of nodes) {
            const aria = (node.getAttribute && node.getAttribute('aria-label')) || '';
            const title = (node.getAttribute && node.getAttribute('title')) || '';
            const dataName = (node.getAttribute && node.getAttribute('data-file-name')) || '';
            if ((aria && aria.includes(fileName)) || (title && title.includes(fileName)) || (dataName && dataName.includes(fileName))) {
              return true;
            }
          }
          await new Promise(r => setTimeout(r, 200));
        }
        return false;
      })();
    `
}

// ==================== 内部辅助函数：生成脚本片段 ====================

/**
 * 生成查找输入框的脚本片段
 */
function buildFindTextareaScript(selectors: ModelSelector): string {
  return `
    const textareaSelectors = ${JSON.stringify(selectors.textarea)};
    let textarea = null;

    function isElementVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    for (let attempt = 0; attempt < 20 && !textarea; attempt++) {
      for (const selector of textareaSelectors) {
        const candidates = document.querySelectorAll(selector);
        if (!candidates || candidates.length === 0) continue;

        let best = null;

        for (const el of candidates) {
          if (!isElementVisible(el)) continue;

          const isEditable =
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'INPUT' ||
            el.getAttribute('contenteditable') === 'true' ||
            el.contentEditable === 'true';

          if (!isEditable) continue;

          best = el;

          const isLexical = el.getAttribute('data-lexical-editor') === 'true' || el.dataset?.lexicalEditor === 'true';
          if (isLexical) break;
        }

        if (best) {
          textarea = best;
          break;
        }
      }

      if (!textarea) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    
    if (!textarea) {
      return { success: false, error: '未找到输入框' };
    }
  `
}

/**
 * 生成处理 contenteditable 元素的脚本片段
 */
function buildContentEditableInputScript(messageText: string): string {
  return `
    if (textarea.contentEditable === 'true' || textarea.getAttribute('contenteditable') === 'true') {
      textarea.focus();

      const isProseMirror = textarea.classList && textarea.classList.contains('ProseMirror');
      const isLexical = textarea.getAttribute('data-lexical-editor') === 'true' || textarea.dataset?.lexicalEditor === 'true';
      const isSlate = textarea.getAttribute('data-slate-editor') === 'true' || textarea.dataset?.slateEditor === 'true';

      if (isSlate) {
        const expectedText = ${JSON.stringify(messageText)};
        function normalizeText(s) {
          return (s || '').replace(/\\u200B/g, '').trim();
        }

        let inserted = false;
        const expectedTrimmed = normalizeText(expectedText);
        function setSlateDomValue(textValue) {
          try {
            while (textarea.firstChild) {
              textarea.removeChild(textarea.firstChild);
            }
            const element = document.createElement('div');
            element.setAttribute('data-slate-node', 'element');
            const text = document.createElement('span');
            text.setAttribute('data-slate-node', 'text');
            const leaf = document.createElement('span');
            leaf.setAttribute('data-slate-leaf', 'true');
            const str = document.createElement('span');
            str.setAttribute('data-slate-string', 'true');
            str.textContent = textValue;
            leaf.appendChild(str);
            text.appendChild(leaf);
            element.appendChild(text);
            textarea.appendChild(element);
          } catch (e) {
            if (textarea.textContent !== undefined) {
              textarea.textContent = textValue;
            }
          }
        }

        function dispatchSlateValueEvents(textValue) {
          try {
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: textValue,
              inputType: 'insertText'
            });
            textarea.dispatchEvent(beforeInputEvent);
          } catch (e) {}

          try {
            const inputEvent = new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              data: textValue,
              inputType: 'insertText'
            });
            textarea.dispatchEvent(inputEvent);
          } catch (e) {
            textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          }

          try {
            textarea.dispatchEvent(new CompositionEvent('compositionend', {
              bubbles: true,
              data: textValue
            }));
          } catch (e) {}

          textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }

        // 派发 paste 事件，让 Slate 的 paste handler 接管换行文本插入。
        // 根因：execCommand('insertText') 对含 \\n 的文本走浏览器默认 contentEditable
        // 行为，绕过 Slate 的 beforeinput/paste 拦截，破坏 Slate model 与 DOM 一致性，
        // 触发 "Cannot resolve a Slate node from DOM node"。派发 paste 事件走 Slate
        // 原生 paste 路径，Slate 会按 \\n 拆分并正确插入 block 节点。
        // 返回 true 表示事件已派发且被 Slate 拦截（preventDefault）。
        function dispatchPasteEvent(textValue) {
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', textValue);
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt
            });
            const notPrevented = textarea.dispatchEvent(pasteEvent);
            // Slate 拦截 paste 会 preventDefault；未拦截说明 Slate 没接管
            return !notPrevented;
          } catch (e) {
            return false;
          }
        }

        for (let attempt = 0; attempt < 4 && !inserted; attempt++) {
          try {
            textarea.focus();
            if (textarea.click) textarea.click();
          } catch (e) {}

          await new Promise(resolve => setTimeout(resolve, 30));

          // 清空已有内容（不涉及 \\n，安全）
          if (document.execCommand) {
            try {
              document.execCommand('selectAll', false, null);
              document.execCommand('delete', false, null);
            } catch (e) {}
          }

          // 优先派发 paste 事件（Slate 能正确处理 \\n）
          const pasteHandled = dispatchPasteEvent(expectedText);

          // paste 未被接管时，退回 execCommand（单行可用，多行可能失败）
          let execOk = false;
          if (!pasteHandled && document.execCommand) {
            try {
              execOk = document.execCommand('insertText', false, expectedText);
            } catch (e) {}
          }

          // 都失败才手搓 DOM（兜底，可能触发 Slate 报错）
          if (!pasteHandled && !execOk) {
            setSlateDomValue(expectedText);
          }

          // paste 接管时不补发 insertText 事件（Slate 已自行处理），避免干扰
          if (!pasteHandled) {
            dispatchSlateValueEvents(expectedText);
          }

          await new Promise(resolve => setTimeout(resolve, 60));
          const currentText = normalizeText(textarea.innerText || textarea.textContent || '');
          inserted = expectedTrimmed ? currentText === expectedTrimmed : currentText === '';

          if (!inserted) {
            await new Promise(resolve => setTimeout(resolve, 140));
          }
        }

        textarea.blur();
        await new Promise(resolve => setTimeout(resolve, 10));
        textarea.focus();
      } else
      if (isLexical) {
        const expectedText = ${JSON.stringify(messageText)};

        try {
          const range = document.createRange();
          range.selectNodeContents(textarea);
          range.collapse(false);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (e) {}

        function normalizeText(s) {
          return (s || '').replace(/\\u200B/g, '').trim();
        }

        const expectedTrimmed = normalizeText(expectedText);
        let inserted = false;

        for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
          try {
            textarea.focus();
            if (textarea.click) textarea.click();
          } catch (e) {}

          await new Promise(resolve => setTimeout(resolve, 40));

          if (document.execCommand) {
            try {
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, expectedText);
            } catch (e) {}
          }

          textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

          await new Promise(resolve => setTimeout(resolve, 60));
          const currentText = normalizeText(textarea.textContent || textarea.innerText || '');
          inserted = expectedTrimmed ? currentText === expectedTrimmed : currentText === '';

          if (!inserted) {
            await new Promise(resolve => setTimeout(resolve, 120));
          }
        }

        if (!inserted && expectedTrimmed) {
          while (textarea.firstChild) {
            textarea.removeChild(textarea.firstChild);
          }
          const p = document.createElement('p');
          p.setAttribute('dir', 'auto');
          const span = document.createElement('span');
          span.setAttribute('data-lexical-text', 'true');
          span.textContent = expectedText;
          p.appendChild(span);
          textarea.appendChild(p);

          textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        textarea.blur();
        await new Promise(resolve => setTimeout(resolve, 10));
        textarea.focus();
      } else {
        if (isProseMirror) {
          try {
            const range = document.createRange();
            range.selectNodeContents(textarea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (e) {
            console.log('选中内容失败:', e);
          }
        } else {
          if (document.execCommand) {
            try {
              document.execCommand('selectAll', false, null);
            } catch (e) {}
          }
        }

        let inserted = false;
        if (document.execCommand) {
          try {
            inserted = document.execCommand('insertText', false, ${JSON.stringify(messageText)});
          } catch (e) {
            console.log('execCommand 失败，使用备选方案:', e);
          }
        }

        if (!inserted) {
          if (isProseMirror) {
            try {
              const selection = window.getSelection();
              if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(${JSON.stringify(messageText)});
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              } else {
                const textNode = document.createTextNode(${JSON.stringify(messageText)});
                textarea.appendChild(textNode);
              }
            } catch (e) {
              console.log('Selection API 插入失败，使用 textContent:', e);
              textarea.textContent = ${JSON.stringify(messageText)};
            }
          } else {
            while (textarea.firstChild) {
              textarea.removeChild(textarea.firstChild);
            }
            if (textarea.textContent !== undefined) {
              textarea.textContent = ${JSON.stringify(messageText)};
            }
          }
        }

        if (isProseMirror) {
          const beforeInputEvent = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: ${JSON.stringify(messageText)},
            inputType: 'insertText'
          });
          textarea.dispatchEvent(beforeInputEvent);

          const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            data: ${JSON.stringify(messageText)},
            inputType: 'insertText'
          });
          textarea.dispatchEvent(inputEvent);
        } else {
          textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }

        textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }
    }
  `
}

/**
 * 生成处理 textarea/input 元素的脚本片段
 */
function buildTextareaInputScript(messageText: string, modelId: string): string {
  return `
    else if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
      // 对于 textarea/input 元素
      textarea.focus();

      // 针对豆包和千问和 DeepSeek：模拟完整的用户输入流程，兼容 React/Semi/Ant Design 受控组件
      if (${JSON.stringify(modelId)} === 'doubao' || ${JSON.stringify(modelId)} === 'qwen' || ${JSON.stringify(modelId)} === 'deepseek') {
        // 选中所有现有内容
        textarea.select();

        // 1. 先触发 beforeinput 事件
        const beforeInputEvent = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: ${JSON.stringify(messageText)},
          inputType: 'insertText'
        });
        textarea.dispatchEvent(beforeInputEvent);

        // 2. 使用原生 setter 设置值
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(textarea, ${JSON.stringify(messageText)});
        } else {
          textarea.value = ${JSON.stringify(messageText)};
        }

        // 3. 触发 input 事件（React 监听这个）
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          data: ${JSON.stringify(messageText)},
          inputType: 'insertText'
        });
        textarea.dispatchEvent(inputEvent);

        // 4. 触发 change 事件
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        // 5. 模拟输入法结束（Semi UI 可能监听这个）
        textarea.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          data: ${JSON.stringify(messageText)}
        }));

        // 6. 触发 blur 再 focus，强制 React 更新
        textarea.blur();
        await new Promise(resolve => setTimeout(resolve, 50));
        textarea.focus();
      } else {
        textarea.value = ${JSON.stringify(messageText)};
        textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }
    }
  `
}

/**
 * 生成查找发送按钮的脚本片段
 */
function buildFindSendButtonScript(selectors: ModelSelector): string {
  return `
    // 查找发送按钮
    const buttonSelectors = ${JSON.stringify(selectors.sendButton)};
    let button = null;
    
    for (const selector of buttonSelectors) {
      const candidates = document.querySelectorAll(selector);
      for (const btn of candidates) {
        // 检查按钮是否可见且未禁用
        const isVisible = btn.offsetParent !== null && 
                         btn.offsetWidth > 0 && 
                         btn.offsetHeight > 0;
        const isEnabled = !btn.disabled && 
                         btn.getAttribute('aria-disabled') !== 'true';
        
        if (isVisible && isEnabled) {
          button = btn;
          break;
        }
      }
      if (button) break;
    }
  `
}

/**
 * 生成模拟 Enter 键发送的脚本片段
 */
function buildSimulateEnterKeyScript(modelId: string): string {
  return `
    if (!button) {
      // 尝试模拟 Enter 键发送
      textarea.focus();
      
      // 触发完整的键盘事件序列：keydown -> keypress -> keyup
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(keydownEvent);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      textarea.dispatchEvent(new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      textarea.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      
      await new Promise(resolve => setTimeout(resolve, 200));
      return { success: true, method: 'enter' };
    }
    
    // 点击发送按钮
    // 对于 Angular Material 按钮，可能需要先触发 focus
    button.focus();
    const clickDelay = (${JSON.stringify(modelId)} === 'doubao' || ${JSON.stringify(modelId)} === 'qwen' || ${JSON.stringify(modelId)} === 'deepseek') ? 500 : 50;
    await new Promise(resolve => setTimeout(resolve, clickDelay));
    button.click();
    
    // 等待一下确保点击生效
    await new Promise(resolve => setTimeout(resolve, 200));
    
    return { success: true, method: 'button' };
  `
}

/**
 * 生成清空 contenteditable 的脚本片段
 */
function buildClearContentEditableScript(): string {
  return `
    if (textarea.contentEditable === 'true' || textarea.getAttribute('contenteditable') === 'true') {
      // 对于 contenteditable 元素
      textarea.focus();
      
      const isLexical = textarea.getAttribute('data-lexical-editor') === 'true' || textarea.dataset?.lexicalEditor === 'true';

      let cleared = false;
      function selectAllContents() {
        try {
          if (document.execCommand) {
            document.execCommand('selectAll', false, null);
            return;
          }
        } catch (e) {}

        try {
          const range = document.createRange();
          range.selectNodeContents(textarea);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (e) {}
      }

      for (let attempt = 0; attempt < 3 && !cleared; attempt++) {
        selectAllContents();

        if (isLexical) {
          try {
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'deleteContentBackward',
              data: null
            });
            textarea.dispatchEvent(beforeInputEvent);
          } catch (e) {}
        }

        if (document.execCommand) {
          try {
            document.execCommand('delete', false, null);
          } catch (e) {}
          try {
            document.execCommand('insertText', false, '');
          } catch (e) {}
        }

        try {
          const selection = window.getSelection();
          selection?.deleteFromDocument?.();
        } catch (e) {}

        await new Promise(resolve => setTimeout(resolve, 30));
        cleared = (textarea.textContent || '').trim() === '';
      }
      
      if (!cleared) {
        if (isLexical) {
          textarea.innerHTML = '<p dir="auto"><br></p>';
          cleared = (textarea.textContent || '').trim() === '';
        }
        if (!cleared) {
          while (textarea.firstChild) {
            textarea.removeChild(textarea.firstChild);
          }
          if (textarea.textContent !== undefined) {
            textarea.textContent = '';
          }
        }
      }

      if (isLexical) {
        try {
          const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward',
            data: null
          });
          textarea.dispatchEvent(inputEvent);
        } catch (e) {
          textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }

        textarea.blur();
        await new Promise(resolve => setTimeout(resolve, 10));
        textarea.focus();
      } else {
        try {
          const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward',
            data: null
          });
          textarea.dispatchEvent(inputEvent);
        } catch (e) {
          textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
      }
      
      textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    }
  `
}

/**
 * 生成清空 textarea/input 的脚本片段
 */
function buildClearTextareaScript(): string {
  return `
    else if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
      // 对于 textarea/input 元素
      textarea.value = '';
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // 尝试通用方法
      if (textarea.textContent !== undefined) {
        textarea.textContent = '';
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `
}

/**
 * 生成 Deep Research 辅助函数脚本片段
 */
function buildDeepResearchHelperFunctions(): string {
  return `
    // 辅助函数：标准化可点击元素
    function normalizeClickable(el, exact) {
      if (!el) return el;
      if (exact) return el;
      if (el.tagName === 'BUTTON') return el;
      try {
        var clickable = el.closest && el.closest('button,[role="button"],[role="radio"],[role="menuitem"],[role="menuitemradio"]');
        return clickable || el;
      } catch (e) {
        return el;
      }
    }

    // 辅助函数：查找元素（策略二：regex + 单词边界 + exclude + 语义化兜底）
    function findElement(selector, text, opts) {
      // opts 兼容旧 boolean（exact）与新 step 对象
      var o = (opts && typeof opts === 'object') ? opts : { exact: !!opts };

      // 统一文本匹配：regex 优先，否则 text includes；先过 exclude
      function matchText(content, ariaLabel) {
        var flags = o.caseSensitive ? '' : 'i';
        var targets = o.regex
          ? [o.regex]
          : (text != null ? (Array.isArray(text) ? text : [text]) : []);
        var excludeList = o.exclude || [];
        // exclude 命中任一即否（区分 Search/Research 的关键）
        for (var ei = 0; ei < excludeList.length; ei++) {
          try { if (new RegExp(excludeList[ei], flags).test(content) || new RegExp(excludeList[ei], flags).test(ariaLabel)) return false; } catch (e) {}
        }
        for (var ti = 0; ti < targets.length; ti++) {
          var t = targets[ti];
          if (o.regex) {
            var pat = t;
            if (o.wordBoundary !== false) {
              if (!/^\\^/.test(pat)) pat = '\\b(?:' + pat + ')';
              if (!/\\$$/.test(pat)) pat = pat + '\\b';
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

      var selectorList = Array.isArray(selector) ? selector : [selector];
      for (var si = 0; si < selectorList.length; si++) {
        var sel = selectorList[si];
        var elements = null;
        try {
          elements = document.querySelectorAll(sel);
        } catch (e) {
          continue;
        }
      
        // 如果没有文本要求且无 regex，返回第一个可见元素
        if (!text && !o.regex) {
          for (var vi = 0; vi < elements.length; vi++) {
            var vel = elements[vi];
            if (vel.getBoundingClientRect().width > 0 || vel.offsetParent !== null) {
              return normalizeClickable(vel, o.exact);
            }
          }
          if (elements && elements[0]) return normalizeClickable(elements[0], o.exact);
          continue;
        }
      
        // 如果有文本/regex 要求
        for (var mi = 0; mi < elements.length; mi++) {
          var el = elements[mi];
          if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) {
            continue;
          }
          var content = (el.innerText || el.textContent || '').trim();
          var ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          if (matchText(content, ariaLabel)) {
            return normalizeClickable(el, o.exact);
          }
        }
      }

      // 策略二降级：静态选择器全部失效且指定了目标文本时，遍历全局交互类语义元素
      if (text || (o && o.regex)) {
        var semanticSelectors = 'button, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemradio"], [role="tab"], label, input[type="checkbox"], input[type="radio"]';
        var semanticElements = [];
        try {
          semanticElements = document.querySelectorAll(semanticSelectors);
        } catch (e) {}

        for (var sei = 0; sei < semanticElements.length; sei++) {
          var sel2 = semanticElements[sei];
          if (sel2.getBoundingClientRect().width === 0 && sel2.offsetParent === null) {
            continue;
          }
          var content2 = (sel2.innerText || sel2.textContent || '').trim();
          var ariaLabel2 = sel2.getAttribute('aria-label') || sel2.getAttribute('title') || '';
          if (matchText(content2, ariaLabel2)) {
            return normalizeClickable(sel2, o.exact);
          }
        }
      }

       return null;
    }
    
    function simulateClick(el) {
      try {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
      } catch (e) {}
      el.click();
    }

    // 跨步菜单兜底：按语义找开菜单按钮（策略二 Step 4）
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
      return normalizeClickable(candidates[0].el, false);
    }
  `
}

/**
 * 生成 Deep Research 步骤执行脚本片段
 */
function buildDeepResearchStepsScript(_steps: unknown[]): string {
  return `
    // 处理多步操作
    if (config.steps && config.steps.length > 0) {
      let didSuccessStep = false;
      for (const step of config.steps) {
         // 尝试多次查找，因为可能是动态加载的
         let element = null;
         let attempts = 0;
         const maxAttempts = 10; // 2秒超时
         
         while (!element && attempts < maxAttempts) {
           element = findElement(step.selector, step.text, step);
           if (!element) {
             await new Promise(r => setTimeout(r, 200));
             attempts++;
           }
         }
         
         if (!element && step && step.menuOpenerFallback) {
           element = findMenuOpener();
         }
         if (!element) {
           if (step && step.optional) {
             continue;
           }
           return { success: false, error: '步骤执行失败: 未找到元素 ' + step.selector };
         }
         
         element.scrollIntoView({ block: 'center', inline: 'center' });
         element.focus();
         simulateClick(element);
         if (!step || step.countsAsSuccess !== false) {
           didSuccessStep = true;
         }
         
         // 等待下一步
         const delay = step.delay || 500;
         await new Promise(r => setTimeout(r, delay));

         if (element.getAttribute('aria-haspopup') === 'menu') {
           let checks = 0;
           while (checks < 10 && element.getAttribute('aria-expanded') !== 'true') {
             await new Promise(r => setTimeout(r, 100));
             checks++;
           }
         }
      }
      if (!didSuccessStep) {
        return { success: false, error: '未完成目标操作' };
      }
      return { success: true };
    }
  `
}

/**
 * 生成获取最新回复的辅助函数脚本片段
 */
function buildFindSourceListFunction(): string {
  return `
    /**
     * 查找元素相邻或父级中的引用来源列表（Gemini 特殊处理）
     * @param {HTMLElement} element - 消息元素
     * @returns {HTMLElement|null} 引用来源列表元素
     */
    function findSourceList(element) {
      if (!element) return null;
      
      // 1. 先在元素内部查找
      let sourceList = element.querySelector('.source-list, .used-sources');
      if (sourceList) return sourceList;
      
      // 2. 在兄弟元素中查找
      let sibling = element.nextElementSibling;
      let searchCount = 0;
      while (sibling && searchCount < 5) {
        if (sibling.classList && (sibling.classList.contains('source-list') || sibling.classList.contains('used-sources'))) {
          return sibling;
        }
        sourceList = sibling.querySelector('.source-list, .used-sources');
        if (sourceList) return sourceList;
        sibling = sibling.nextElementSibling;
        searchCount++;
      }
      
      // 3. 在父元素中查找
      let parent = element.parentElement;
      let parentCount = 0;
      while (parent && parentCount < 5) {
        sourceList = parent.querySelector('.source-list, .used-sources');
        if (sourceList && !element.contains(sourceList)) {
          return sourceList;
        }
        parent = parent.parentElement;
        parentCount++;
      }
      
      // 4. 全局查找最后一个 source-list（作为最后手段）
      const allSourceLists = document.querySelectorAll('.source-list, .used-sources');
      if (allSourceLists.length > 0) {
        return allSourceLists[allSourceLists.length - 1];
      }
      
      return null;
    }
  `
}

/**
 * 生成 Gemini 引用链接处理的脚本片段
 */
function buildGeminiSourceLinksScript(): string {
  return `
    // ========== Gemini 引用链接特殊处理 ==========
    // 检查是否已经包含引用来源（避免重复）
    if (!content.includes('参考来源') && !content.includes('📚')) {
      const sourceList = findSourceList(lastMessage);
      if (sourceList) {
        // 直接处理 source-list，提取引用链接
        const sourceItems = sourceList.querySelectorAll('browse-web-item');
        if (sourceItems.length > 0) {
          let sourcesMarkdown = '\\n\\n---\\n\\n**📚 参考来源：**\\n\\n';
          sourceItems.forEach((item) => {
            const link = item.querySelector('a[href]');
            if (!link) return;

            const href = link.getAttribute('href') || '';
            if (!href || href.startsWith('javascript:')) return;

            // 获取网站域名
            const displayName = item.querySelector('.display-name, [data-test-id="domain-name"]');
            const domainText = displayName ? displayName.textContent.trim() : '';

            // 获取文章标题
            const subTitle = item.querySelector('.sub-title, [data-test-id="sub-title"]');
            const titleText = subTitle ? subTitle.textContent.trim() : '';

            // 组合链接
            const linkText = titleText || domainText || href;
            sourcesMarkdown += '- [' + linkText + '](' + href + ')' + (domainText && titleText ? ' - ' + domainText : '') + '\\n';
          });

          if (sourcesMarkdown.includes('[')) {
            content += sourcesMarkdown;
          }
        }
      }
    }
  `
}

/**
 * 千问(Qwen) 引用来源链接脚本
 *
 * 千问正文引用上标形如 <span data-index="6">6</span>，已在 htmlToMarkdown 中转成 [6]。
 * 来源详情只在用户悬停上标后才以 .source-card-item tooltip 形式渲染到 document（不在
 * 回复容器内），故需从 document 全局扫描 tooltip，按编号拼成来源列表追加到正文末尾。
 *
 * tooltip DOM 结构：
 *   .source-card-item > .content-title (文本: "6. 标题 - 站名")
 *                   > .hover-top-content > .content-url (文本: "www.kepu.gov.cn")
 * 编号从标题前缀 "N. " 解析，与正文 [N] 配对。
 *
 * 非千问页面没有 .source-card-item，自然 miss，零影响。
 */
function buildQwenSourceLinksScript(): string {
  return `
    // ========== 千问(Qwen) 引用来源特殊处理 ==========
    // 正文已含 [N] 上标；此处扫描悬停 tooltip 补来源列表。仅在尚未追加时执行，避免重复。
    if (!content.includes('参考来源') && !content.includes('📚')) {
      try {
        // 注意：tooltip 来源卡 class 为 source-card-item-<hash>（如 source-card-item-mo9ULH），
        // 不能用精确 .source-card-item（会因 hash 后缀 miss），必须用 [class*="source-card-item"]。
        var tooltipItems = document.querySelectorAll('[class*="source-card-item"]');
        if (tooltipItems && tooltipItems.length > 0) {
          // 收集并按编号去重排序
          var entries = {};
          var order = [];
          for (var ti = 0; ti < tooltipItems.length; ti++) {
            var card = tooltipItems[ti];
            var titleEl = card.querySelector('.content-title, [class*="content-title"]');
            var urlEl = card.querySelector('.content-url, [class*="content-url"]');
            var titleText = titleEl ? (titleEl.textContent || '').trim() : '';
            var domainText = urlEl ? (urlEl.textContent || '').trim() : '';
            if (!titleText && !domainText) continue;
            // 从标题前缀解析编号，如 "6. 睡觉时..." -> "6"
            var numMatch = titleText.match(/^\\s*(\\d+)\\s*[.、)]?/);
            var num = numMatch ? numMatch[1] : '';
            // 去掉标题里的编号前缀，得到纯标题
            var cleanTitle = titleText.replace(/^\\s*\\d+\\s*[.、)]?\\s*/, '').trim();
            var key = num || (cleanTitle || domainText);
            if (!entries[key]) {
              entries[key] = { num: num, title: cleanTitle, domain: domainText };
              order.push(key);
            } else if (!entries[key].domain && domainText) {
              entries[key].domain = domainText;
            }
          }
          if (order.length > 0) {
            // 按编号数值排序（无编号的排后面）
            order.sort(function(a, b) {
              var na = parseInt(a, 10), nb = parseInt(b, 10);
              if (isNaN(na) && isNaN(nb)) return 0;
              if (isNaN(na)) return 1;
              if (isNaN(nb)) return -1;
              return na - nb;
            });
            var sourcesMarkdown = '\\n\\n---\\n\\n**📚 参考来源：**\\n\\n';
            for (var oi = 0; oi < order.length; oi++) {
              var e = entries[order[oi]];
              var label = e.num ? ('[' + e.num + '] ') : '';
              var main = e.title || e.domain || '';
              if (e.domain && e.title && e.title.indexOf(e.domain) === -1) {
                main = e.title + ' - ' + e.domain;
              } else if (!e.title) {
                main = e.domain;
              }
              sourcesMarkdown += '- ' + label + main + '\\n';
            }
            if (sourcesMarkdown.replace(/[\\n\\-\\s*📚参考来源：\\[\\]]/g, '').length > 0) {
              content += sourcesMarkdown;
            }
          }
        }
      } catch (e) {
        // 来源提取失败不影响正文返回
      }
    }
  `
}

// ==================== 导出函数：生成完整脚本 ====================

/**
 * 生成发送消息的注入脚本
 * @param message 要发送的消息
 * @param modelId 模型 ID
 * @param selectors 选择器配置
 */
export function generateSendMessageScript(
  message: string,
  modelId: string,
  selectors: ModelSelector
): string {
  const findTextarea = buildFindTextareaScript(selectors)
  const contentEditableInput = buildContentEditableInputScript(message)
  const textareaInput = buildTextareaInputScript(message, modelId)
  const findButton = buildFindSendButtonScript(selectors)
  const simulateEnter = buildSimulateEnterKeyScript(modelId)

  return `
    (async function() {
      try {
        const messageText = ${JSON.stringify(message)};
        const currentModelId = ${JSON.stringify(modelId)};
        // 查找输入框
        ${findTextarea}
        
        textarea.focus();
        await new Promise(resolve => setTimeout(resolve, 80));

        function normalizeText(s) {
          return (s || '').replace(/\\u200B/g, '').trim();
        }

        function readCurrentInputValue() {
          try {
            if (textarea && textarea.value !== undefined) return textarea.value;
          } catch (e) {}
          return textarea.innerText || textarea.textContent || '';
        }

        const expected = normalizeText(messageText);
        const current = normalizeText(readCurrentInputValue());
        const isAlreadySame = expected ? current === expected : current === '';
        const isRepeated = expected && current && current.length > expected.length && current.split(expected).join('') === '';

        if (!isAlreadySame || isRepeated) {
          ${contentEditableInput}
          ${textareaInput}
          else {
            if (textarea.textContent !== undefined) {
              textarea.textContent = messageText;
            }
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }

        // 对 textarea/input 强制同步受控组件框架状态
        // insertTextToAll 使用的简单 value= 赋值只能写入 DOM，无法触发 React/Vue
        // 的受控状态更新。此处补发一个 InputEvent，让框架读取 event.target.value
        // 并同步内部状态，确保发送按钮可用。
        if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
          textarea.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            data: messageText,
            inputType: 'insertText'
          }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const postInputDelay = (currentModelId === 'doubao' || currentModelId === 'qwen' || currentModelId === 'deepseek') ? 350 : 80;
        await new Promise(resolve => setTimeout(resolve, postInputDelay));
        
        ${findButton}
        ${simulateEnter}
        
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成插入文本的注入脚本（不发送）
 * @param message 要插入的消息
 * @param modelId 模型 ID
 * @param selectors 选择器配置
 */
export function generateInsertTextScript(
  message: string,
  modelId: string,
  selectors: ModelSelector
): string {
  const findTextarea = buildFindTextareaScript(selectors)
  const contentEditableInput = buildContentEditableInputScript(message)
  const textareaInput = buildTextareaInputScript(message, modelId)

  return `
    (async function() {
      try {
        const messageText = ${JSON.stringify(message)};
        function normalizeText(s) {
          return (s || '').replace(/\\u200B/g, '').trim();
        }

        // 查找输入框
        ${findTextarea}

        textarea.focus();
        await new Promise(resolve => setTimeout(resolve, 80));

        // 守卫：若输入框已是目标文本（或其重复），跳过注入。
        // 对 Slate/Lexical 等 contenteditable 框架尤其关键——
        // 重复执行 setSlateDomValue 会手搓 Slate 内部 DOM span，触发
        // "Cannot resolve a Slate node from DOM node" 报错。
        // 此守卫与 generateSendMessageScript 的 isAlreadySame/isRepeated 对齐。
        function readCurrentInputValue() {
          try {
            if (textarea && textarea.value !== undefined) return textarea.value;
          } catch (e) {}
          return textarea.innerText || textarea.textContent || '';
        }

        const expected = normalizeText(messageText);
        const current = normalizeText(readCurrentInputValue());
        const isAlreadySame = expected ? current === expected : current === '';
        const isRepeated = expected && current && current.length > expected.length && current.split(expected).join('') === '';

        if (!isAlreadySame || isRepeated) {
          // 设置值（兼容 contenteditable 和 textarea）
          ${contentEditableInput}
          ${textareaInput}
          else {
            // 尝试通用方法
            const textNode = document.createTextNode(messageText);
            textarea.appendChild(textNode);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true };

      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成"仅点击发送按钮"的注入脚本（不重新设值）。
 * 用于任务分配两段式发送的第二段：第一段已用 generateInsertTextScript 注入文本，
 * 本段只查找发送按钮并点击。
 *
 * 设计决策：
 * - 不调用 buildFindTextareaScript：该函数找不到 textarea 时会
 *   `return { success:false }` 终止整个 IIFE，而第二段只需按钮，
 *   不应被 textarea 选择器未命中拖累。
 * - 不调用 buildSimulateEnterKeyScript：它含 Enter 回退分支且依赖
 *   textarea 变量；为避免扩散改动共享函数，改为内联"按钮存在即 click，
 *   否则失败"。
 * - clickDelay 与 buildSimulateEnterKeyScript 一致，保留
 *   doubao/qwen/deepseek 500ms、其他 50ms 的分平台策略。
 *
 * @param modelId 模型 ID
 * @param selectors 选择器配置
 */
export function generateSendOnlyScript(
  modelId: string,
  selectors: ModelSelector
): string {
  const findButton = buildFindSendButtonScript(selectors)
  return `
    (async function() {
      try {
        ${findButton}
        if (!button) {
          return { success: false, error: '未找到发送按钮' };
        }
        button.focus();
        const clickDelay = (${JSON.stringify(modelId)} === 'doubao' || ${JSON.stringify(modelId)} === 'qwen' || ${JSON.stringify(modelId)} === 'deepseek') ? 500 : 50;
        await new Promise(resolve => setTimeout(resolve, clickDelay));
        button.click();
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, method: 'button' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成清空输入框的注入脚本
 * @param selectors 选择器配置
 */
export function generateClearInputScript(selectors: ModelSelector): string {
  const findTextarea = buildFindTextareaScript(selectors)
  const clearContentEditable = buildClearContentEditableScript()
  const clearTextarea = buildClearTextareaScript()

  return `
    (async function() {
      try {
        // 查找输入框
        ${findTextarea}
        
        // 清空内容（兼容 contenteditable 和 textarea）
        ${clearContentEditable}
        ${clearTextarea}
        
        return { success: true };
        
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成读取输入框当前文本内容的注入脚本
 * @param selectors 选择器配置
 */
export function generateGetInputTextScript(selectors: ModelSelector): string {
  const findTextarea = buildFindTextareaScript(selectors)

  return `
    (async function() {
      try {
        ${findTextarea}

        if (!textarea) {
          return { success: false, text: '', error: '未找到输入框' };
        }

        let text = '';
        try {
          if (textarea.value !== undefined && textarea.value !== '') {
            text = textarea.value;
          }
        } catch (e) {}

        if (!text) {
          text = textarea.innerText || textarea.textContent || '';
        }

        // 清理零宽字符
        text = (text || '').replace(/\\u200B/g, '').trim();

        return { success: true, text: text };
      } catch (error) {
        return { success: false, text: '', error: error.message };
      }
    })();
  `
}

/**
 * 生成启用 Deep Research 的注入脚本
 * @param config Deep Research 配置
 */
export function generateEnableDeepResearchScript(config: any): string {
  const helpers = buildDeepResearchHelperFunctions()
  const steps = buildDeepResearchStepsScript(config.steps || [])

  return `
    (async function() {
      try {
        const config = ${JSON.stringify(config)};
        
        ${helpers}
        ${steps}
        
        // 兼容旧的 button 配置
        if (config.button) {
          const button = document.querySelector(config.button);
          if (!button) {
            return { success: false, error: '未找到 Deep Research 按钮' };
          }
          
          // 点击按钮启用 Deep Research
          button.click();
          
          return { success: true };
        }
        
        return { success: false, error: '无效的 Deep Research 配置' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成禁用 Deep Research 的注入脚本
 * @param config Deep Research 配置
 */
export function generateDisableDeepResearchScript(config: any): string {
  const helpers = buildDeepResearchHelperFunctions()

  return `
    (async function() {
      try {
        const config = ${JSON.stringify(config)};
        
        ${helpers}
        
        if (config.cancelSteps && config.cancelSteps.length > 0) {
          let didSuccessStep = false;
          for (const step of config.cancelSteps) {
            let element = null;
            let attempts = 0;
            const maxAttempts = 10;
            while (!element && attempts < maxAttempts) {
              element = findElement(step.selector, step.text, step);
              if (!element) {
                await new Promise(r => setTimeout(r, 200));
                attempts++;
              }
            }
            if (!element && step && step.menuOpenerFallback) {
              element = findMenuOpener();
            }
            if (!element) {
              if (step && step.optional) {
                continue;
              }
              return { success: false, error: '步骤执行失败: 未找到元素 ' + step.selector };
            }
            element.scrollIntoView({ block: 'center', inline: 'center' });
            element.focus();
            simulateClick(element);
            if (!step || step.countsAsSuccess !== false) {
              didSuccessStep = true;
            }
            const delay = step.delay || 500;
            await new Promise(r => setTimeout(r, delay));
          }
          if (!didSuccessStep) {
            return { success: false, error: '未完成目标操作' };
          }
          return { success: true };
        }
        
        return { success: false, error: '无效的取消配置' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成启用 AI 生图功能的注入脚本
 * @param config Image Generation 配置
 */
export function generateEnableImageGenerationScript(config: any): string {
  const helpers = buildDeepResearchHelperFunctions()
  const steps = buildDeepResearchStepsScript(config.steps || [])

  return `
    (async function() {
      try {
        const config = ${JSON.stringify(config)};

        ${helpers}
        ${steps}

        return { success: false, error: '无效的生图配置' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成禁用 AI 生图功能的注入脚本
 * @param config Image Generation 配置
 */
export function generateDisableImageGenerationScript(config: any): string {
  const helpers = buildDeepResearchHelperFunctions()

  return `
    (async function() {
      try {
        const config = ${JSON.stringify(config)};

        ${helpers}

        if (config.cancelSteps && config.cancelSteps.length > 0) {
          let didSuccessStep = false;
          for (const step of config.cancelSteps) {
            let element = null;
            let attempts = 0;
            const maxAttempts = 10;
            while (!element && attempts < maxAttempts) {
              element = findElement(step.selector, step.text, step);
              if (!element) {
                await new Promise(r => setTimeout(r, 200));
                attempts++;
              }
            }
            if (!element && step && step.menuOpenerFallback) {
              element = findMenuOpener();
            }
            if (!element) {
              if (step && step.optional) {
                continue;
              }
              return { success: false, error: '步骤执行失败: 未找到元素 ' + step.selector };
            }
            element.scrollIntoView({ block: 'center', inline: 'center' });
            element.focus();
            simulateClick(element);
            if (!step || step.countsAsSuccess !== false) {
              didSuccessStep = true;
            }
            const delay = step.delay || 500;
            await new Promise(r => setTimeout(r, delay));
          }
          if (!didSuccessStep) {
            return { success: false, error: '未完成目标操作' };
          }
          return { success: true };
        }

        return { success: false, error: '无效的取消配置' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}

/**
 * 生成"按 imageDownload.steps 触发网页内置下载"的注入脚本。
 * 复用 imageGeneration 的 findElement/simulateClick；支持 step.hover 模式。
 * 跑完 steps 后若配置了 closePreviewSelector，自动关预览（best-effort）。
 * 返回 { success, clicked } —— clicked 表示下载按钮步骤是否执行成功；
 * 真正落盘由主进程 will-download 统计。
 */
export function generateClickDownloadButtonsScript(selectors: ModelSelector): string {
  const helpers = buildDeepResearchHelperFunctions()
  const config = selectors.imageDownload || { steps: [] }

  return `
    (async function() {
      try {
        const config = ${JSON.stringify(config)};
        ${helpers}

        // 自定义 findLatestElement：从后往前查找元素，从而自动锁定最新的消息或生图
        function findLatestElement(selector, text, opts) {
          var o = (opts && typeof opts === 'object') ? opts : { exact: !!opts };

          function matchText(content, ariaLabel) {
            var flags = o.caseSensitive ? '' : 'i';
            var targets = o.regex
              ? [o.regex]
              : (text != null ? (Array.isArray(text) ? text : [text]) : []);
            var excludeList = o.exclude || [];
            for (var ei = 0; ei < excludeList.length; ei++) {
              try { if (new RegExp(excludeList[ei], flags).test(content) || new RegExp(excludeList[ei], flags).test(ariaLabel)) return false; } catch (e) {}
            }
            for (var ti = 0; ti < targets.length; ti++) {
              var t = targets[ti];
              if (o.regex) {
                var pat = t;
                if (o.wordBoundary !== false) {
                  if (!/^\\^/.test(pat)) pat = '\\b(?:' + pat + ')';
                  if (!/\\$$/.test(pat)) pat = pat + '\\b';
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

          var selectorList = Array.isArray(selector) ? selector : [selector];
          for (var si = 0; si < selectorList.length; si++) {
            var sel = selectorList[si];
            var elements = null;
            try {
              elements = document.querySelectorAll(sel);
            } catch (e) {
              continue;
            }
          
            if (!text && !o.regex) {
              for (var vi = elements.length - 1; vi >= 0; vi--) {
                var vel = elements[vi];
                if (vel.getBoundingClientRect().width > 0 || vel.offsetParent !== null) {
                  return normalizeClickable(vel, o.exact);
                }
              }
              if (elements && elements[0]) return normalizeClickable(elements[elements.length - 1], o.exact);
              continue;
            }
          
            for (var mi = elements.length - 1; mi >= 0; mi--) {
              var el = elements[mi];
              if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) {
                continue;
              }
              var content = (el.innerText || el.textContent || '').trim();
              var ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
              if (matchText(content, ariaLabel)) {
                return normalizeClickable(el, o.exact);
              }
            }
          }
          return null;
        }

        if (!config.steps || !config.steps.length) return { success: false, error: '未配置下载步骤', clicked: 0 };

        let downloadClicked = false;
        for (let i = 0; i < config.steps.length; i++) {
          const step = config.steps[i];
          let element = null;
          let attempts = 0;
          while (!element && attempts < 10) {
            element = findLatestElement(step.selector, step.text, step);
            if (!element) {
              await new Promise(r => setTimeout(r, 200));
              attempts++;
            }
          }
          if (!element) {
            if (step.optional) continue;
            return { success: false, error: '未找到元素: ' + (Array.isArray(step.selector) ? step.selector.join(', ') : step.selector), clicked: downloadClicked ? 1 : 0 };
          }
          element.scrollIntoView({ block: 'center', inline: 'center' });
          if (step.hover) {
            element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
          } else {
            simulateClick(element);
            downloadClicked = true;
          }
          await new Promise(r => setTimeout(r, step.delay || 300));
        }

        if (config.closePreviewSelector) {
          try {
            const closeBtn = document.querySelector(config.closePreviewSelector);
            if (closeBtn) closeBtn.click();
          } catch (e) { /* 忽略 */ }
        }

        return { success: downloadClicked, clicked: downloadClicked ? 1 : 0 };
      } catch (error) {
        return { success: false, clicked: 0, error: String(error?.message ?? error) };
      }
    })();
  `
}

/**
 * 生成"提取当前 webview 最新回复中生图"的注入脚本。
 * 在页内把 img.src / canvas / a[download] / blob: 统一转成 {src, mime?} 数组返回。
 * @param selectors 平台选择器配置（用 messageContainer 定位最新回复气泡）
 */
export function generateExtractImagesScript(selectors: ModelSelector): string {
  const messageContainer = JSON.stringify(selectors.messageContainer || [])
  return `
    (async function() {
      try {
        const messageContainerSelectors = ${messageContainer};
        function isElementVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
        }
        function findLatestContainer() {
          for (const sel of messageContainerSelectors) {
            const all = document.querySelectorAll(sel);
            for (let i = all.length - 1; i >= 0; i--) {
              if (isElementVisible(all[i])) return all[i];
            }
          }
          return document.body;
        }
        function inferMime(src) {
          const dataMatch = src.match(/^data:(image\\/[a-zA-Z0-9.+-]+);/);
          if (dataMatch) return dataMatch[1];
          const extMatch = src.match(/\\.(png|jpe?g|webp|gif|bmp|svg)(?:\\?|#|$)/i);
          if (extMatch) {
            const e = extMatch[1].toLowerCase();
            if (e === 'jpg') return 'image/jpeg';
            return 'image/' + e;
          }
          return 'image/png';
        }
        function blobToDataUrl(blobUrl) {
          return fetch(blobUrl).then(function(r){ return r.blob(); }).then(function(b){
            return new Promise(function(resolve, reject){
              var fr = new FileReader();
              fr.onload = function(){ resolve(fr.result); };
              fr.onerror = function(){ reject(fr.error); };
              fr.readAsDataURL(b);
            });
          });
        }

        var root = findLatestContainer();
        var seen = Object.create(null);
        var images = [];

        // 1) img 元素
        var imgs = root.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var img = imgs[i];
          var src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
          if (!src) continue;
          // 过滤小图标/头像（data:/blob: 不过滤尺寸，因为是生成的图）
          var nw = img.naturalWidth || 0;
          if (nw && nw < 100 && !/^data:/.test(src) && !/^blob:/.test(src)) continue;
          if (seen[src]) continue;
          seen[src] = true;
          images.push({ src: src, mime: inferMime(src) });
        }

        // 2) canvas
        var canvases = root.querySelectorAll('canvas');
        for (var c = 0; c < canvases.length; c++) {
          try {
            var dataUrl = canvases[c].toDataURL('image/png');
            if (dataUrl && !seen[dataUrl]) {
              seen[dataUrl] = true;
              images.push({ src: dataUrl, mime: 'image/png' });
            }
          } catch (e) { /* canvas 跨域 tainted，跳过 */ }
        }

        // 3) a[download] / a[href$=图片]
        var anchors = root.querySelectorAll('a[download], a[href$=".png" i], a[href$=".jpg" i], a[href$=".jpeg" i], a[href$=".webp" i]');
        for (var a = 0; a < anchors.length; a++) {
          var href = anchors[a].href || '';
          if (!href || seen[href]) continue;
          seen[href] = true;
          images.push({ src: href, mime: inferMime(href) });
        }

        // 4) blob: 转 data:（必须在页内做，主进程跨进程拿不到 blob）
        for (var k = 0; k < images.length; k++) {
          if (/^blob:/.test(images[k].src)) {
            try {
              var dataUrl2 = await blobToDataUrl(images[k].src);
              images[k].src = dataUrl2;
              images[k].mime = inferMime(dataUrl2);
            } catch (e) {
              // 转换失败，保留 blob: src，主进程会记录失败
            }
          }
        }

        return { success: true, images: images };
      } catch (error) {
        return { success: false, images: [], error: String(error?.message ?? error) };
      }
    })();
  `;
}

/**
 * 生成获取最新回复的注入脚本
 * 将 HTML 内容转换为 Markdown 格式
 * @param selectors 选择器配置
 */
export function generateGetLatestResponseScript(selectors: ModelSelector, assistantOnly = false): string {
  // 获取 HTML 转 Markdown 的函数定义
  const htmlToMarkdownScript = getHtmlToMarkdownScript()
  const findSourceList = buildFindSourceListFunction()
  const geminiSources = buildGeminiSourceLinksScript()
  const qwenSources = buildQwenSourceLinksScript()

  return `
    (async function() {
      try {
        // 注入 HTML 转 Markdown 函数
        ${htmlToMarkdownScript}
        
        ${findSourceList}

        function isElementVisible(el) {
          try {
            if (!el || !el.isConnected) return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const opacity = Number(style.opacity || '1');
            if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
            return true;
          } catch {
            return false;
          }
        }

        function htmlStringToMarkdown(html) {
          try {
            const temp = document.createElement('div');
            temp.innerHTML = html || '';
            try {
              const nodes = temp.querySelectorAll('style,script,noscript,meta,link,head,title');
              nodes.forEach(n => n.remove());
            } catch {}
            const md = htmlToMarkdown(temp);
            return (md || '').trim();
          } catch {
            return '';
          }
        }

        function looksLikeHtmlSource(text) {
          try {
            const t = (text || '').trim();
            if (!t) return false;
            if (/<!doctype\\s+html/i.test(t)) return true;
            if (/<html[\\s>]/i.test(t)) return true;
            if (t.startsWith('<') && /<\\/?[a-z][\\s\\S]*?>/i.test(t)) return true;
            return false;
          } catch {
            return false;
          }
        }

        function extractReportFromContainer(container) {
          if (!container) return '';

          try {
            if (container.shadowRoot) {
              const md = htmlToMarkdown(container.shadowRoot);
              if (md && md.trim()) return md.trim();
            }
          } catch {}

          try {
            if (document.createTreeWalker) {
              const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
              let node = walker.currentNode;
              while (node) {
                const el = node;
                if (el && el.shadowRoot) {
                  try {
                    const md = htmlToMarkdown(el.shadowRoot);
                    if (md && md.trim()) return md.trim();
                  } catch {}
                }
                node = walker.nextNode();
              }
            }
          } catch {}

          try {
            const iframe = (container.tagName && container.tagName.toLowerCase && container.tagName.toLowerCase() === 'iframe')
              ? container
              : (container.querySelector && container.querySelector('iframe'));
            if (iframe) {
              try {
                const srcdoc = iframe.getAttribute && iframe.getAttribute('srcdoc');
                if (srcdoc) {
                  const md = htmlStringToMarkdown(srcdoc);
                  if (md) return md;
                }
              } catch {}

              try {
                const doc = iframe.contentDocument;
                if (doc && doc.body) {
                  const html = doc.body.innerHTML || doc.documentElement.outerHTML || '';
                  const md = htmlStringToMarkdown(html);
                  if (md) return md;
                }
              } catch {}
            }
          } catch {}

          try {
            const md = htmlToMarkdown(container);
            if (md && md.trim()) return md.trim();
          } catch {}

          try {
            try {
              const codeNodes = container.querySelectorAll ? container.querySelectorAll('pre,code,textarea') : [];
              for (const node of Array.from(codeNodes || [])) {
                const codeText = ((node.value || node.textContent || '') + '').trim();
                if (codeText && looksLikeHtmlSource(codeText)) {
                  const md = htmlStringToMarkdown(codeText);
                  if (md && md.trim()) return md.trim();
                }
              }
            } catch {}

            const text = (container.innerText || container.textContent || '').replace(/\\u200B/g, '').trim();
            if (looksLikeHtmlSource(text)) {
              const md = htmlStringToMarkdown(text);
              if (md && md.trim()) return md.trim();
            }
            return text;
          } catch {
            return '';
          }
        }

        const reportSelectors = ${JSON.stringify(selectors.reportContainer || [])};
        if (reportSelectors && reportSelectors.length > 0) {
          function findVisibleElementBySelector(selector) {
            let candidate = null;
            try {
              candidate = document.querySelector(selector);
            } catch {
              candidate = null;
            }
            if (candidate && isElementVisible(candidate)) return candidate;

            const docRoot = document.body || document.documentElement;
            if (!docRoot || !document.createTreeWalker) return null;
            try {
              const walker = document.createTreeWalker(docRoot, NodeFilter.SHOW_ELEMENT);
              let node = walker.currentNode;
              while (node) {
                const el = node;
                if (el && el.shadowRoot) {
                  try {
                    const inShadow = el.shadowRoot.querySelector(selector);
                    if (inShadow && isElementVisible(inShadow)) return inShadow;
                  } catch {}
                }
                node = walker.nextNode();
              }
            } catch {}
            return null;
          }

          let reportRoot = null;
          for (const selector of reportSelectors) {
            const candidate = findVisibleElementBySelector(selector);
            if (candidate) {
              reportRoot = candidate;
              break;
            }
          }

          if (reportRoot) {
            const reportTextLen = ((reportRoot.innerText || reportRoot.textContent || '') + '').replace(/\\u200B/g, '').trim().length;
            const reportHtmlLen = ((reportRoot.innerHTML || '') + '').length;
            if (reportTextLen >= 20 || reportHtmlLen >= 200) {
              const reportMd = extractReportFromContainer(reportRoot);
              if (reportMd && reportMd.trim().length >= 20) {
                return reportMd.trim();
              }
            }
          }
        }
        
        const containerSelectors = Array.from(new Set([
          ...${JSON.stringify(selectors.messageContainer)},
          ...(${JSON.stringify(responseMessageSelectors)}[location.hostname] || [])
        ]));
        let allMatches = [];
        
        function safeQueryAll(root, selector) {
          try {
            return Array.from(root.querySelectorAll(selector));
          } catch {
            return [];
          }
        }
        
        for (const selector of containerSelectors) {
          allMatches.push(...safeQueryAll(document, selector));
        }
        
        if (allMatches.length === 0) {
          const docRoot = document.body || document.documentElement;
          if (docRoot && document.createTreeWalker) {
            const walker = document.createTreeWalker(docRoot, NodeFilter.SHOW_ELEMENT);
            let node = walker.currentNode;
            while (node) {
              const el = node;
              if (el && el.shadowRoot) {
                for (const selector of containerSelectors) {
                  allMatches.push(...safeQueryAll(el.shadowRoot, selector));
                }
              }
              node = walker.nextNode();
            }
          }
        }
        
        if (!allMatches || allMatches.length === 0) {
          return '';
        }
        
        const unique = [];
        const seen = new Set();
        for (const el of allMatches) {
          if (!el || seen.has(el)) continue;
          if (${assistantOnly} && el.closest('textarea,input,[contenteditable="true"],[data-message-author-role="user"],[data-role="user"],[data-testid="user-message"],user-query,.user-query')) continue;
          seen.add(el);
          unique.push(el);
        }
        
        function isVisible(element) {
          try {
            if (!element || !element.isConnected) return false;
            if (!element.getClientRects || element.getClientRects().length === 0) return false;
            const rect = element.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            let cur = element;
            while (cur && cur.nodeType === 1) {
              const style = window.getComputedStyle(cur);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              const opacity = Number(style.opacity || '1');
              if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
              cur = cur.parentElement;
            }
            return true;
          } catch {
            return false;
          }
        }
        
        unique.sort((a, b) => {
          if (a === b) return 0;
          const pos = a.compareDocumentPosition(b);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        
        const disallowedSelector = 'textarea,input,[contenteditable="true"],rich-textarea';
        let lastMessage = null;
        
        for (let i = unique.length - 1; i >= 0; i--) {
          const el = unique[i];
          if (!el) continue;
          if (!isVisible(el)) continue;
          try {
            if (el.matches && el.matches(disallowedSelector)) continue;
            if (el.closest && el.closest(disallowedSelector)) continue;
          } catch {
          }
          const text = ((el.innerText || el.textContent || '') + '').replace(/\\u200B/g, '').trim();
          if (text.length < 2) continue;
          lastMessage = el;
          break;
        }
        
        if (!lastMessage) {
          return '';
        }

        function findMergedContentRoot(el) {
          try {
            let cur = el;
            let steps = 0;
            while (cur && steps < 20) {
              const id = (cur.id || '').trim();
              if (id && /^markdown-content-[0-9]+$/i.test(id)) {
                return cur;
              }
              cur = cur.parentElement;
              steps++;
            }
          } catch {}
          return null;
        }

        // 豆包(Doubao) 多块合并：豆包现在把一条助手回复拆成多个并列的渲染块
        // （每个块形如 <div data-render-engine="node">...<div data-streaming>...），
        // 末块常常只是"需要我帮你…"之类的收尾提示。取"最后一个可见候选"会命中末块
        // 导致只抓到最后一句。这里在选定的 lastMessage 基础上向上找它的"最近公共
        // 祖先"——第一个 querySelectorAll('[data-streaming],.md-box-root') >= 2 的
        // 祖先即为单轮容器。关键：在最近公共祖先层就停，绝不再向上——更上层是跨多轮
        // (含历史对话+用户query)的根容器，爬过去就会把全部对话抓下来。
        // 不做长度守卫：最近公共祖先是"含 >=2 个本回复块的最近祖先"这一数学事实的
        // 直接结果——更近的祖先只含 1 块(末块自己)，所以第一个 >=2 的层就是单轮容器，
        // 跨轮根容器在它之上、永远不会被先命中。豆包每轮 block-v2 容器相互隔离，
        // 末块不会落在一个"本就跨轮"的最近祖先里。
        function findDoubaoMultiBlockRoot(el) {
          try {
            const blockSel = '[data-streaming], .md-box-root';
            let cur = el;
            let steps = 0;
            while (cur && steps < 6) {
              cur = cur.parentElement;
              steps++;
              if (!cur) break;
              let blockCount = 0;
              try {
                blockCount = cur.querySelectorAll(blockSel).length;
              } catch {
                blockCount = 0;
              }
              // 最近公共祖先：第一个 >=2 的层即返回，不再向上。
              if (blockCount >= 2) {
                return cur;
              }
            }
          } catch {}
          return null;
        }

        try {
          const root = findMergedContentRoot(lastMessage);
          if (root && root !== lastMessage) {
            const rootText = ((root.innerText || root.textContent || '') + '').replace(/\\u200B/g, '').trim();
            const lastText = ((lastMessage.innerText || lastMessage.textContent || '') + '').replace(/\\u200B/g, '').trim();
            const childCount = root.children ? root.children.length : 0;
            if (childCount >= 2 && rootText.length >= Math.max(50, Math.floor(lastText.length * 1.5))) {
              lastMessage = root;
            }
          }
        } catch {}

        // 豆包多块合并：若 markdown-content-N 合并未命中，尝试按"多回复块同轮容器"合并
        try {
          const dbRoot = findDoubaoMultiBlockRoot(lastMessage);
          if (dbRoot && dbRoot !== lastMessage) {
            lastMessage = dbRoot;
          }
        } catch {}

        // 尝试将 HTML 转换为 Markdown
        let content = htmlToMarkdown(lastMessage);
        
        // 如果转换结果太短，尝试回退到更前一个候选
        if (content.trim().length < 20) {
          for (let i = unique.length - 2; i >= 0; i--) {
            const el = unique[i];
            if (!el || !isVisible(el)) continue;
            const text = ((el.innerText || el.textContent || '') + '').replace(/\\u200B/g, '').trim();
            if (text.length < 20) continue;
            lastMessage = el;
            content = htmlToMarkdown(lastMessage);
            if (content.trim().length >= 20) break;
          }
        }
        
        // 如果 Markdown 转换效果不好，回退到纯文本
        if (content.trim().length === 0) {
          content = lastMessage.innerText || lastMessage.textContent || '';
        }
        
        ${geminiSources}

        ${qwenSources}

        return content.trim();
      } catch (error) {
        console.error('获取回复失败:', error);
        return '';
      }
    })();
  `
}

export interface MindmapResponse {
  text: string
  source: 'editor' | 'code' | 'message' | 'virtual-dom' | 'empty'
  editorCount: number
  codeCount: number
  messageCount: number
}

/** 导图读取最新助手回复；还原渲染后的标题和列表，兼容已有代码块输出。 */
export function generateMindmapResponseScript(selectors: ModelSelector): string {
  return String.raw`
    (async function () {
      const config = ${JSON.stringify(mindmapCodeSelectors)};
      const tags = ${JSON.stringify(MINDMAP_TAGS)};
      const candidates = new Set();
      for (const selector of [...${JSON.stringify(selectors.messageContainer)}, ...(${JSON.stringify(responseMessageSelectors)}[location.hostname] || []), config.messages]) {
        try {
          for (const el of document.querySelectorAll(selector)) {
            if (el.closest(config.excluded)) continue;
            // 后台窗口不要求消息参与可见布局；只依赖 DOM 连接和助手角色。
            if (!el.isConnected) continue;
            candidates.add(el);
          }
        } catch {}
      }
      const roots = Array.from(candidates).filter(el => !Array.from(candidates).some(other => other !== el && other.contains(el)));
      roots.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const root = roots[roots.length - 1];
      const editors = root ? Array.from(root.querySelectorAll(config.editors)).filter(el => !el.closest(config.excluded)) : [];
      const codes = root ? Array.from(root.querySelectorAll(config.nativeCode)).filter(el => !el.closest(config.excluded) && !el.closest(config.editors) && !el.querySelector(config.editors)) : [];
      const result = (text, source) => ({ text, source, editorCount: editors.length, codeCount: codes.length, messageCount: roots.length });
      const isOutline = text => typeof text === 'string' && (text.includes(tags.begin) || text.includes(tags.end));
      for (const editor of editors) {
        const content = editor.querySelector(config.content);
        for (const node of [content, editor]) {
          if (!node) continue;
          try {
            // 对应 CodeMirror 6 新旧版本的 EditorView.findFromDOM 路径。
            const view = node.cmView?.rootView?.view || node.cmView?.view || node.cmTile?.root?.view;
            const doc = view?.state?.doc;
            if (!doc || typeof doc.toString !== 'function') continue;
            const text = doc.toString();
            if (isOutline(text)) return result(text, 'editor');
          } catch {}
        }
      }
      for (const code of codes) {
        const text = code.textContent || '';
        if (isOutline(text)) return result(text, 'code');
      }
      // 存在虚拟编辑器却没有完整模型时，仅提供诊断，禁止保存可见片段。
      if (editors.length) return result(editors.map(editor => editor.innerText || editor.textContent || '').join('\n'), 'virtual-dom');
      if (root) {
        // 不使用 innerText 拼接整条回复：网页列表缩进与标题标记需要从结构还原。
        const read = (node, depth = 0) => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
          if (node.nodeType !== Node.ELEMENT_NODE || node.matches(config.noise) || node.matches(config.excluded)) return '';
          const tag = node.tagName.toLowerCase();
          if (tag === 'br') return '\n';
          if (tag === 'pre') return '\n' + (node.textContent || '') + '\n';
          if (tag === 'li') {
            let label = '';
            let children = '';
            for (const child of node.childNodes) {
              if (child.nodeType === Node.ELEMENT_NODE && /^(ul|ol)$/i.test(child.tagName)) children += read(child, depth + 1);
              else label += read(child, depth);
            }
            return '\n' + '  '.repeat(depth) + '- ' + label.replace(/\s+/g, ' ').trim() + '\n' + children;
          }
          const content = Array.from(node.childNodes).map(child => read(child, depth)).join('');
          if (/^h[1-6]$/.test(tag)) return '\n' + '#'.repeat(Number(tag[1])) + ' ' + content.replace(/\s+/g, ' ').trim() + '\n';
          if (/^(p|div|section|article|ul|ol|blockquote)$/.test(tag)) return '\n' + content + '\n';
          return content;
        };
        const text = read(root).replace(/\u200B|\uFEFF/g, '').trim();
        return result(text, text ? 'message' : 'empty');
      }
      const text = await ${generateGetLatestResponseScript(selectors, true)};
      return result(text || '', text ? 'message' : 'empty');
    })();
  `
}

/** 把当前 Webview 中已加载的整段对话和选区位置一次性读出。 */
export function generateNoteCaptureScript(): string {
  const markdown = getHtmlToMarkdownScript()
  return String.raw`
    (function () {
      ${markdown}
      const selection = window.getSelection();
      const exact = selection ? selection.toString().trim() : '';
      const roots = Array.from(document.querySelectorAll('main,[role="main"]'));
      const candidates = roots.filter(el => !selection || !selection.rangeCount || el.contains(selection.anchorNode));
      const root = (candidates.length ? candidates : roots).sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0] || document.body;
      const normalized = value => (value || '').replace(/\s+/g, ' ').trim();
      const config = ${JSON.stringify(noteMessageSelectors)}[location.hostname];
      const selectors = config?.messages || '[data-message-author-role],[data-role="user"],[data-role="assistant"]';
      const assistantSelectors = ${JSON.stringify(responseMessageSelectors)}[location.hostname] || [];
      const assistantSelector = assistantSelectors.join(',');
      const isAssistantBody = el => assistantSelectors.some(selector => el.matches(selector));
      const roleOf = el => {
        const container = el.closest(selectors);
        const marker = config?.role === 'tagName' ? el.tagName.toLowerCase() : el.getAttribute(config?.role || 'data-message-author-role') || el.getAttribute('data-role') || el.getAttribute('data-turn') || container?.getAttribute(config?.role || 'data-message-author-role') || container?.getAttribute('data-role') || container?.getAttribute('data-turn') || '';
        if (/user|human|query/i.test(marker)) return '提问';
        if (/assistant|model|response/i.test(marker)) return 'AI 回复';
        return isAssistantBody(el) ? 'AI 回复' : '';
      };
      const messageCandidates = Array.from(document.querySelectorAll([selectors, ...assistantSelectors].join(','))).filter(el => root.contains(el) && normalized(el.textContent) && roleOf(el));
      // 一轮的 section、角色容器和正文可能同时命中，保留外层同角色轮次，防止重复快照。
      const messages = messageCandidates.filter(el => !messageCandidates.some(other => other !== el && other.contains(el) && roleOf(other) === roleOf(el)));
      const clean = el => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('button,nav,script,style,textarea,input,[contenteditable="true"],[aria-hidden="true"],.sr-only').forEach(node => node.remove());
        return copy;
      };
      const safeMarkdown = el => {
        try {
          const markdown = htmlToMarkdown(clean(el)).trim();
          return markdown || (el.innerText || el.textContent || '').trim();
        }
        catch { return (el.innerText || el.textContent || '').trim(); }
      };
      const stripRoleHeaders = (text, isUser) => {
        let lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
        if (isUser) {
          while (lines.length && /^(?:昨天|今天|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})?\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/.test(lines[0].trim())) {
            lines.shift();
          }
          if (lines.length && /^(?:#{1,4}\s*)?(?:\*\*)?(?:你说|用户|我|User|Human|You said)(?:\*\*)?\s*[:：]?\s*/i.test(lines[0].trim())) {
            lines[0] = lines[0].replace(/^(?:#{1,4}\s*)?(?:\*\*)?(?:你说|用户|我|User|Human|You said)(?:\*\*)?\s*[:：]?\s*/i, '');
          }
        } else {
          if (lines.length && /^(?:#{1,4}\s*)?(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]?\s*/i.test(lines[0].trim())) {
            lines[0] = lines[0].replace(/^(?:#{1,4}\s*)?(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]?\s*/i, '');
          }
          if (lines.length && /^#{1,4}\s*AI\s*回复\s*$/i.test(lines[0].trim())) {
            lines.shift();
          }
        }
        return lines.join('\n').trim();
      };
      const blocks = messages.map(el => {
        const timeEl = el.querySelector('time') || el.closest('[data-testid^="conversation-turn-"]')?.querySelector('time');
        const time = timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : '';
        const role = roleOf(el);
        // 新版助手轮次只取正文，避免把反馈问卷或操作区混入对话。
        const bodies = role === 'AI 回复' && assistantSelector && !isAssistantBody(el) ? Array.from(el.querySelectorAll(assistantSelector)) : [];
        const uniqueBodies = bodies.filter(body => !bodies.some(other => other !== body && other.contains(body)));
        const content = uniqueBodies.length ? uniqueBodies.map(safeMarkdown).join('\n\n') : safeMarkdown(el);
        return { role, content, time };
      }).filter(item => item.role && item.content);
      const snapshot = blocks.length && blocks.some(item => item.role === '提问') && blocks.some(item => item.role === 'AI 回复')
        ? blocks.map(item => {
            if (item.role === '提问') {
              const cleanContent = stripRoleHeaders(item.content, true);
              const timeAttr = item.time ? ' time="' + item.time + '"' : '';
              return '<user' + timeAttr + '>\n' + cleanContent + '\n</user>';
            }
            const cleanContent = stripRoleHeaders(item.content, false);
            return '<assistant>\n' + cleanContent + '\n</assistant>';
          }).join('\n\n')
        : safeMarkdown(root);
      const raw = root.textContent || '';
      const selectionRect = selection && selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      let at = -1;
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let offset = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node === range.startContainer) { at = offset + range.startOffset; break; }
          offset += node.textContent?.length || 0;
        }
      }
      if (at < 0) at = exact ? raw.indexOf(exact) : -1;
      return {
        title: document.title || location.hostname,
        url: location.href,
        snapshot,
        sourceContains: normalized(root.innerText || root.textContent).includes(normalized(exact)),
        rect: selectionRect ? { left: selectionRect.left, top: selectionRect.top, right: selectionRect.right, bottom: selectionRect.bottom } : null,
        anchor: {
          exact,
          prefix: at >= 0 ? raw.slice(Math.max(0, at - 80), at) : '',
          suffix: at >= 0 ? raw.slice(at + exact.length, at + exact.length + 80) : ''
        }
      };
    })();
  `
}

/** 导图后台任务仅采集就绪/生成信号，不返回或打印对话正文。 */
export function generateMindmapPageStateScript(selectors: ModelSelector, platformId: string): string {
  return `(function () {
    const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const find = list => list.some(selector => { try { return Array.from(document.querySelectorAll(selector)).some(visible); } catch { return false; } });
    const stops = ${JSON.stringify(generationStopSelectors[platformId] || [])};
    const genericStops = ['button[aria-label*="Stop"]', 'button[aria-label*="停止"]', 'button[data-testid="stop-button"]'];
    // 已适配平台只使用确切的停止生成控件，避免误命中停止朗读等按钮。
    const busy = find(stops.length ? stops : genericStops);
    return { ready: find(${JSON.stringify(selectors.textarea)}), busy };
  })();`
}

/** 在原网页上恢复笔记高亮；仅使用 CSS Highlight，避免改动第三方页面的文本 DOM。 */
export function generateNoteHighlightScript(
  notes: Array<{ id: string; anchor: { exact: string; prefix: string; suffix: string } }>,
  focusedNoteId?: string
): string {
  return String.raw`
    (function () {
      if (!CSS.highlights || !window.Highlight) return { matched: 0, supported: false };
      const notes = ${JSON.stringify(notes)};
      const focusedId = ${JSON.stringify(focusedNoteId ?? '')};
      window.__multichatNoteDispose?.();
      const compact = value => (value || '').replace(/\s/g, '');
      const roots = Array.from(document.querySelectorAll('main,[role="main"]'));
      const root = roots.find(el => notes.some(note => note.anchor.exact && compact(el.textContent).includes(compact(note.anchor.exact)))) || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,noscript,nav,aside,header,footer,button,textarea,input,[contenteditable="true"]')) continue;
        if (!node.textContent) continue;
        nodes.push({ node, start: text.length, end: text.length + node.textContent.length });
        text += node.textContent;
      }
      const locate = offset => {
        const part = nodes.find(item => item.start <= offset && offset < item.end) || nodes[nodes.length - 1];
        return part ? { node: part.node, offset: Math.min(offset - part.start, part.node.textContent.length) } : null;
      };
      const ranges = [];
      const targets = [];
      let focused = null;
      for (const note of notes) {
        const exact = note.anchor.exact;
        if (!exact) continue;
        let match = -1;
        let score = -1;
        let at = text.indexOf(exact);
        while (at >= 0) {
          const prefix = note.anchor.prefix || '';
          const suffix = note.anchor.suffix || '';
          const before = text.slice(Math.max(0, at - prefix.length), at);
          const after = text.slice(at + exact.length, at + exact.length + suffix.length);
          const candidateScore = (prefix && before === prefix ? 2 : 0) + (suffix && after === suffix ? 2 : 0);
          if (candidateScore > score) { match = at; score = candidateScore; }
          at = text.indexOf(exact, at + exact.length);
        }
        let matchEnd = match + exact.length;
        if (match < 0) {
          const target = compact(exact);
          const offsets = [];
          let searchable = '';
          for (let i = 0; i < text.length; i++) {
            if (/\s/.test(text[i])) continue;
            offsets.push(i);
            searchable += text[i];
          }
          const compactAt = searchable.indexOf(target);
          if (compactAt >= 0 && target.length) {
            match = offsets[compactAt];
            matchEnd = offsets[compactAt + target.length - 1] + 1;
          }
        }
        if (match < 0) continue;
        const start = locate(match);
        const end = locate(matchEnd - 1);
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset + 1);
        ranges.push(range);
        targets.push({ id: note.id, range });
        if (note.id === focusedId) focused = range;
      }
      CSS.highlights.set('multichat-notes', new Highlight(...ranges));
      CSS.highlights.set('multichat-note-focus', new Highlight(...(focused ? [focused] : [])));
      const onClick = event => {
        let hitNote = false;
        for (const item of targets) {
          const hit = Array.from(item.range.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
          if (!hit) continue;
          hitNote = true;
          event.preventDefault();
          event.stopPropagation();
          console.info(${JSON.stringify(NOTE_CLICK_PREFIX)} + JSON.stringify({ id: item.id, x: event.clientX, y: event.clientY }));
          break;
        }
        if (!hitNote) {
          console.info(${JSON.stringify(NOTE_DISMISS_PREFIX)});
        }
      };
      document.addEventListener('click', onClick, true);
      window.__multichatNoteDispose = () => document.removeEventListener('click', onClick, true);
      if (focused) focused.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return { matched: ranges.length, supported: true };
    })();
  `
}

/**
 * 注入网络响应拦截脚本（策略三）
 * 通过重写 fetch 和 XHR，在控制台抛出 'NETWORK_RESPONSE:' 前缀的消息
 *
 * ⚠️ 性能注意：该脚本会把每个 fetch/XHR 的完整响应体通过 console.log
 * 输出（含 AI 平台动辄数十 KB 的 JSON），在生产环境会导致主进程控制台
 * 缓冲区与内存稳步上涨。因此仅允许在 dev 模式注入；主进程的
 * console-message 处理器也会显式丢弃 NETWORK_RESPONSE 前缀消息作为兜底。
 */
export function getNetworkSnifferScript(): string {
  // 仅 dev 环境允许注入；生产环境直接返回空脚本，避免内存泄漏
  if (!IS_DEV) return ''
  return `
    (function() {
      if (window.__sniffer_injected) return;
      window.__sniffer_injected = true;
      var originalFetch = window.fetch;
      window.fetch = async function(...args) {
        var response = await originalFetch.apply(this, args);
        var clone = response.clone();
        clone.text().then(function(text) {
          try {
            var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : 'unknown');
            console.log('NETWORK_RESPONSE: ' + JSON.stringify({ url: url, body: text, type: 'fetch' }));
          } catch(e) {}
        }).catch(function(e) {});
        return response;
      };

      var originalXhrOpen = XMLHttpRequest.prototype.open;
      var originalXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this._sniffer_url = url;
        return originalXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
          try {
            console.log('NETWORK_RESPONSE: ' + JSON.stringify({ url: this._sniffer_url, body: this.responseText, type: 'xhr' }));
          } catch(e) {}
        });
        return originalXhrSend.apply(this, arguments);
      };
    })();
  `;
}
