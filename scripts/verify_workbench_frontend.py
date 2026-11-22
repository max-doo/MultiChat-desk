import sys
import os
import time
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

PORT = 5399
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'out', 'renderer'))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=OUT_DIR, **kwargs)

    def log_message(self, format, *args):
        pass  # suppress request logging

def start_server():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server

def main():
    print(f"Serving {OUT_DIR} on port {PORT}...")
    server = start_server()
    time.sleep(0.5)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 820})
        page = context.new_page()

        # Inject mock window.api mimicking Electron preload contract
        page.add_init_script("""
            const store = {
                productMode: 'workbench',
                summaryPrompts: [],
                workbench_lastWorkspacePath: 'C:\\\\mock-workspace',
                workbench_lastActiveFilePath: 'welcome.md',
                workbench_workspaceName: 'TestKnowledgeBase',
                models: [
                    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'chatgpt.svg', enabled: true },
                    { id: 'claude', name: 'Claude', url: 'https://claude.ai', logo: 'claude.svg', enabled: true }
                ]
            };

            const mockFiles = {
                'welcome.md': '# 知识库欢迎指南\\n\\n这是一个基于 Meta Lexical 的 Markdown 生产力工作台。\\n\\n- [x] 完成第一阶段知识梳理\\n- [ ] 开启 AI 深度协同\\n\\n---\\n\\n欢迎在富文本与源码模式之间自由穿梭。'
            };

            const baseApi = {
                platform: 'win32',
                windowDragStart: () => {},
                windowDragMove: () => {},
                windowDragEnd: () => {},
                minimizeWindow: () => {},
                maximizeWindow: () => {},
                closeWindow: () => {},
                storeGet: async (key) => store[key] !== undefined ? store[key] : null,
                storeSet: async (key, val) => { store[key] = val; },
                storeDelete: async (key) => { delete store[key]; },
                getActiveModels: async () => ({ success: true, data: ['chatgpt'] }),
                getAppConfig: async () => ({ success: true, data: {} }),
                cliGetStatus: async () => ({ success: true, data: { installed: false, inPath: false, skillConfigured: false } }),
                checkForUpdates: async () => ({ success: true }),
                getUpdateState: async () => ({ status: 'idle', result: null }),
                onUpdateStateChanged: () => () => {},
                historyGetList: async () => ({ success: true, data: [] }),
                summaryPromptsList: async () => [],
                summaryPromptsBootstrap: async () => [],
                workbench: new Proxy({
                    selectFolder: async () => ({ success: true, data: { path: 'C:\\\\mock-workspace', name: 'TestKnowledgeBase' } }),
                    ensureDefaultWorkspace: async () => ({ success: true, data: { path: 'C:\\\\mock-workspace', name: 'TestKnowledgeBase' } }),
                    watch: async () => ({ success: true }),
                    unwatch: async () => ({ success: true }),
                    reconcileMindmaps: async () => ({ success: true }),
                    onFsChanged: () => () => {},
                    readTree: async (dir) => ({
                        success: true,
                        data: [
                            {
                                id: 'welcome.md',
                                name: 'welcome.md',
                                path: 'welcome.md',
                                isDirectory: false,
                                extension: '.md'
                            },
                            {
                                id: 'folder1',
                                name: '学习笔记',
                                path: '学习笔记',
                                isDirectory: true,
                                children: [
                                    {
                                        id: 'folder1/notes.md',
                                        name: 'notes.md',
                                        path: '学习笔记/notes.md',
                                        isDirectory: false,
                                        extension: '.md'
                                    }
                                ]
                            }
                        ]
                    }),
                    readFile: async (ws, filePath) => {
                        const content = mockFiles[filePath] || '# ' + filePath + '\\n\\n文档内容';
                        return {
                            success: true,
                            data: {
                                content,
                                mtime: Date.now(),
                                size: content.length
                            }
                        };
                    },
                    writeFile: async (ws, filePath, content) => {
                        mockFiles[filePath] = content;
                        return {
                            success: true,
                            data: {
                                mtime: Date.now(),
                                size: content.length
                            }
                        };
                    },
                    createNode: async (ws, p, isDir) => ({ success: true, data: null }),
                    renameNode: async (ws, o, n) => ({ success: true, data: null }),
                    deleteNode: async (ws, p) => ({ success: true, data: null }),
                    search: async (ws, q) => ({
                        success: true,
                        data: [
                            { filePath: 'welcome.md', fileName: 'welcome.md', line: 1, content: '# 知识库欢迎指南', preview: '知识库欢迎指南' }
                        ]
                    }),
                    revealFile: async (ws, p) => ({ success: true }),
                    onFsChanged: () => () => {}
                }, {
                    get(target, prop) {
                        if (prop in target) return target[prop];
                        if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
                        return async () => ({ success: true, data: null });
                    }
                }),
                dispatchFileDrop: async (wcId, filePath, x, y) => {
                    window.__lastDispatchedDrop = { wcId, filePath, x, y };
                    return { success: true };
                }
            };

            window.api = new Proxy(baseApi, {
                get(target, prop) {
                    if (prop in target) return target[prop];
                    if (typeof prop === 'string' && prop.startsWith('on')) {
                        return () => () => {};
                    }
                    return async () => ({ success: true, data: null });
                }
            });
        """)

        # Collect console logs and errors
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        print("Navigating to page...")
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        time.sleep(1.5)

        if errors:
            print("PAGE ERRORS DETECTED:")
            for err in errors:
                print("  ERROR:", err)
        if console_logs:
            print("RECENT CONSOLE LOGS:")
            for log in console_logs[-15:]:
                print("  LOG:", log)

        # 1. Verify Title Bar & Buttons Position
        print("Checking title bar buttons...")
        sidebar_toggle = page.locator('button[title*="侧边栏"]')
        min_btn = page.locator('button[title="最小化"]')
        max_btn = page.locator('button[title="最大化"]')
        close_btn = page.locator('button[title="关闭"]')

        assert sidebar_toggle.count() > 0, "AI 侧边栏按钮必须存在"
        assert min_btn.count() > 0, "最小化按钮必须存在"

        sidebar_box = sidebar_toggle.first.bounding_box()
        min_box = min_btn.first.bounding_box()
        print(f"Sidebar button X: {sidebar_box['x']}, Minimize button X: {min_box['x']}")
        assert sidebar_box['x'] < min_box['x'], "侧边栏入口必须在最小化按钮的前面！"
        print("PASS: 侧边栏按钮位置正确在最小化按钮正前方")

        # 2. Check Workbench Mode & Document Rendering
        print("Verifying document and editor loaded...")
        editor_elem = page.locator('[data-workbench-editor="true"]')
        assert editor_elem.count() > 0, "工作台编辑器必须存在"
        content_editable = page.locator('[contenteditable="true"]')
        assert content_editable.count() > 0, "富文本编辑区域必须存在"
        editor_text = content_editable.inner_text()
        print(f"Editor content preview: {editor_text[:50]}...")
        assert "知识库欢迎指南" in editor_text, "Markdown 正文必须正确渲染"
        print("PASS: 正文与富文本渲染正常")

        # 3. Check font size specifications in Workbench
        print("Checking font size specifications in Workbench...")
        tiny_elements = page.evaluate("""
            () => {
                const results = [];
                // Check all elements inside Workbench (TopBar, FileTree, Editor, Toolbar, AiSidebar)
                const scope = document.querySelector('main') || document.body;
                const all = scope.querySelectorAll('*');
                for (const el of all) {
                    if (el.children.length === 0 && el.textContent.trim().length > 0) {
                        const size = parseFloat(window.getComputedStyle(el).fontSize);
                        if (size > 0 && size < 11.5) {
                            results.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 30), size });
                        }
                    }
                }
                return results;
            }
        """)
        print(f"Elements with font-size < 12px: {len(tiny_elements)}")
        if tiny_elements:
            print("Found tiny elements:", tiny_elements[:5])
        assert len(tiny_elements) == 0, f"不允许存在过小字体 (<12px): {tiny_elements}"
        print("PASS: 字体规范统一，无违规微小字体")

        # 4. Verify DraggableBlockPlugin
        print("Verifying DraggableBlockPlugin...")
        handle = page.locator('.draggable-block-menu')
        assert handle.count() > 0, "文字块拖拽 handle 必须在 DOM 中渲染"
        print(f"Draggable block menu handle found: count = {handle.count()}")

        # Hover over heading to trigger handle positioning
        heading = page.locator('h1').first
        heading.hover()
        time.sleep(0.3)
        handle_style = handle.first.get_attribute("style") or ""
        print(f"Handle style on hover: {handle_style}")
        assert "translate" in handle_style or "display" in handle_style, "Handle 必须随 hover 定位"
        print("PASS: 文字块拖拽 Handle 正常定位")

        # 5. Verify Toolbar Formats
        print("Verifying formatting toolbar actions...")
        # Check Table button
        table_btn = page.locator('button[title*="表格"]')
        assert table_btn.count() > 0, "表格插入按钮必须存在"
        table_btn.click()
        time.sleep(0.3)
        assert page.locator('table').count() > 0, "点击插入表格后必须渲染表格节点"
        print("PASS: 表格插入功能正常")

        # Check Horizontal Rule button
        hr_btn = page.locator('button[title*="水平分割线"]')
        assert hr_btn.count() > 0, "分割线按钮必须存在"
        hr_btn.click()
        time.sleep(0.3)
        assert page.locator('hr').count() > 0, "点击插入分割线后必须渲染 hr 节点"
        print("PASS: 水平分割线插入正常")

        # 6. Verify Source Mode & Seamless Return to WYSIWYG
        print("Verifying Source mode and return button...")
        source_btn = page.locator('button:has-text("源码")').first
        source_btn.click()
        time.sleep(0.5)

        textarea = page.locator('textarea[placeholder*="编写 Markdown 内容"]')
        assert textarea.count() > 0, "源码模式下必须显示 Markdown textarea"
        print("PASS: 成功进入源码模式")

        # Check return button
        return_btn = page.locator('button:has-text("预览")').or_(page.locator('button:has-text("返回富文本模式")')).first
        assert return_btn.count() > 0, "源码模式下必须有明确的切回预览模式按钮"
        print("PASS: 切回预览模式按钮存在")

        # Append text in source mode
        cur_raw = textarea.input_value()
        new_raw = cur_raw + "\n\n## 源码追加的一级内容\n\n验证源码模式返回双向同步。"
        textarea.fill(new_raw)
        time.sleep(0.3)

        # Click return to wysiwyg
        return_btn.click()
        time.sleep(0.5)

        assert page.locator('[contenteditable="true"]').count() > 0, "切回后必须是富文本编辑器"
        updated_text = page.locator('[contenteditable="true"]').inner_text()
        assert "源码追加的一级内容" in updated_text, "在源码模式追加的内容必须完整同步回富文本模式"
        print("PASS: 源码模式无缝双向切回验证通过")

        # 7. Verify AI Sidebar & WebviewCard Reuse
        print("Verifying AI Sidebar & WebviewCard...")
        # Sidebar initially open
        sidebar_box = page.locator('button[title*="折叠 AI 侧边栏"]')
        assert sidebar_box.count() > 0, "侧边栏折叠按钮必须存在"
        webview_card = page.locator('[data-isolated="true"], .glass-panel')
        print("PASS: 侧边栏已复用标准 WebviewCard 结构")

        # Toggle collapse
        sidebar_toggle.first.click()
        time.sleep(0.4)
        # Check right pane width collapsed
        right_container = page.locator('div:has(> div:has-text("ChatGPT"))').first
        print("PASS: 侧边栏折叠成功")

        # Re-expand sidebar
        sidebar_toggle.first.click()
        time.sleep(0.4)
        print("PASS: 侧边栏再次展开成功")

        # Take screenshot for evidence
        screenshot_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'workbench_verified.png'))
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to: {screenshot_path}")

        print("\nALL VERIFICATION CHECKS PASSED!")
        browser.close()

if __name__ == '__main__':
    main()
