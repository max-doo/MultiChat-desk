/**
 * 千问深度研究报告内容提取工具
 *
 * 用户打开报告页后，兼容宽屏工具栏直显复制按钮，以及窄屏三点菜单内的复制按钮，
 * 通过模拟真实鼠标 Hover / 点击获取报告内容
 * 来获取报告内容（Markdown/HTML 格式），再转换为 Markdown。
 *
 * 适应最新千问 UI 交互：Hover 触发菜单 (more-menu) -> 弹出复制选项 (more-menu-item)。
 */

import TurndownService from 'turndown'

interface WebviewAPI {
  executeJavaScript: (script: string) => Promise<any>
  getWebContentsId: () => number
}

interface WindowAPI {
  readClipboardText?: () => Promise<string>
  readClipboardHTML?: () => Promise<string>
  sendMouseClick?: (
    webContentsId: number,
    x: number,
    y: number
  ) => Promise<{ success: boolean; error?: string }>
  sendMouseMove?: (
    webContentsId: number,
    x: number,
    y: number
  ) => Promise<{ success: boolean; error?: string }>
}

interface CopyButtonResult {
  found: boolean
  pos?: { x: number; y: number }
  triggerPos?: { x: number; y: number }
  needHover?: boolean
  source?: string
}

interface ClipboardSnapshot {
  text: string
  html: string
}

interface QwenDomReportResult {
  text: string
  html: string
}

// ========== 注入到 Webview 的检测与 Hover 脚本 ==========

/**
 * 检测复制按钮或 Hover 触发区域
 */
const FIND_REPORT_ACTION_SCRIPT = `
  (function() {
    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getCenter(el) {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function normalizeText(value) {
      return (value || '').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').trim().replace(/\\s+/g, ' ');
    }

    function getVisibleText(el) {
      return normalizeText(typeof el.innerText === 'string' ? el.innerText : el.textContent);
    }

    function isExactCopyText(value) {
      return /^(复制|复制报告|复制内容|复制全文|copy|copy(content|report|all))$/i.test(normalizeText(value).replace(/\\s+/g, ''));
    }

    function isCopyAction(el) {
      if (el.tagName && el.tagName.toLowerCase() === 'svg') return false;
      const text = getVisibleText(el);
      const ariaLabel = normalizeText(el.getAttribute('aria-label') || '');
      const title = normalizeText(el.getAttribute('title') || '');
      const className = typeof el.className === 'string' ? el.className : '';
      const labels = [
        text,
        ariaLabel,
        title
      ];
      if (!labels.some(isExactCopyText) && !(className && /复制|copy/i.test(className) && !text)) return false;
      if (text && !isExactCopyText(text) && !isExactCopyText(ariaLabel) && !isExactCopyText(title)) return false;

      // 菜单根节点会包含“复制报告 / 导出为 Word / 导出为 PDF”全部文本，
      // 只保留没有更深层复制文本节点的最小可点击元素。
      const descendants = el.querySelectorAll('*');
      for (const descendant of descendants) {
        if (isExactCopyText(descendant.textContent)) return false;
      }
      return true;
    }

    function isDirectCopyIcon(el) {
      // 宽屏顶部工具栏的复制图标没有 aria-label/text，当前真实 DOM 使用带 fill-rule 的双页 SVG。
      return isCopyAction(el) || !!el.querySelector('svg path[fill-rule="evenodd"]');
    }

    // 1. 先检索当前 DOM 中是否已经存在并显示了复制菜单项
    const itemSelectors = [
      '[role="menuitem"]',
      '[class*="more-menu-item"]',
      'div[class*="more-menu"] [class*="more-menu-item"]',
      '[class*="more-menu-label"]',
      'span.more-menu-label-r0QSLw',
      '[class*="copy"]'
    ];

    for (const sel of itemSelectors) {
      let elements = [];
      try { elements = Array.from(document.querySelectorAll(sel)); } catch (_) {}
      for (const el of elements) {
        if (!isVisible(el)) continue;
        if (isCopyAction(el)) {
          return { found: true, pos: getCenter(el), needHover: false };
        }
      }
    }

    // 宽屏复制图标没有文本，按真实 SVG 语义识别；窄屏的 item-icon 则是三点菜单触发器。
    const directCopySelectors = [
      '#qianwen-layout-right-panel [class*="right-tools"] [class*="item-icon"]:has(svg path[fill-rule="evenodd"])',
      '#qianwen-layout-right-panel [aria-label*="复制"]',
      '#qianwen-layout-right-panel [title*="复制"]',
      '#qianwen-layout-right-panel [data-testid*="copy"]',
      '#qianwen-layout-right-panel [data-action*="copy"]',
      '#qianwen-layout-right-panel [class*="copy"]'
    ];
    for (const sel of directCopySelectors) {
      let elements = [];
      try { elements = Array.from(document.querySelectorAll(sel)); } catch (_) {}
      for (const el of elements) {
        if (isVisible(el) && isDirectCopyIcon(el)) {
          return { found: true, pos: getCenter(el), needHover: false };
        }
      }
    }

    // 2. 如果复制菜单项不可见，寻找 Hover 触发器
    const triggerSelectors = [
      '#qianwen-layout-right-panel [class*="right-tools"] [class*="item-icon"]:has(svg[width="12"][height="2"])',
      '#qianwen-layout-right-panel [class*="item-icon"]:has(svg[width="12"][height="2"])',
      'div.more-menu-sEYwbh',
      '[class*="more-menu-trigger"]',
      '[class*="more-trigger"]',
      '#qianwen-layout-right-panel [class*="right-tools"] [class*="item-icon"]',
      '#qianwen-layout-right-panel [class*="item-icon"]'
    ];

    for (const sel of triggerSelectors) {
      let elements = [];
      try { elements = Array.from(document.querySelectorAll(sel)); } catch (_) {}
      for (const el of elements) {
        if (!isVisible(el)) continue;
        // 在 DOM 中对触发元素分发悬停事件
        try {
          const center = getCenter(el);
          const opts = { bubbles: true, cancelable: true, view: window, clientX: center.x, clientY: center.y };
          el.dispatchEvent(new MouseEvent('pointerover', opts));
          el.dispatchEvent(new MouseEvent('pointerenter', opts));
          el.dispatchEvent(new MouseEvent('mouseover', opts));
          el.dispatchEvent(new MouseEvent('mouseenter', opts));
          el.dispatchEvent(new MouseEvent('mousemove', opts));
        } catch (_) {}
        return { found: false, triggerPos: getCenter(el), needHover: true };
      }
    }

    return { found: false };
  })();
`

/**
 * Hover 后二次检测复制菜单项位置
 */
const HOVER_AND_RECHECK_SCRIPT = `
  (function() {
    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getCenter(el) {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function normalizeText(value) {
      return (value || '').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').trim().replace(/\\s+/g, ' ');
    }

    function getVisibleText(el) {
      return normalizeText(typeof el.innerText === 'string' ? el.innerText : el.textContent);
    }

    function isExactCopyText(value) {
      return /^(复制|复制报告|复制内容|复制全文|copy|copy(content|report|all))$/i.test(normalizeText(value).replace(/\\s+/g, ''));
    }

    function isCopyAction(el) {
      if (el.tagName && el.tagName.toLowerCase() === 'svg') return false;
      const text = getVisibleText(el);
      const ariaLabel = normalizeText(el.getAttribute('aria-label') || '');
      const title = normalizeText(el.getAttribute('title') || '');
      const className = typeof el.className === 'string' ? el.className : '';
      const labels = [
        text,
        ariaLabel,
        title
      ];
      if (!labels.some(isExactCopyText) && !(className && /复制|copy/i.test(className) && !text)) return false;
      if (text && !isExactCopyText(text) && !isExactCopyText(ariaLabel) && !isExactCopyText(title)) return false;

      // 菜单根节点会包含“复制报告 / 导出为 Word / 导出为 PDF”全部文本，
      // 只保留没有更深层复制文本节点的最小可点击元素。
      const descendants = el.querySelectorAll('*');
      for (const descendant of descendants) {
        if (isExactCopyText(descendant.textContent)) return false;
      }
      return true;
    }

    const itemSelectors = [
      '[role="menuitem"]',
      '[class*="more-menu-item"]',
      'div[class*="more-menu"] [class*="more-menu-item"]',
      '[class*="more-menu-label"]',
      'span.more-menu-label-r0QSLw',
      '[class*="copy"]'
    ];

    for (const sel of itemSelectors) {
      let elements = [];
      try { elements = Array.from(document.querySelectorAll(sel)); } catch (_) {}
      for (const el of elements) {
        if (!isVisible(el)) continue;
        if (isCopyAction(el)) {
          return { found: true, pos: getCenter(el) };
        }
      }
    }

    // 兜底：查找所有可见的最小复制菜单项，不能把包含三个菜单项的菜单根节点当成复制按钮。
    const allMenuNodes = Array.from(document.querySelectorAll('*'))
      .filter((el) => isVisible(el) && isCopyAction(el))
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
    for (const el of allMenuNodes) {
      if (!isVisible(el)) continue;
      if (isCopyAction(el)) {
        return { found: true, pos: getCenter(el), source: 'visible-copy-text' };
      }
    }

    // 极端情况下菜单节点由 Portal/Shadow DOM 生成，普通选择器可能拿不到文本；
    // 在三点触发器左下方扫描真实命中节点，仍然只接受“复制报告”文本。
    const trigger = Array.from(document.querySelectorAll('#qianwen-layout-right-panel [class*="item-icon"]'))
      .find((el) => isVisible(el) && !!el.querySelector('svg[width="12"][height="2"]'));
    if (trigger && trigger.matches(':hover')) {
      const triggerRect = trigger.getBoundingClientRect();
      for (let y = triggerRect.bottom + 8; y <= triggerRect.bottom + 220; y += 8) {
        for (let x = Math.max(0, triggerRect.left - 220); x <= triggerRect.right + 8; x += 8) {
          const hit = document.elementsFromPoint(x, y);
          for (const node of hit) {
            if (!isVisible(node)) continue;
            const text = getVisibleText(node);
            const ariaLabel = normalizeText(node.getAttribute('aria-label') || '');
            const title = normalizeText(node.getAttribute('title') || '');
            if (isExactCopyText(text) || isExactCopyText(ariaLabel) || isExactCopyText(title)) {
              return { found: true, pos: getCenter(node), source: 'elements-from-point' };
            }
          }
        }
      }

      // 菜单的真实布局是触发器右对齐、第一行位于触发器下方约一行高度处。
      // 仅在确认鼠标仍停留在三点触发器上时使用，避免点击报告正文。
      return {
        found: true,
        pos: {
          x: triggerRect.right - 76,
          y: triggerRect.bottom + 40
        },
        source: 'hover-menu-coordinate-fallback'
      };
    }

    return { found: false };
  })();
`

/**
 * 剪贴板写入失败时，尝试从当前报告 iframe/报告根节点直接读取内容。
 * 跨域 iframe 会被浏览器拒绝访问，此时返回空值并交给上层普通回退逻辑处理。
 */
const QWEN_REPORT_DOM_FALLBACK_SCRIPT = `
  (function() {
    function readRoot(root) {
      if (!root) return { text: '', html: '' };
      try {
        if (root.tagName && root.tagName.toLowerCase() === 'iframe') {
          const doc = root.contentDocument;
          if (!doc || !doc.body) return { text: '', html: '' };
          return {
            text: (doc.body.innerText || doc.body.textContent || '').trim(),
            html: (doc.body.innerHTML || '').trim()
          };
        }
        return {
          text: (root.innerText || root.textContent || '').trim(),
          html: (root.innerHTML || '').trim()
        };
      } catch (_) {
        return { text: '', html: '' };
      }
    }

    const selectors = [
      '#qianwen-layout-right-panel iframe#deep-research-iframe',
      'iframe#deep-research-iframe',
      '#pc-report-container',
      '#qk-markdown-react',
      '.markdown-text-container',
      '[class*="pc-report-container"]',
      '[class*="pc-report-wrap"]'
    ];

    for (const selector of selectors) {
      let roots = [];
      try { roots = Array.from(document.querySelectorAll(selector)); } catch (_) {}
      for (const root of roots) {
        const result = readRoot(root);
        if (result.text.length > 50 || result.html.length > 200) return result;
      }
    }

    return { text: '', html: '' };
  })();
`

// ========== 主函数 ==========

/**
 * 从千问深度研究报告页提取内容
 *
 * @param webview    - Webview 实例
 * @param windowApi  - Window API（readClipboardHTML / readClipboardText / sendMouseClick / sendMouseMove）
 * @param turndownService - Turndown 实例，用于 HTML 转 Markdown
 * @returns Promise<string | null> - 提取的 Markdown 内容；未检测到报告页或复制失败则返回 null
 */
export async function extractQwenReportContent(
  webview: WebviewAPI,
  windowApi: WindowAPI,
  turndownService: TurndownService
): Promise<string | null> {
  try {
    const webContentsId = webview.getWebContentsId()
    console.log('[QwenReportExtractor] webContentsId:', webContentsId)

    // 1. 查找复制按钮或 Hover 触发点
    const checkResult = (await webview.executeJavaScript(
      FIND_REPORT_ACTION_SCRIPT
    )) as CopyButtonResult
    console.log('[QwenReportExtractor] 初始检测结果:', JSON.stringify(checkResult))

    let copyPos = checkResult?.pos
    let copyPosNeedsMouseMove = false

    // 2. 如果需要 Hover，发送鼠标移动事件并重新查找复制按钮
    if (!copyPos && checkResult?.needHover && checkResult?.triggerPos) {
      const { x, y } = checkResult.triggerPos
      console.log('[QwenReportExtractor] 悬停触发器位置:', JSON.stringify({ x, y }))
      if (windowApi.sendMouseMove) {
        await windowApi.sendMouseMove(webContentsId, x, y)
      }
      // 等待 Hover 动画与 React 菜单组件挂载
      await new Promise((r) => setTimeout(r, 200))

      const recheck = (await webview.executeJavaScript(
        HOVER_AND_RECHECK_SCRIPT
      )) as CopyButtonResult
      console.log('[QwenReportExtractor] Hover 后二次检测结果:', JSON.stringify(recheck))
      if (recheck?.found && recheck?.pos) {
        copyPos = recheck.pos
        copyPosNeedsMouseMove = true
      }
    }

    if (!copyPos) {
      console.log('[QwenReportExtractor] 未找到复制按钮，回退到 DOM 爬取')
      return null
    }

    const readClipboardSnapshot = async (): Promise<ClipboardSnapshot> => {
      const textPromise = windowApi.readClipboardText
        ? windowApi.readClipboardText().catch(() => '')
        : Promise.resolve('')
      const htmlPromise = windowApi.readClipboardHTML
        ? windowApi.readClipboardHTML().catch(() => '')
        : Promise.resolve('')
      const [text, html] = await Promise.all([textPromise, htmlPromise])
      return { text, html }
    }

    // 3. 记录复制前的剪贴板内容，避免把旧内容误当作本次报告。
    const clipboardBefore = await readClipboardSnapshot()
    console.log('[QwenReportExtractor] 复制前剪贴板长度:', JSON.stringify({
      text: clipboardBefore.text.length,
      html: clipboardBefore.html.length
    }))

    // 4. 模拟真实鼠标点击复制按钮
    if (!windowApi.sendMouseClick) {
      console.error('[QwenReportExtractor] sendMouseClick API 不可用')
      return null
    }

    const { x, y } = copyPos

    // 窄屏菜单项需要先获得真实鼠标悬停状态，再发送 mouseDown/mouseUp；
    // 仅在菜单项坐标直接发送 click 时，千问不会触发复制逻辑和成功 Toast。
    if (copyPosNeedsMouseMove && windowApi.sendMouseMove) {
      const moveResult = await windowApi.sendMouseMove(webContentsId, x, y)
      console.log('[QwenReportExtractor] 移动到菜单复制项结果:', JSON.stringify(moveResult))
      if (!moveResult?.success) {
        console.warn('[QwenReportExtractor] 无法移动到菜单复制项')
        return null
      }
      await new Promise((r) => setTimeout(r, 80))
    }

    console.log('[QwenReportExtractor] 点击复制按钮，位置:', JSON.stringify({ x, y }))
    const clickResult = await windowApi.sendMouseClick(webContentsId, x, y)
    console.log('[QwenReportExtractor] 点击结果:', JSON.stringify(clickResult))

    if (!clickResult?.success) {
      console.warn('[QwenReportExtractor] 点击失败')
      return null
    }

    // 5. 短轮询剪贴板，等待千问异步写入长报告完成。
    // 若用户重复复制同一份报告，剪贴板内容可能与点击前完全相同，不能仅按“内容变化”判定失败。
    const normalizeClipboardValue = (value: string): string => value.replace(/\u200B/g, '').trim()
    const isUsableClipboard = (value: string): boolean => normalizeClipboardValue(value).length > 50
    const isSameClipboardValue = (value: string, previous: string): boolean => {
      const normalized = normalizeClipboardValue(value)
      const previousNormalized = normalizeClipboardValue(previous)
      return Boolean(normalized && previousNormalized && normalized === previousNormalized)
    }
    const convertHtml = (html: string): string => {
      if (!isUsableClipboard(html)) return ''
      try {
        return turndownService.turndown(html).trim()
      } catch (e) {
        console.warn('[QwenReportExtractor] HTML 转 Markdown 失败:', String(e))
        return ''
      }
    }

    const pollingDelays = [100, 150, 200, 250, 300, 400]
    let sameClipboardReads = 0
    for (let attempt = 0; attempt < pollingDelays.length; attempt++) {
      await new Promise((r) => setTimeout(r, pollingDelays[attempt]))
      const snapshot = await readClipboardSnapshot()
      const htmlChanged = isUsableClipboard(snapshot.html) && !isSameClipboardValue(snapshot.html, clipboardBefore.html)
      const textChanged = isUsableClipboard(snapshot.text) && !isSameClipboardValue(snapshot.text, clipboardBefore.text)
      const sameUsableClipboard = isSameClipboardValue(snapshot.html, clipboardBefore.html) || isSameClipboardValue(snapshot.text, clipboardBefore.text)
      sameClipboardReads = sameUsableClipboard ? sameClipboardReads + 1 : 0
      console.log('[QwenReportExtractor] 剪贴板轮询:', JSON.stringify({
        attempt: attempt + 1,
        text: snapshot.text.length,
        html: snapshot.html.length,
        textChanged,
        htmlChanged,
        sameClipboardReads
      }))

      if (htmlChanged) {
        const markdown = convertHtml(snapshot.html)
        if (markdown.length > 50) {
          console.log('[QwenReportExtractor] ✓ 从 HTML 转换 Markdown，长度:', markdown.length)
          return markdown
        }
      }

      if (textChanged) {
        console.log('[QwenReportExtractor] ✓ 使用纯文本备选，长度:', snapshot.text.length)
        return normalizeClipboardValue(snapshot.text)
      }

      // 点击已成功且连续两次读到与点击前相同的有效长内容，视为重复复制同一报告。
      if (attempt >= 2 && sameClipboardReads >= 2) {
        const markdown = convertHtml(snapshot.html)
        if (markdown.length > 50) return markdown
        if (isUsableClipboard(snapshot.text)) return normalizeClipboardValue(snapshot.text)
      }
    }

    // 6. 剪贴板仍无有效内容时，立即尝试当前报告 DOM，避免无意义地等待数秒。
    try {
      const domResult = (await webview.executeJavaScript(
        QWEN_REPORT_DOM_FALLBACK_SCRIPT
      )) as QwenDomReportResult
      console.log('[QwenReportExtractor] DOM 回退结果:', JSON.stringify({
        text: domResult?.text?.length ?? 0,
        html: domResult?.html?.length ?? 0
      }))
      const domMarkdown = convertHtml(domResult?.html || '')
      if (domMarkdown.length > 50) return domMarkdown
      if (isUsableClipboard(domResult?.text || '')) return normalizeClipboardValue(domResult.text)
    } catch (e) {
      console.warn('[QwenReportExtractor] DOM 回退失败:', String(e))
    }

    console.warn('[QwenReportExtractor] 剪贴板与 DOM 均无有效内容，回退到上层 DOM 爬取')
    return null
  } catch (error) {
    console.error('[QwenReportExtractor] 提取失败:', error)
    return null
  }
}
