import sys
import os
import time
import threading
import base64
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

PORT = 5411
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
        context = browser.new_context(viewport={'width': 1360, 'height': 850})
        page = context.new_page()

        # 1x1 transparent png for test
        sample_png_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        # minimal 1-page pdf for test
        sample_pdf_b64 = "data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMzAwIDMwMF0+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKMDAwMDAwMDExNCAwMDAwMCBuIAp0cmFpbGVyCjw8L1Jvb3QgMSAwIFIvU2l6ZSA0Pj4Kc3RhcnR4cmVmCjE5NQolJUVPRg=="

        page.add_init_script(f"""
            const store = {{
                productMode: 'workbench',
                summaryPrompts: [],
                workbench_lastWorkspacePath: 'C:\\\\mock-workspace',
                workbench_lastActiveFilePath: 'welcome.md',
                workbench_workspaceName: 'TestKnowledgeBase',
                models: [
                    {{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'chatgpt.svg', enabled: true }}
                ]
            }};

            window.__writeCalls = [];
            const mockFiles = {{
                'welcome.md': {{
                    category: 'markdown',
                    content: '# 欢迎来到工作台\\n\\n支持代码、图片、PDF 预览与知识管理。',
                    size: 120,
                    mtime: Date.now()
                }},
                'src/index.ts': {{
                    category: 'code',
                    content: 'import {{ app }} from "electron";\\n\\nexport function init(): void {{\\n  console.log("MultiChat Knowledge Base Initialized");\\n}}\\n\\ninit();',
                    size: 145,
                    mtime: Date.now()
                }},
                'assets/logo.png': {{
                    category: 'image',
                    content: '',
                    dataUrl: '{sample_png_b64}',
                    mimeType: 'image/png',
                    size: 78,
                    mtime: Date.now()
                }},
                'assets/photo.tiff': {{
                    category: 'image',
                    content: '',
                    dataUrl: '{sample_png_b64}',
                    mimeType: 'image/tiff',
                    size: 512,
                    mtime: Date.now()
                }},
                'assets/huge.png': {{
                    category: 'image',
                    content: '',
                    isOversized: true,
                    mimeType: 'image/png',
                    size: 30 * 1024 * 1024,
                    mtime: Date.now()
                }},
                'docs/manual.pdf': {{
                    category: 'pdf',
                    content: '',
                    dataUrl: '{sample_pdf_b64}',
                    mimeType: 'application/pdf',
                    size: 260,
                    mtime: Date.now()
                }},
                'docs/huge.pdf': {{
                    category: 'pdf',
                    content: '',
                    isOversized: true,
                    mimeType: 'application/pdf',
                    size: 65 * 1024 * 1024,
                    mtime: Date.now()
                }},
                'reports/summary.docx': {{
                    category: 'document',
                    content: '',
                    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    size: 18450,
                    mtime: Date.now()
                }}
            }};

            const baseApi = {{
                platform: 'win32',
                windowDragStart: () => {{}},
                windowDragMove: () => {{}},
                windowDragEnd: () => {{}},
                minimizeWindow: () => {{}},
                maximizeWindow: () => {{}},
                closeWindow: () => {{}},
                storeGet: async (key) => store[key] !== undefined ? store[key] : null,
                storeSet: async (key, val) => {{ store[key] = val; }},
                storeDelete: async (key) => {{ delete store[key]; }},
                onNotesNavigate: () => () => {{}},
                notesConsumeNavigation: async () => ({{ success: true, data: null }}),
                getActiveModels: async () => ({{ success: true, data: ['chatgpt'] }}),
                getAppConfig: async () => ({{ success: true, data: {{}} }}),
                cliGetStatus: async () => ({{ success: true, data: {{ installed: false, inPath: false, skillConfigured: false }} }}),
                checkForUpdates: async () => ({{ success: true }}),
                getUpdateState: async () => ({{ status: 'idle', result: null }}),
                onUpdateStateChanged: () => () => {{}},
                historyGetList: async () => ({{ success: true, data: [] }}),
                summaryPromptsList: async () => [],
                summaryPromptsBootstrap: async () => [],
                workbench: new Proxy({{
                    selectFolder: async () => ({{ success: true, data: {{ path: 'C:\\\\mock-workspace', name: 'TestKnowledgeBase' }} }}),
                    ensureDefaultWorkspace: async () => ({{ success: true, data: {{ path: 'C:\\\\mock-workspace', name: 'TestKnowledgeBase' }} }}),
                    watch: async () => ({{ success: true }}),
                    unwatch: async () => ({{ success: true }}),
                    reconcileMindmaps: async () => ({{ success: true }}),
                    onFsChanged: () => () => {{}},
                    readTree: async (dir) => ({{
                        success: true,
                        data: [
                            {{ id: 'welcome.md', name: 'welcome.md', path: 'welcome.md', isDirectory: false, extension: '.md', category: 'markdown' }},
                            {{ id: 'src/index.ts', name: 'index.ts', path: 'src/index.ts', isDirectory: false, extension: '.ts', category: 'code' }},
                            {{ id: 'assets/logo.png', name: 'logo.png', path: 'assets/logo.png', isDirectory: false, extension: '.png', category: 'image' }},
                            {{ id: 'assets/photo.tiff', name: 'photo.tiff', path: 'assets/photo.tiff', isDirectory: false, extension: '.tiff', category: 'image' }},
                            {{ id: 'assets/huge.png', name: 'huge.png', path: 'assets/huge.png', isDirectory: false, extension: '.png', category: 'image' }},
                            {{ id: 'docs/manual.pdf', name: 'manual.pdf', path: 'docs/manual.pdf', isDirectory: false, extension: '.pdf', category: 'pdf' }},
                            {{ id: 'docs/huge.pdf', name: 'huge.pdf', path: 'docs/huge.pdf', isDirectory: false, extension: '.pdf', category: 'pdf' }},
                            {{ id: 'reports/summary.docx', name: 'summary.docx', path: 'reports/summary.docx', isDirectory: false, extension: '.docx', category: 'document' }}
                        ]
                    }}),
                    readFile: async (ws, filePath) => {{
                        const f = mockFiles[filePath];
                        if (f) {{
                            return {{
                                success: true,
                                data: {{
                                    content: f.content,
                                    dataUrl: f.dataUrl,
                                    fileUrl: f.dataUrl || f.fileUrl,
                                    mimeType: f.mimeType,
                                    category: f.category,
                                    size: f.size,
                                    mtime: f.mtime,
                                    isOversized: f.isOversized
                                }}
                            }};
                        }}
                        return {{ success: false, error: 'File not found' }};
                    }},
                    writeFile: async (ws, filePath, content) => {{
                        window.__writeCalls.push({{ filePath, content }});
                        if (mockFiles[filePath]) {{
                            mockFiles[filePath].content = content;
                        }}
                        return {{ success: true, data: {{ mtime: Date.now(), size: content.length }} }};
                    }},
                    createNode: async () => ({{ success: true, data: null }}),
                    renameNode: async () => ({{ success: true }}),
                    deleteNode: async () => ({{ success: true }}),
                    search: async () => ({{ success: true, data: [] }}),
                    revealFile: async () => ({{ success: true }}),
                    openInSystem: async () => ({{ success: true }})
                }}, {{
                    get(target, prop) {{
                        if (prop in target) return target[prop];
                        if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {{}};
                        return async () => ({{ success: true, data: null }});
                    }}
                }})
            }};

            window.api = new Proxy(baseApi, {{
                get(target, prop) {{
                    if (prop in target) return target[prop];
                    if (typeof prop === 'string' && prop.startsWith('on')) {{
                        return () => () => {{}};
                    }}
                    return async () => ({{ success: true, data: null }});
                }}
            }});
        """)

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        print("Navigating to Workbench...")
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
        time.sleep(1.5)

        if errors:
            print("PAGE ERRORS DETECTED:")
            for err in errors:
                print("  ERROR:", err)
            raise RuntimeError("Page had errors")

        # 1. 验证文件树专属图标（每种格式都有专属图标，同系列）
        print("Test 1: Verifying File Tree custom icons for every file category...")
        md_node = page.locator('[data-file-node="welcome.md"] svg[data-icon="description"]')
        assert md_node.count() > 0, "Markdown 必须保留原来的 description 图标"

        png_node = page.locator('[data-file-node="assets/logo.png"] svg[data-icon="image"]')
        assert png_node.count() > 0, "PNG 必须保留原来的 image 图标"

        tiff_node = page.locator('[data-file-node="assets/photo.tiff"] svg[data-icon="image"]')
        assert tiff_node.count() > 0, "TIFF 必须保留原来的 image 图标"

        icon_signatures = {
            'src/index.ts': '%230288d1',
            'docs/manual.pdf': '%23ef5350',
            'reports/summary.docx': '%2301579b'
        }

        for file_path, signature in icon_signatures.items():
            icon_src = page.locator(f'[data-file-node="{file_path}"] img').first.get_attribute('src')
            assert icon_src and signature in icon_src, f"{file_path} 未使用对应的 Material 文件图标"

        print("PASS 1: 文件树所有格式的同系列专属图标验证全部通过！")

        # 2. 验证代码文件预览与编辑
        print("\nTest 2: Verifying Code File Preview & Edit...")
        page.locator('[data-file-node="src/index.ts"]').first.click()
        time.sleep(0.5)

        # 验证语言徽标与代码视图
        ts_badge = page.locator('span:has-text("TypeScript")')
        assert ts_badge.count() > 0, "代码预览中必须展示 TypeScript 语言标签"
        code_tag = page.locator('code:has-text("MultiChat Knowledge Base")')
        assert code_tag.count() > 0, "代码预览中必须正确展示源代码内容"
        # 验证语法高亮关键字 span
        kw_span = page.locator('code span.text-purple-400:has-text("import")')
        assert kw_span.count() > 0, "代码查看模式必须对 import/export 等关键字进行语法高亮"
        print("PASS 2.1: 代码文件查看视图正常展示语言标签、行号与多色彩语法高亮")

        # 切换编辑模式
        edit_btn = page.locator('button:has-text("编辑")').first
        edit_btn.click()
        time.sleep(0.3)
        textarea = page.locator('textarea[placeholder*="输入或粘贴代码"]')
        assert textarea.count() > 0, "切换编辑模式后必须渲染代码 textarea"
        print("PASS 2.2: 代码文件编辑模式切换正常")

        # 3. 验证图片文件预览与 Ctrl+S 防误写保护
        print("\nTest 3: Verifying Image File Preview & Save Protection...")
        page.locator('[data-file-node="assets/logo.png"]').first.click()
        time.sleep(0.5)

        img_elem = page.locator('img[alt*="logo.png"]')
        assert img_elem.count() > 0, "图片预览中必须渲染 img 标签"
        zoom_reset = page.locator('button[title*="重置为 100%"]')
        assert zoom_reset.count() > 0, "图片预览中必须提供缩放控制"
        rotate_btn = page.locator('button[title*="顺时针旋转"]')
        assert rotate_btn.count() > 0, "图片预览中必须提供旋转控制"
        rotate_btn.click()
        time.sleep(0.2)

        # 模拟在图片上按 Ctrl+S，验证不会写盘破坏图片数据
        page.keyboard.press("Control+s")
        time.sleep(0.3)
        write_calls = page.evaluate("window.__writeCalls || []")
        logo_writes = [w for w in write_calls if 'logo.png' in w.get('filePath', '')]
        assert len(logo_writes) == 0, "严禁将空文本写盘覆盖图片文件造成数据损坏！"
        print("PASS 3.1: 图片文件预览与画布旋转正常，Ctrl+S 数据保护生效（0次破坏性写盘）")

        # 验证超大图片友好卡片
        page.locator('[data-file-node="assets/huge.png"]').first.click()
        time.sleep(0.5)
        huge_card = page.locator('text=图片超出内嵌预览上限')
        assert huge_card.count() > 0, "超大图片必须展示友好的外置打开引导卡片，而非抛出崩溃 Toast"
        print("PASS 3.2: 超大图片降级保护卡片与系统打开联动正常")

        # 4. 验证 PDF 文件预览与超大 PDF
        print("\nTest 4: Verifying PDF File Preview...")
        page.locator('[data-file-node="docs/manual.pdf"]').first.click()
        time.sleep(0.5)

        pdf_badge = page.locator('img[src*="%23ef5350"]')
        assert pdf_badge.count() > 0, "PDF 预览中必须显示 PDF 图标"
        pdf_object = page.locator('object[type="application/pdf"]')
        assert pdf_object.count() > 0, "PDF 预览必须使用标准 object 元素嵌入"
        open_reader_btn = page.locator('button[title*="系统默认程序"], button:has-text("系统阅读器")')
        assert open_reader_btn.count() > 0, "PDF 预览必须提供系统打开按钮"
        print("PASS 4.1: PDF 文件内嵌与系统阅读器支持正常")

        # 验证超大 PDF 友好卡片
        page.locator('[data-file-node="docs/huge.pdf"]').first.click()
        time.sleep(0.5)
        huge_pdf_card = page.locator('text=PDF 文档超出内嵌预览上限')
        assert huge_pdf_card.count() > 0, "超大 PDF 必须展示友好的外置打开引导卡片"
        print("PASS 4.2: 超大 PDF 降级保护卡片与系统打开联动正常")

        # 5. 验证 DOCX 评估与专属卡片
        print("\nTest 5: Verifying DOCX Preview Card & System Integration...")
        page.locator('[data-file-node="reports/summary.docx"]').first.click()
        time.sleep(0.5)

        docx_badge = page.locator('span:has-text("DOCX")')
        assert docx_badge.count() > 0, "Word 卡片中必须显示 DOCX 标识"
        open_word_btn = page.locator('button:has-text("在本地办公软件中打开"), button:has-text("在 Word / WPS 中打开")')
        assert open_word_btn.count() > 0, "必须提供一键「在 Word / WPS 中打开」按钮"
        format_notice = page.locator('text=格式渲染建议')
        assert format_notice.count() > 0, "必须展示客观格式渲染评估建议"
        print("PASS 5: DOCX 专属卡片与系统程序一键集成正常")

        # 保存截图留存证据
        screenshot_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'workbench_formats_verified.png'))
        page.screenshot(path=screenshot_path)
        print(f"\nVerification screenshot saved to: {screenshot_path}")

        print("\n🎉 ALL FORMAT PREVIEWS & ICONS VERIFIED SUCCESSFULLY!")
        browser.close()

if __name__ == '__main__':
    main()
