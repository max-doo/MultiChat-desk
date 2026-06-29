import re

with open('src/renderer/src/utils/geminiCanvasExtractor.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. remove WebviewAPI interface
content = re.sub(r'interface WebviewAPI \{\n  executeJavaScript: \(script: string\) => Promise<any>\n  getWebContentsId: \(\) => number\n\}\n', '', content)

# 2. replace executeJavaScript
content = content.replace('webview.executeJavaScript(CHECK_CANVAS_SCRIPT)', 'window.api.executeWebviewScript(viewId, CHECK_CANVAS_SCRIPT)')
content = content.replace('webview.executeJavaScript(FIND_COPY_BTN_SCRIPT)', 'window.api.executeWebviewScript(viewId, FIND_COPY_BTN_SCRIPT)')
content = content.replace('webview.executeJavaScript(WAIT_COPY_TOAST_SCRIPT)', 'window.api.executeWebviewScript(viewId, WAIT_COPY_TOAST_SCRIPT)')
content = content.replace('webview.executeJavaScript(EXTRACT_LINKS_SCRIPT)', 'window.api.executeWebviewScript(viewId, EXTRACT_LINKS_SCRIPT)')

# 3. replace webview arg with viewId
content = content.replace('async function checkCanvasMode(webview: WebviewAPI)', 'async function checkCanvasMode(viewId: string)')
content = content.replace('async function findAndClickCopyButton(webview: WebviewAPI, windowApi: WindowAPI, webContentsId: number)', 'async function findAndClickCopyButton(viewId: string, windowApi: any, webContentsId: number)')
content = content.replace('async function waitForCopyToast(webview: WebviewAPI)', 'async function waitForCopyToast(viewId: string)')
content = content.replace('async function extractReferenceLinks(webview: WebviewAPI)', 'async function extractReferenceLinks(viewId: string)')

content = content.replace(
    'export async function extractGeminiCanvasContent(\n  webview: WebviewAPI,\n  windowApi: WindowAPI,\n  turndownService: TurndownService\n)',
    'export async function extractGeminiCanvasContent(\n  viewId: string,\n  windowApi: any,\n  turndownService: TurndownService\n)'
)

content = content.replace('checkCanvasMode(webview)', 'checkCanvasMode(viewId)')
content = content.replace('findAndClickCopyButton(webview, windowApi, webContentsId)', 'findAndClickCopyButton(viewId, windowApi, webContentsId)')
content = content.replace('waitForCopyToast(webview)', 'waitForCopyToast(viewId)')
content = content.replace('extractReferenceLinks(webview)', 'extractReferenceLinks(viewId)')

# 4. update getWebContentsId usage
# Before: const webContentsId = webview.getWebContentsId()
# After: const wcRes = await window.api.getWebviewWebContentsId(viewId); const webContentsId = wcRes.success ? wcRes.data.webContentsId : -1
content = content.replace(
    'const webContentsId = webview.getWebContentsId()',
    'const wcRes = await window.api.getWebviewWebContentsId(viewId)\n    const webContentsId = wcRes.success && wcRes.data ? wcRes.data.webContentsId : -1'
)

# Wait, the `executeWebviewScript` returns `{ success, data, error }`. So we need to await it and get `.data` for those functions.
# Let's fix those lines carefully.
content = content.replace('await window.api.executeWebviewScript(viewId, CHECK_CANVAS_SCRIPT)', '(await window.api.executeWebviewScript(viewId, CHECK_CANVAS_SCRIPT)).data')
content = content.replace('await window.api.executeWebviewScript(viewId, FIND_COPY_BTN_SCRIPT)', '(await window.api.executeWebviewScript(viewId, FIND_COPY_BTN_SCRIPT)).data')
content = content.replace('await window.api.executeWebviewScript(viewId, WAIT_COPY_TOAST_SCRIPT)', '(await window.api.executeWebviewScript(viewId, WAIT_COPY_TOAST_SCRIPT)).data')
content = content.replace('await window.api.executeWebviewScript(viewId, EXTRACT_LINKS_SCRIPT)', '(await window.api.executeWebviewScript(viewId, EXTRACT_LINKS_SCRIPT)).data')

with open('src/renderer/src/utils/geminiCanvasExtractor.ts', 'w', encoding='utf-8') as f:
    f.write(content)
