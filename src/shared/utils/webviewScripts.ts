/**
 * Webview 注入脚本工具
 * 将原本内联在 WebviewCard 中的注入脚本抽取到此文件，方便维护和修改
 */

import type { ModelSelector } from '../config/selectors'
import { getHtmlToMarkdownScript } from './htmlToMarkdown'

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

        for (let attempt = 0; attempt < 4 && !inserted; attempt++) {
          try {
            textarea.focus();
            if (textarea.click) textarea.click();
          } catch (e) {}

          await new Promise(resolve => setTimeout(resolve, 30));

          let execOk = false;
          if (document.execCommand) {
            try {
              document.execCommand('selectAll', false, null);
              document.execCommand('delete', false, null);
              execOk = document.execCommand('insertText', false, expectedText);
            } catch (e) {}
          }

          if (!execOk) {
            setSlateDomValue(expectedText);
          }

          dispatchSlateValueEvents(expectedText);

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
        
        // 设置值（兼容 contenteditable 和 textarea）
        ${contentEditableInput}
        ${textareaInput}
        else {
          // 尝试通用方法
          const textNode = document.createTextNode(messageText);
          textarea.appendChild(textNode);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
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
 * 生成获取最新回复的注入脚本
 * 将 HTML 内容转换为 Markdown 格式
 * @param selectors 选择器配置
 */
export function generateGetLatestResponseScript(selectors: ModelSelector): string {
  // 获取 HTML 转 Markdown 的函数定义
  const htmlToMarkdownScript = getHtmlToMarkdownScript()
  const findSourceList = buildFindSourceListFunction()
  const geminiSources = buildGeminiSourceLinksScript()

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
        
        const containerSelectors = ${JSON.stringify(selectors.messageContainer)};
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
        
        return content.trim();
      } catch (error) {
        console.error('获取回复失败:', error);
        return '';
      }
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
