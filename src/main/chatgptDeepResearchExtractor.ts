import type { WebContents } from 'electron'

const DEEP_RESEARCH_FRAME_HOST = 'connector_openai_deep_research.web-sandbox.oaiusercontent.com'
const MAX_REPORT_HTML_LENGTH = 5 * 1024 * 1024

interface CdpTargetInfo {
  targetId: string
  type: string
  url: string
}

interface CdpTargetListResult {
  targetInfos: CdpTargetInfo[]
}

interface CdpAttachResult {
  sessionId: string
}

interface CdpEvaluateResult {
  result: {
    value?: unknown
    description?: string
  }
  exceptionDetails?: unknown
}

export interface ChatgptDeepResearchReport {
  html: string
  title: string
  frameUrl: string
  textLength: number
}

export interface ChatgptDeepResearchExtractionResult {
  success: boolean
  data?: ChatgptDeepResearchReport
  error?: string
}

const REPORT_EXTRACTION_EXPRESSION = `
  (function() {
    function isVisible(element) {
      try {
        if (!element || !element.isConnected) return false;
        var rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        var style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.01;
      } catch (_error) {
        return false;
      }
    }

    var headings = Array.from(document.querySelectorAll('main h1')).filter(isVisible);
    if (headings.length === 0) {
      return { success: false, error: 'Deep Research 报告标题尚未出现' };
    }

    var titleElement = headings[0];
    var current = titleElement.parentElement;
    var reportRoot = null;
    var steps = 0;

    while (current && current !== document.body && steps < 10) {
      var text = ((current.innerText || current.textContent || '') + '').replace(/\\u200B/g, '').trim();
      var structureCount = 0;
      try {
        structureCount = current.querySelectorAll('h2,h3,p,table,pre,ul,ol,blockquote').length;
      } catch (_error) {
        structureCount = 0;
      }
      if (text.length >= 500 && structureCount >= 3) {
        reportRoot = current;
        break;
      }
      current = current.parentElement;
      steps++;
    }

    if (!reportRoot) {
      return { success: false, error: 'Deep Research 报告正文尚未完整渲染' };
    }

    var clone = reportRoot.cloneNode(true);
    try {
      clone.querySelectorAll([
        'script',
        'style',
        'noscript',
        '[role="menu"]',
        'button[aria-label="导出"]',
        'button[aria-label="Export"]',
        'button[aria-label="展开"]',
        'button[aria-label="Expand"]'
      ].join(',')).forEach(function(node) { node.remove(); });
    } catch (_error) {}

    var html = (clone.innerHTML || '').trim();
    var title = ((titleElement.innerText || titleElement.textContent || '') + '').trim();
    var textLength = ((reportRoot.innerText || reportRoot.textContent || '') + '').replace(/\\u200B/g, '').trim().length;

    if (html.length < 200 || textLength < 200) {
      return { success: false, error: 'Deep Research 报告内容过短' };
    }

    return {
      success: true,
      html: html,
      title: title,
      frameUrl: window.location.href,
      textLength: textLength
    };
  })();
`

const pendingExtractions = new Map<number, Promise<ChatgptDeepResearchExtractionResult>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseReportValue(value: unknown): ChatgptDeepResearchExtractionResult {
  if (!isRecord(value)) {
    return { success: false, error: 'Deep Research frame 返回了无效结果' }
  }
  if (value.success !== true) {
    return {
      success: false,
      error: typeof value.error === 'string' ? value.error : 'Deep Research 报告尚不可读取'
    }
  }

  const html = typeof value.html === 'string' ? value.html : ''
  const title = typeof value.title === 'string' ? value.title : ''
  const frameUrl = typeof value.frameUrl === 'string' ? value.frameUrl : ''
  const textLength = typeof value.textLength === 'number' ? value.textLength : 0

  if (!html || html.length > MAX_REPORT_HTML_LENGTH) {
    return {
      success: false,
      error: html.length > MAX_REPORT_HTML_LENGTH ? 'Deep Research 报告超过 5 MB 安全上限' : 'Deep Research 报告 HTML 为空'
    }
  }

  return {
    success: true,
    data: { html, title, frameUrl, textLength }
  }
}

async function runExtraction(webContents: WebContents): Promise<ChatgptDeepResearchExtractionResult> {
  let attachedByUs = false
  let childSessionId: string | null = null

  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3')
      attachedByUs = true
    }

    let target: CdpTargetInfo | undefined
    for (let attempt = 0; attempt < 5 && !target; attempt++) {
      const targets = await webContents.debugger.sendCommand('Target.getTargets') as CdpTargetListResult
      target = targets.targetInfos.find((item) =>
        item.url.includes(DEEP_RESEARCH_FRAME_HOST) && (item.type === 'iframe' || item.type === 'page')
      )
      if (!target && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 150))
      }
    }

    if (!target) {
      return { success: false, error: '未找到 ChatGPT Deep Research OOPIF' }
    }

    const attached = await webContents.debugger.sendCommand('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    }) as CdpAttachResult
    childSessionId = attached.sessionId

    await webContents.debugger.sendCommand('Runtime.enable', undefined, childSessionId)
    const evaluated = await webContents.debugger.sendCommand('Runtime.evaluate', {
      expression: REPORT_EXTRACTION_EXPRESSION,
      returnByValue: true,
      awaitPromise: true
    }, childSessionId) as CdpEvaluateResult

    if (evaluated.exceptionDetails) {
      return {
        success: false,
        error: `Deep Research frame 执行异常: ${JSON.stringify(evaluated.exceptionDetails)}`
      }
    }

    return parseReportValue(evaluated.result.value)
  } catch (error) {
    return { success: false, error: String(error) }
  } finally {
    if (childSessionId) {
      try {
        await webContents.debugger.sendCommand('Target.detachFromTarget', { sessionId: childSessionId })
      } catch {
        // frame 可能在提取期间被关闭，忽略 detach 失败
      }
    }
    if (attachedByUs) {
      try {
        if (webContents.debugger.isAttached()) webContents.debugger.detach()
      } catch {
        // debugger 可能已被 DevTools 或页面关闭自动断开
      }
    }
  }
}

export function extractChatgptDeepResearchReport(
  webContents: WebContents
): Promise<ChatgptDeepResearchExtractionResult> {
  const existing = pendingExtractions.get(webContents.id)
  if (existing) return existing

  const task = runExtraction(webContents).finally(() => {
    pendingExtractions.delete(webContents.id)
  })
  pendingExtractions.set(webContents.id, task)
  return task
}
