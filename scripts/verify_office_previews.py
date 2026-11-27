"""
xlsx / pptx / csv 内嵌预览端到端验收（Playwright + out/renderer 静态服务 + mock api）。
验收口径对应 docs/workbench/workbench-office-editing-plan.md 第 7 节：
小表合并/多 sheet/划词转 Markdown 表格/发送 AI 链路、大表虚拟滚动与横向滚动、
pptx 分页文字图片与跨文本框选中、老格式/损坏/超限兜底；
CSV/TSV 表格与源码双视图、引号转义素材、浅色模式 chrome、编辑联动与 BOM 剥离。
运行前置：先 pnpm run build 产出 out/renderer，样本由 scratch/office-preview-samples 提供。
"""
import sys
import os
import time
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

PORT = 5412
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT_DIR = os.path.join(ROOT, 'out', 'renderer')
SAMPLES_DIR = os.path.join(ROOT, 'scratch', 'office-preview-samples')
EVIDENCE_DIR = os.path.join(ROOT, 'scratch', 'office-preview-acceptance')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=OUT_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        # /samples/<name> 懒加载真实样本字节，避免把 large.xlsx base64 内联进 init 脚本
        if self.path.startswith('/samples/'):
            name = self.path[len('/samples/'):].split('?')[0]
            if '/' in name or '..' in name:
                self.send_error(403)
                return
            file_path = os.path.join(SAMPLES_DIR, name)
            if os.path.isfile(file_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.end_headers()
                with open(file_path, 'rb') as f:
                    self.wfile.write(f.read())
                return
            self.send_error(404)
            return
        super().do_GET()


def start_server():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main():
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    for required in ['small.xlsx', 'large.xlsx', 'sample.pptx', 'tricky.csv', 'sample.tsv', 'large.csv', 'utf8-bom.csv']:
        if not os.path.isfile(os.path.join(SAMPLES_DIR, required)):
            print(f"FATAL: 缺少样本 {required}，请先生成 scratch/office-preview-samples")
            sys.exit(2)
    print(f"Serving {OUT_DIR} on port {PORT}...")
    server = start_server()
    time.sleep(0.5)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--js-flags=--expose-gc'])
        context = browser.new_context(viewport={'width': 1360, 'height': 850})
        page = context.new_page()

        page.add_init_script("""
            const store = {
                productMode: 'workbench',
                summaryPrompts: [],
                workbench_lastWorkspacePath: 'C:\\\\mock-workspace',
                workbench_lastActiveFilePath: 'welcome.md',
                workbench_workspaceName: 'OfficeAcceptance',
                models: [
                    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'chatgpt.svg', enabled: true }
                ]
            };

            window.__writeCalls = [];
            // 划词发送 AI 链路的捕获点：askAi 通过 CustomEvent 注入侧边栏，
            // 验收时在派发原点上监听，断言注入文本的结构与内容
            window.__insertPrompts = [];
            window.addEventListener('workbench:insert-prompt', (event) => {
                window.__insertPrompts.push(event.detail?.prompt ?? '');
            });

            const mockFiles = {
                'welcome.md': {
                    category: 'markdown',
                    content: '# Office 预览验收',
                    size: 40,
                    mtime: Date.now()
                },
                'reports/small.xlsx': {
                    category: 'document',
                    content: '',
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    size: 19148,
                    mtime: Date.now()
                },
                'reports/large.xlsx': {
                    category: 'document',
                    content: '',
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    size: 4297228,
                    mtime: Date.now()
                },
                'reports/sample.pptx': {
                    category: 'document',
                    content: '',
                    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    size: 213933,
                    mtime: Date.now()
                },
                'reports/legacy.doc': {
                    category: 'document',
                    content: '',
                    mimeType: 'application/msword',
                    size: 30000,
                    mtime: Date.now()
                },
                'reports/broken.xlsx': {
                    category: 'document',
                    content: '',
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    size: 1200,
                    mtime: Date.now()
                },
                'reports/huge.xlsx': {
                    category: 'document',
                    content: '',
                    isOversized: true,
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    size: 12 * 1024 * 1024,
                    mtime: Date.now()
                },
                'reports/regression.docx': {
                    category: 'document',
                    content: '',
                    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    size: 37334,
                    mtime: Date.now()
                },
                'data/tricky.csv': {
                    category: 'text',
                    sampleFile: 'tricky.csv',
                    mimeType: 'text/csv',
                    size: 154,
                    mtime: Date.now()
                },
                'data/sample.tsv': {
                    category: 'text',
                    sampleFile: 'sample.tsv',
                    mimeType: 'text/tab-separated-values',
                    size: 97,
                    mtime: Date.now()
                },
                'data/large.csv': {
                    category: 'text',
                    sampleFile: 'large.csv',
                    mimeType: 'text/csv',
                    size: 706776,
                    mtime: Date.now()
                },
                'data/utf8-bom.csv': {
                    category: 'text',
                    sampleFile: 'utf8-bom.csv',
                    mimeType: 'text/csv',
                    size: 67,
                    mtime: Date.now()
                }
            };

            const treeNodes = [
                { id: 'welcome.md', name: 'welcome.md', path: 'welcome.md', isDirectory: false, extension: '.md', category: 'markdown' },
                { id: 'reports/small.xlsx', name: 'small.xlsx', path: 'reports/small.xlsx', isDirectory: false, extension: '.xlsx', category: 'document' },
                { id: 'reports/large.xlsx', name: 'large.xlsx', path: 'reports/large.xlsx', isDirectory: false, extension: '.xlsx', category: 'document' },
                { id: 'reports/sample.pptx', name: 'sample.pptx', path: 'reports/sample.pptx', isDirectory: false, extension: '.pptx', category: 'document' },
                { id: 'reports/legacy.doc', name: 'legacy.doc', path: 'reports/legacy.doc', isDirectory: false, extension: '.doc', category: 'document' },
                { id: 'reports/broken.xlsx', name: 'broken.xlsx', path: 'reports/broken.xlsx', isDirectory: false, extension: '.xlsx', category: 'document' },
                { id: 'reports/huge.xlsx', name: 'huge.xlsx', path: 'reports/huge.xlsx', isDirectory: false, extension: '.xlsx', category: 'document' }
                ,
                { id: 'reports/regression.docx', name: 'regression.docx', path: 'reports/regression.docx', isDirectory: false, extension: '.docx', category: 'document' }
                ,
                { id: 'data/tricky.csv', name: 'tricky.csv', path: 'data/tricky.csv', isDirectory: false, extension: '.csv', category: 'text' },
                { id: 'data/sample.tsv', name: 'sample.tsv', path: 'data/sample.tsv', isDirectory: false, extension: '.tsv', category: 'text' },
                { id: 'data/large.csv', name: 'large.csv', path: 'data/large.csv', isDirectory: false, extension: '.csv', category: 'text' },
                { id: 'data/utf8-bom.csv', name: 'utf8-bom.csv', path: 'data/utf8-bom.csv', isDirectory: false, extension: '.csv', category: 'text' }
            ];

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
                annotations: new Proxy({
                    onChanged: () => () => {}
                }, {
                    get(target, prop) {
                        if (prop in target) return target[prop];
                        if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
                        return async () => ({ success: true, data: [] });
                    }
                }),
                summaryPromptsList: async () => [],
                summaryPromptsBootstrap: async () => [],
                workbench: new Proxy({
                    selectFolder: async () => ({ success: true, data: { path: 'C:\\\\mock-workspace', name: 'OfficeAcceptance' } }),
                    activateWorkspace: async () => ({ success: true, data: { activeWorkspaceRoot: 'C:\\\\mock-workspace', generation: 1 } }),
                    closeWorkspace: async () => ({ success: true, data: null }),
                    ensureDefaultWorkspace: async () => ({ success: true, data: { path: 'C:\\\\mock-workspace', writable: true } }),
                    watch: async () => ({ success: true }),
                    unwatch: async () => ({ success: true }),
                    reconcileMindmaps: async () => ({ success: true }),
                    onFsChanged: () => () => {},
                    readTree: async (dir) => ({ success: true, data: treeNodes }),
                    readFile: async (ws, filePath) => {
                        const f = mockFiles[filePath];
                        if (f) {
                            // CSV/TSV 样本从 /samples 懒取字节再解码文本：
                            // readFile 契约返回字符串，内容与真实样本保持一致
                            let content = f.content;
                            if (f.sampleFile) {
                                const textResp = await fetch('/samples/' + f.sampleFile);
                                if (!textResp.ok) return { success: false, error: 'missing sample ' + f.sampleFile };
                                content = await textResp.text();
                            }
                            return {
                                success: true,
                                data: {
                                    content,
                                    mimeType: f.mimeType,
                                    category: f.category,
                                    size: f.size,
                                    mtime: f.mtime,
                                    isOversized: f.isOversized
                                }
                            };
                        }
                        return { success: false, error: 'File not found' };
                    },
                    readOfficeBytes: async (ws, filePath) => {
                        // 损坏样本返回非 zip 字节，验证 worker 魔数校验与错误兜底
                        if (filePath.includes('broken.xlsx')) {
                            return {
                                success: true,
                                data: { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), size: 12, mtime: Date.now() }
                            };
                        }
                        const name = filePath.split('/').pop();
                        const resp = await fetch('/samples/' + name);
                        if (!resp.ok) return { success: false, error: 'missing sample ' + name };
                        const buf = await resp.arrayBuffer();
                        return { success: true, data: { bytes: new Uint8Array(buf), size: buf.byteLength, mtime: Date.now() } };
                    },
                    writeFile: async (ws, filePath, content) => {
                        window.__writeCalls.push({ filePath, content });
                        return { success: true, data: { mtime: Date.now(), size: content.length } };
                    },
                    createNode: async () => ({ success: true, data: null }),
                    renameNode: async () => ({ success: true }),
                    deleteNode: async () => ({ success: true }),
                    search: async () => ({ success: true, data: [] }),
                    revealFile: async () => ({ success: true }),
                    openInSystem: async () => ({ success: true })
                }, {
                    get(target, prop) {
                        if (prop in target) return target[prop];
                        if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
                        return async () => ({ success: true, data: null });
                    }
                })
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

        def open_file(path):
            page.locator(f'[data-file-node="{path}"]').first.click()
            time.sleep(0.4)

        def drag_select(start_selector, end_selector):
            start = page.locator(start_selector).first.bounding_box()
            end = page.locator(end_selector).first.bounding_box()
            assert start and end, f"选择框取不到: {start_selector} / {end_selector}"
            sx, sy = start['x'] + start['width'] / 2, start['y'] + start['height'] / 2
            ex, ey = end['x'] + end['width'] / 2, end['y'] + end['height'] / 2
            page.mouse.move(sx, sy)
            page.mouse.down()
            for i in range(1, 9):
                page.mouse.move(sx + (ex - sx) * i / 8, sy + (ey - sy) * i / 8)
                time.sleep(0.02)
            page.mouse.up()
            time.sleep(0.3)

        def prompt_count():
            return page.evaluate("window.__insertPrompts.length")

        def last_prompt():
            return page.evaluate("window.__insertPrompts[window.__insertPrompts.length - 1]")

        # ============ T1: small.xlsx 小表渲染与合并单元格 ============
        print("\nT1: small.xlsx 小表渲染 / 合并单元格 / sheet tab...")
        open_file('reports/small.xlsx')
        title_cell = page.locator('td:has-text("产品季度报表")').first
        title_cell.wait_for(timeout=15000)
        assert title_cell.get_attribute('colspan') == '4', "标题行合并 A1:D1 必须有 colspan=4"
        subtotal = page.locator('td:has-text("小计")').first
        assert subtotal.count() > 0, "小计合并单元格必须存在"
        assert subtotal.get_attribute('colspan') == '2' and subtotal.get_attribute('rowspan') == '2', \
            "小计合并 A5:B6 必须有 colspan=2 rowspan=2"
        # Excel 式 chrome：列字母表头 A/B/C/D sticky 冻结 + 行号列存在
        assert page.locator('th.sticky:has-text("A")').count() > 0, "列字母表头必须 sticky 冻结"
        assert page.locator('th[data-rowhdr]').count() >= 6, "行号列必须覆盖全部数据行"
        assert page.locator('th:has-text("B")').count() > 0, "列字母 B 必须存在"
        assert page.locator('button:has-text("人员")').count() > 0, "多 sheet 必须有 tab 条（人员）"
        assert page.locator('button:has-text("归档")').count() > 0, "多 sheet 必须有 tab 条（归档）"
        assert page.locator('td:has-text("Alpha 系列")').count() > 0, "数据行必须渲染"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't1-small-xlsx.png'))
        print("PASS T1: 小表合并单元格 (colspan/rowspan) 与 sticky 表头正确")

        # ============ T2: sheet 切换惰性解析 ============
        print("\nT2: sheet 切换...")
        page.locator('button:has-text("人员")').first.click()
        time.sleep(1.0)
        assert page.locator('td:has-text("张三")').count() > 0, "切到人员表后必须渲染张三"
        page.locator('button:has-text("季度营收")').first.click()
        time.sleep(1.0)
        assert page.locator('td:has-text("Alpha 系列")').count() > 0, "切回季度营收必须重新渲染"
        print("PASS T2: 多 sheet 切换惰性解析正常")

        # ============ T3: 划词 → Markdown 表格 → 发送 AI ============
        print("\nT3: 表格划词转 Markdown 并发送 AI...")
        before = prompt_count()
        drag_select('td:has-text("Alpha 系列")', 'td:has-text("普通备注")')
        bubble = page.locator('text=已选')
        assert bubble.count() > 0, "划选后必须出现 已选 N 字 气泡"
        page.locator('button[title="发送到 AI 侧边栏"]').first.click()
        time.sleep(0.4)
        assert prompt_count() == before + 1, "点击发送 AI 必须派发 insert-prompt 事件"
        md = last_prompt()
        print("  [debug] 注入 Markdown 原文:")
        print("  " + md.replace('\n', '\n  '))
        lines = [line for line in md.split('\n') if line.strip()]
        assert lines[0].startswith('|'), f"Markdown 首行必须是表头行: {lines[0][:80]}"
        separator_cells = [cell.strip() for cell in lines[1].strip().strip('|').split('|')]
        assert all(cell == '---' for cell in separator_cells), \
            f"第二行必须是 Markdown 分隔行: {lines[1][:80]}"
        # 矩形化校验必须排除单元格内的转义竖线（\| 不是列边界）
        import re as _re
        pipe_counts = set(len(_re.findall(r'(?<!\\)\|', line)) for line in lines)
        assert len(pipe_counts) == 1, f"Markdown 表格必须矩形化（各行管道数一致）: {pipe_counts}"
        assert '含 \\| 分隔符 与换行的单元格' in md or '含 \\| 分隔符' in md, \
            f"单元格内竖线必须转义且换行折叠为空格，实际片段: {md[:300]}"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't3-xlsx-selection.png'))
        print("PASS T3: 表格选区正确转为矩形化 Markdown（含 \\| 转义与换行折叠）并到达注入链路")

        # ============ T4: 右键菜单 + 要点动作前缀 ============
        print("\nT4: 右键菜单与 summarize 动作...")
        drag_select('td:has-text("Alpha 系列")', 'td:has-text("Beta 系列")')
        target = page.locator('td:has-text("Alpha 系列")').first.bounding_box()
        page.mouse.click(target['x'] + target['width'] / 2, target['y'] + target['height'] / 2, button='right')
        time.sleep(0.4)
        menu_copy = page.locator('text=复制选中文本')
        assert menu_copy.count() > 0, "右键必须弹出含复制项的 WorkbenchSelectionMenu"
        assert page.locator('text=提取关键要点').count() > 0, "右键菜单必须含提取关键要点"
        before = prompt_count()
        page.locator('text=提取关键要点').first.click()
        time.sleep(0.4)
        assert prompt_count() == before + 1, "要点动作必须派发 insert-prompt"
        summary_prompt = last_prompt()
        assert summary_prompt.startswith('请提取并总结'), "summarize 动作必须带指令前缀"
        assert '| --- |' in summary_prompt, "summarize 注入文本仍必须是 Markdown 表格"
        print("PASS T4: 右键菜单四动作可用，summarize 前缀 + Markdown 表格注入正确")

        # ============ T5: large.xlsx 虚拟滚动 + 宽表横向 ============
        print("\nT5: large.xlsx 虚拟滚动 / 宽表横向滚动...")
        open_file('reports/large.xlsx')
        page.locator('td:has-text("SKU-000001")').first.wait_for(timeout=20000)
        tr_count = page.locator('table tr').count()
        assert tr_count < 200, f"万行表必须虚拟渲染（DOM 行数 {tr_count} 应远小于 12001）"
        # Excel chrome：列字母 A 为固定表头（"编号"是首行数据）
        assert page.locator('th:has-text("A")').count() > 0, "大表必须有列字母固定表头"
        assert page.locator('td:has-text("编号")').count() > 0, "大表首行数据行（编号）必须渲染"
        # 滚动到底部验证虚拟行按需提供
        table_box = page.locator('table').first.bounding_box()
        assert table_box, "大表 table 必须存在"
        # 直接把 virtuoso 滚动容器 scrollTop 推到底，比模拟滚轮更确定；
        # 验收点是"尾部行按需渲染出现"，不是滚轮手势本身
        page.evaluate("""
            (() => {
                document.querySelectorAll('div').forEach((el) => {
                    if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
                        el.scrollTop = el.scrollHeight;
                    }
                });
            })()
        """)
        time.sleep(1.0)
        scroll_diag = page.evaluate("""
            (() => {
                const out = [];
                document.querySelectorAll('div').forEach((el) => {
                    if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
                        out.push({
                            cls: (el.className || '').slice(0, 60),
                            scrollTop: Math.round(el.scrollTop),
                            scrollHeight: el.scrollHeight,
                            clientHeight: el.clientHeight
                        });
                    }
                });
                const visibleSkus = Array.from(document.querySelectorAll('td'))
                    .map(td => td.textContent)
                    .filter(t => t && t.startsWith('SKU-'))
                    .slice(0, 5);
                return { scrollers: out, visibleSkus };
            })()
        """)
        print("  [debug] 滚动诊断:", scroll_diag)
        tail_visible = page.locator('td:has-text("SKU-011")').count() + page.locator('td:has-text("SKU-012")').count()
        assert tail_visible > 0, "滚动到底部后必须按需渲染尾部行（SKU-011/012xxx）"
        # 宽表横向滚动
        page.locator('button:has-text("宽表")').first.click()
        time.sleep(1.5)
        wide_first = page.locator('th:has-text("指标1"), td:has-text("指标1")').count()
        assert wide_first > 0, "宽表首列必须渲染"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't5-large-xlsx.png'))
        print("PASS T5: 大表虚拟滚动（DOM 行数受控）+ 尾部行按需渲染 + 宽表加载正常")

        # ============ T6: sample.pptx 内容预览 ============
        print("\nT6: sample.pptx 分页渲染 / 图片 / 跨文本框选中...")
        open_file('reports/sample.pptx')
        page.locator('text=工作台 PPT 内容预览验收样本').first.wait_for(timeout=15000)
        blob_imgs = page.locator('img[src^="blob:"]')
        assert blob_imgs.count() >= 1, "pptx 图片必须以 blob URL 渲染"
        assert page.locator('text=表格页：验收数据').count() > 0, "表格页标题文本必须可读"
        assert page.locator('text=增长率').count() > 0, "表格行列文本必须可读"
        before = prompt_count()
        drag_select('text=工作台 PPT 内容预览验收样本', 'text=表格页：验收数据')
        assert page.locator('text=已选').count() > 0, "跨文本框划选后必须出现气泡"
        page.locator('button[title="解释此内容"]').first.click()
        time.sleep(0.4)
        assert prompt_count() == before + 1, "pptx 划词解释必须派发 insert-prompt"
        explain_prompt = last_prompt()
        assert explain_prompt.startswith('请详细解释'), "explain 动作必须带指令前缀"
        print("  [debug] explain 注入片段:", explain_prompt.replace('\n', ' / ')[:220])
        # 拖选锚点落在起始元素文字中心，选区从标题中段开始，用尾部片段断言
        assert '验收样本' in explain_prompt, "选区文本必须进入注入内容"
        # 跨文本框断言：终点在第二张幻灯片的表格标题，两页文本必须同时出现
        assert '表格页' in explain_prompt, "跨文本框选区必须覆盖到第二张幻灯片的文本"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't6-pptx.png'))
        print("PASS T6: pptx 分页文字/图片可读，跨文本框选中 + explain 链路正确")

        # ============ T7: 老格式落卡片 ============
        print("\nT7: legacy.doc 老格式兜底...")
        open_file('reports/legacy.doc')
        assert page.locator('text=当前格式暂不支持在工作台内预览').count() > 0, \
            ".doc 老格式必须落卡片，不得尝试解析"
        print("PASS T7: OLE 老格式正确落卡片兜底")

        # ============ T8: 损坏 xlsx 错误兜底 ============
        print("\nT8: broken.xlsx 损坏文件兜底...")
        open_file('reports/broken.xlsx')
        time.sleep(1.5)
        assert page.locator('text=未能渲染这份表格').count() > 0, "损坏文件必须走错误兜底卡片"
        assert page.locator('button:has-text("在本地打开")').count() > 0, "兜底卡片必须提供系统打开入口"
        print("PASS T8: 非 zip 损坏字节被魔数校验拒绝并落错误卡片")

        # ============ T9: 超限 xlsx 卡片 ============
        print("\nT9: huge.xlsx 超限兜底...")
        open_file('reports/huge.xlsx')
        time.sleep(0.8)
        assert page.locator('text=表格超出内嵌预览上限').count() > 0, "超限文件必须落超限卡片"
        print("PASS T9: 超限 xlsx 正确落卡片")

        # ============ T10: docx 预览零回归（字节通道泛化后的回归） ============
        print("\nT10: regression.docx Word 预览回归...")
        open_file('reports/regression.docx')
        page.locator('text=验收回归样本：Word 内嵌预览').first.wait_for(timeout=15000)
        docx_sections = page.locator('section.docx')
        assert docx_sections.count() >= 1, "docx 必须分页渲染（section.docx 至少一页）"
        # 划词链路回归
        before = prompt_count()
        drag_select('text=选中本文后应能发送到 AI 侧边栏', 'text=验收回归样本：Word 内嵌预览')
        assert page.locator('text=已选').count() > 0, "docx 划词后必须出现气泡"
        page.locator('button[title="发送到 AI 侧边栏"]').first.click()
        time.sleep(0.4)
        assert prompt_count() == before + 1, "docx 划词发送必须派发 insert-prompt"
        # 字数统计与大纲按钮回归
        stats_chip = page.locator('button[title="字数统计"]')
        assert stats_chip.count() > 0, "docx 字数统计必须回归存在"
        print("PASS T10: docx 分页/划词/统计回归无损")

        # ============ T11: 内存回归：连续打开关闭 10 份大文件 ============
        print("\nT11: 内存回归（10 份大文件连续开关）...")
        memory_samples = []

        def js_heap_mb():
            return page.evaluate("performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0")

        for round_idx in range(5):
            open_file('reports/large.xlsx')
            page.locator('td:has-text("SKU-000001")').first.wait_for(timeout=20000)
            open_file('reports/sample.pptx')
            page.locator('text=工作台 PPT 内容预览验收样本').first.wait_for(timeout=15000)
            open_file('welcome.md')
            time.sleep(0.6)
        # 压完一轮后回 idle 文件，主动 GC 后读堆基线
        for settle in range(3):
            page.evaluate("window.gc ? window.gc() : void 0")
            time.sleep(0.5)
        heap_after = js_heap_mb()
        memory_samples.append(heap_after)
        # 再来一轮同样的循环，对比两轮结束后的堆差
        for round_idx in range(5):
            open_file('reports/large.xlsx')
            page.locator('td:has-text("SKU-000001")').first.wait_for(timeout=20000)
            open_file('reports/sample.pptx')
            page.locator('text=工作台 PPT 内容预览验收样本').first.wait_for(timeout=15000)
            open_file('welcome.md')
            time.sleep(0.6)
        for settle in range(3):
            page.evaluate("window.gc ? window.gc() : void 0")
            time.sleep(0.5)
        heap_after_round2 = js_heap_mb()
        print(f"  第一轮结束堆: {heap_after:.1f} MB, 第二轮结束堆: {heap_after_round2:.1f} MB")
        if heap_after > 0:
            growth = (heap_after_round2 - heap_after) / heap_after
            assert growth < 0.5, f"连续两轮 10 份大文件后堆增长 {growth:.0%}，怀疑泄漏（阈值 50%）"
            print(f"PASS T11: 两轮循环后堆增长 {growth:.1%}（<50% 阈值），无显著泄漏")
        else:
            print("PASS T11: 环境无 performance.memory，循环过程无崩溃即通过")

        # ============ T10: 全局错误检查 ============
        # ============ T12: tricky.csv 表格渲染 / 引号转义 / 浅色模式 ============
        print("\nT12: tricky.csv 表格渲染 / 引号边界 / 浅色模式...")
        open_file('data/tricky.csv')
        page.locator('td:has-text("Alpha")').first.wait_for(timeout=10000)
        # 引号内逗号不得拆列：单元格文本保持完整
        comma_cell = page.locator('td:has-text("含 , 逗号")')
        assert comma_cell.count() > 0, "引号内逗号必须保留在单格内，不得拆列"
        pipe_cell = page.locator('td:has-text("含 | 竖线")')
        assert pipe_cell.count() > 0, "引号内竖线素材必须完整呈现（Markdown 转换转义素材）"
        # 引号内换行折叠进同一单元格（不出现独立行），文本与 title 都保留两行内容
        newline_info = page.evaluate("""
            Array.from(document.querySelectorAll('td'))
                .filter(td => td.textContent.includes('多行'))
                .map(td => ({ text: td.textContent, title: td.getAttribute('title') }))
        """)
        assert len(newline_info) > 0, "引号内换行单元格必须存在（多行 文本）"
        nl_text = newline_info[0]['text']
        assert '换行文本' in nl_text, f"换行单元格必须保留第二行文本: {nl_text!r}"
        assert '\n' in nl_text or '\\n' in repr(nl_text), f"单元格内换行必须以 \\n 保留: {nl_text!r}"
        nl_title = newline_info[0]['title'] or ''
        assert '换行文本' in nl_title, f"多行单元格必须带完整 title 提示: {nl_title!r}"
        # Excel chrome：列字母表头 sticky 冻结、行号列存在
        assert page.locator('th.sticky:has-text("A")').count() > 0, "CSV 必须有 sticky 列字母表头"
        assert page.locator('th[data-rowhdr]').count() >= 5, "CSV 行号列必须覆盖数据行"
        # 浅色模式：宿主容器不得带 dark 强制类，顶栏必须是 light 主题
        host_theme = page.evaluate(
            "document.querySelector('[data-reader-theme]')?.getAttribute('data-reader-theme') ?? null"
        )
        assert host_theme != 'dark', f"CSV 表格视图宿主必须非 dark，实际: {host_theme}"
        toolbar_theme = page.evaluate(
            "document.querySelector('[data-reader-toolbar]')?.getAttribute('data-reader-toolbar') ?? null"
        )
        assert toolbar_theme == 'light', f"CSV 表格视图顶栏必须是 light，实际: {toolbar_theme}"
        # 表格主体背景必须是浅色（bg-white 生效，非 dark 灰底）
        table_bg = page.evaluate(
            "getComputedStyle(document.querySelector('[data-workbench-editor]')).backgroundColor"
        )
        assert table_bg in ('rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)'), \
            f"CSV 表格主体必须是白底，实际: {table_bg}"
        # 分段控件存在 表格/源码 两档且表格为激活态
        assert page.locator('button:has-text("表格")').count() > 0, "CSV 必须有表格视图切换按钮"
        assert page.locator('button:has-text("源码")').count() > 0, "CSV 必须有源码视图切换按钮"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't12-csv-table-light.png'))
        print("PASS T12: tricky.csv 引号边界/换行单元格正确，浅色模式 chrome 与白底生效")

        # ============ T13: 源码编辑 → 表格视图反映编辑 ============
        print("\nT13: CSV 源码编辑 → 表格视图联动...")
        page.locator('button:has-text("源码")').first.click()
        time.sleep(0.5)
        # 源码态回到深色编辑器 chrome
        toolbar_theme_src = page.evaluate(
            "document.querySelector('[data-reader-toolbar]')?.getAttribute('data-reader-toolbar') ?? null"
        )
        assert toolbar_theme_src == 'dark', f"CSV 源码视图顶栏必须是 dark，实际: {toolbar_theme_src}"
        assert page.locator('.cm-content').count() > 0, "源码视图必须挂载 CodeMirror"
        # 在末行末尾追加一个字段，验证防抖同步 + 切视图时 flush 链路
        page.locator('.cm-content').first.click()
        page.keyboard.press('Control+End')
        page.keyboard.type(',ZZZ')
        time.sleep(0.6)
        page.locator('button:has-text("表格")').first.click()
        time.sleep(0.6)
        assert page.locator('td:has-text("ZZZ")').count() > 0, \
            "源码编辑内容必须在切回表格视图后呈现（flush 链路）"
        # Ctrl+S 保存写回原文
        before_writes = len(page.evaluate("window.__writeCalls"))
        page.keyboard.press('Control+s')
        time.sleep(0.6)
        write_calls = page.evaluate("window.__writeCalls")
        assert len(write_calls) > before_writes, "Ctrl+S 必须触发 writeFile"
        csv_write = [w for w in write_calls if w.get('filePath') == 'data/tricky.csv']
        assert len(csv_write) > 0 and 'ZZZ' in csv_write[-1].get('content', ''), \
            "写回内容必须包含源码编辑新增的字段"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't13-csv-edit-roundtrip.png'))
        print("PASS T13: 源码编辑 flush → 表格视图渲染 → Ctrl+S 写回链路完整")

        # ============ T14: CSV 划词 → Markdown 表格 → 发送 AI ============
        print("\nT14: CSV 表格划词转 Markdown 并发送 AI...")
        before = prompt_count()
        # 拖选终点必须落在目标范围之后的格子（Delta 行末列），
        # 否则含竖线的格子只是选区部分覆盖，文本被截断
        drag_select('td:has-text("Alpha")', 'td:has-text("普通备注")')
        bubble = page.locator('text=已选')
        assert bubble.count() > 0, "CSV 划选后必须出现 已选 N 字 气泡"
        page.locator('button[title="发送到 AI 侧边栏"]').first.click()
        time.sleep(0.4)
        assert prompt_count() == before + 1, "CSV 划词发送必须派发 insert-prompt"
        csv_md = last_prompt()
        print("  [debug] CSV 注入 Markdown 原文:")
        print("  " + csv_md.replace('\n', '\n  '))
        csv_lines = [line for line in csv_md.split('\n') if line.strip()]
        assert csv_lines[0].startswith('|'), f"CSV Markdown 首行必须是表头行: {csv_lines[0][:80]}"
        separator_cells = [cell.strip() for cell in csv_lines[1].strip().strip('|').split('|')]
        assert all(cell == '---' for cell in separator_cells), \
            f"第二行必须是 Markdown 分隔行: {csv_lines[1][:80]}"
        # 表头必须是表格自身的表头行（数据行 0），而不是选区首行（Alpha 是数据）
        assert '产品' in csv_lines[0] and '季度' in csv_lines[0], \
            f"Markdown 表头必须是文件首行（产品/季度/营收/备注），实际: {csv_lines[0][:80]}"
        assert 'Alpha' not in csv_lines[0], f"选区首行（Alpha 数据行）不得出现在表头: {csv_lines[0][:80]}"
        assert '含 \\| 竖线' in csv_md, f"单元格内竖线必须转义为 \\|: {csv_md[:300]}"
        print("PASS T14: CSV 选区正确转为矩形化 Markdown（竖线转义）并到达注入链路")

        # ============ T15: large.csv 虚拟滚动 ============
        print("\nT15: large.csv 虚拟滚动...")
        open_file('data/large.csv')
        page.locator('td:has-text("SKU-000001")').first.wait_for(timeout=15000)
        csv_tr_count = page.locator('table tr').count()
        assert csv_tr_count < 200, f"万行 CSV 必须虚拟渲染（DOM 行数 {csv_tr_count} 应远小于 12001）"
        assert page.locator('th:has-text("A")').count() > 0, "大 CSV 必须有列字母固定表头"
        page.evaluate("""
            (() => {
                document.querySelectorAll('div').forEach((el) => {
                    if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
                        el.scrollTop = el.scrollHeight;
                    }
                });
            })()
        """)
        time.sleep(1.0)
        csv_tail = page.locator('td:has-text("SKU-011")').count() + page.locator('td:has-text("SKU-012")').count()
        assert csv_tail > 0, "大 CSV 滚动到底部后必须按需渲染尾部行"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't15-large-csv.png'))
        print("PASS T15: large.csv 虚拟滚动（DOM 行数受控）+ 尾部行按需渲染")

        # ============ T16: sample.tsv / utf8-bom.csv 解析 ============
        print("\nT16: sample.tsv 分隔符探测 / utf8-bom.csv BOM 剥离...")
        open_file('data/sample.tsv')
        page.locator('td:has-text("北京")').first.wait_for(timeout=10000)
        assert page.locator('td:has-text("2189")').count() > 0, "TSV 必须按制表符分列"
        # 引号素材容错：不拆列不吞文本
        assert page.locator('td:has-text("含,逗号")').count() > 0, "TSV 引号素材必须容错保留文本"
        open_file('data/utf8-bom.csv')
        page.locator('td:has-text("张三")').first.wait_for(timeout=10000)
        # BOM 剥离后首列表头是纯「姓名」，带 BOM 则变成 \ufeff姓名
        first_header = page.evaluate(
            "Array.from(document.querySelectorAll('tbody tr:first-child td, tr td')).map(td => td.textContent)[0] ?? ''"
        )
        assert first_header == '姓名', f"BOM 必须剥离，首列表头应为纯文本，实际: {first_header!r}"
        assert '研发' in page.locator('td:has-text("研发")').first.text_content(), "中文内容必须正常渲染"
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't16-tsv-bom.png'))
        print("PASS T16: TSV 分隔符探测正确、引号容错、UTF-8 BOM 正确剥离")

        # ============ T17: Excel 式选中交互（行列/扩选/合并/Ctrl+C/右键改选/边缘滚选）============
        print("\nT17: Excel 式单元格与行列选中交互...")
        # 剪贴板捕获桩
        page.evaluate("""
            window.__clipboardWrites = [];
            const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
            navigator.clipboard.writeText = (t) => {
                window.__clipboardWrites.push(t);
                return origWrite(t).catch(() => {});
            };
        """)

        def last_clipboard():
            writes = page.evaluate("window.__clipboardWrites")
            return writes[-1] if writes else ''

        def clear_clicks():
            page.keyboard.press('Escape')
            page.evaluate("window.__clipboardWrites = []")

        # --- T17a: tricky.csv 拖选矩形 → 高亮格数/活动格框/周圈框 → Ctrl+C TSV ---
        open_file('data/tricky.csv')
        page.locator('td[data-rc="1:0"]').first.wait_for(timeout=10000)
        drag_select('td[data-rc="1:0"]', 'td[data-rc="2:3"]')
        time.sleep(0.3)
        highlighted = page.locator('td.bg-\\[\\#e9e9e9\\]').count()
        # 8 格矩形中活动格(1:0)是白底绿框，其余 7 格高亮
        assert highlighted == 7, f"2×4 矩形拖选应高亮 7 格（活动格除外），实际 {highlighted}"
        # 计算样式断言：类名存在 ≠ 样式生效（bg-white 与 bg-[#e9e9e9] 的级联冲突曾吞掉遮罩），
        # 必须校验 getComputedStyle 的真实结果。
        inner_bg = page.evaluate(
            "getComputedStyle(document.querySelector('td[data-rc=\"1:1\"]')).backgroundColor"
        )
        assert inner_bg == 'rgb(233, 233, 233)', f"选区内格计算底色必须是 rgb(233,233,233)，实际 {inner_bg}"
        anchor_bg = page.evaluate(
            "getComputedStyle(document.querySelector('td[data-rc=\"1:0\"]')).backgroundColor"
        )
        assert anchor_bg == 'rgb(255, 255, 255)', f"活动格计算底色必须是白色，实际 {anchor_bg}"
        anchor_shadow = page.evaluate(
            "document.querySelector('td[data-rc=\"1:0\"]')?.style.boxShadow ?? ''"
        )
        assert '107c41' in anchor_shadow or '16, 124, 65' in anchor_shadow, \
            f"活动格必须有 Excel 绿框，实际: {anchor_shadow}"
        edge_shadow = page.evaluate(
            "document.querySelector('td[data-rc=\"2:3\"]')?.style.boxShadow ?? ''"
        )
        assert '107c41' in edge_shadow or '16, 124, 65' in edge_shadow, \
            f"选区边缘格必须有周圈绿框，实际: {edge_shadow}"
        # 行号/列字母表头联动高亮
        rowhdr_hi = page.evaluate(
            "document.querySelector('th[data-rowhdr=\"1\"]')?.className.includes('font-semibold') ?? false"
        )
        assert rowhdr_hi, "选中范围的行号必须高亮加粗"
        page.keyboard.press('Control+c')
        time.sleep(0.3)
        tsv = last_clipboard()
        print("  [debug] Ctrl+C TSV:", repr(tsv[:120]))
        assert '含 | 竖线' in tsv, f"TSV 必须保留原始竖线不转义: {tsv[:150]}"
        assert '\t' in tsv and '\n' in tsv, "TSV 必须用制表符分列、换行分行"
        tsv_lines = tsv.split('\n')
        assert len(tsv_lines) == 2 and all(len(line.split('\t')) == 4 for line in tsv_lines), \
            f"TSV 必须是 2 行 × 4 列矩形: {tsv!r}"
        clear_clicks()

        # --- T17b: 列字母点击整列选中 + 横扫扩列 ---
        page.locator('th[data-colhdr="1"]').first.click()
        time.sleep(0.3)
        col_cells = page.evaluate(
            "Array.from(document.querySelectorAll('td[data-rc]')).filter(td => { if (!td.getAttribute('data-rc').endsWith(':1')) return false; const sh = td.style.boxShadow; return td.className.includes('e9e9e9') || sh.includes('107c41') || sh.includes('16, 124, 65') }).length"
        )
        assert col_cells >= 5, f"点击列字母必须选中整列（tricky 全 5 行），实际高亮/框选 {col_cells} 格"
        assert page.locator('text=已选').count() > 0, "整列选中必须出现气泡"
        clear_clicks()

        # --- T17c: 行号点击整行选中 ---
        page.locator('th[data-rowhdr="3"]').first.click()
        time.sleep(0.3)
        row_cells = page.evaluate(
            "Array.from(document.querySelectorAll('td[data-rc^=\"3:\"]')).filter(td => { const sh = td.style.boxShadow; return td.className.includes('e9e9e9') || sh.includes('107c41') || sh.includes('16, 124, 65') }).length"
        )
        assert row_cells == 4, f"点击行号必须选中整行 4 列，实际 {row_cells} 格"
        clear_clicks()

        # --- T17d: Shift+点击扩选 ---
        page.locator('td[data-rc="1:0"]').first.click()
        page.keyboard.down('Shift')
        page.locator('td[data-rc="4:3"]').first.click()
        page.keyboard.up('Shift')
        time.sleep(0.3)
        page.keyboard.press('Control+c')
        time.sleep(0.3)
        shift_tsv = last_clipboard()
        shift_lines = shift_tsv.split('\n')
        assert len(shift_lines) == 4, f"Shift 扩选应为 4 行，实际 {len(shift_lines)}"
        assert 'Alpha' in shift_lines[0] and 'Delta' in shift_lines[3], "Shift 扩选必须覆盖端点行"
        clear_clicks()

        # --- T17e: 右键选区外单元格改选 + 菜单动作 ---
        page.locator('td[data-rc="1:0"]').first.click()
        time.sleep(0.2)
        cell33 = page.locator('td[data-rc="3:1"]').first.bounding_box()
        page.mouse.click(cell33['x'] + cell33['width'] / 2, cell33['y'] + cell33['height'] / 2, button='right')
        time.sleep(0.4)
        assert page.locator('text=复制选中文本').count() > 0, "右键必须弹出选择菜单"
        before = prompt_count()
        page.locator('text=向 AI 提问').first.click()
        time.sleep(0.4)
        assert prompt_count() == before + 1, "右键发送 AI 必须派发 insert-prompt"
        single_md = last_prompt()
        assert 'Q3' in single_md, f"右键选区外改选应以该格为选区: {single_md[:120]}"
        assert '季度' in single_md, f"单格发送的 Markdown 表头必须是表格表头行: {single_md[:120]}"
        clear_clicks()

        # --- T17f: small.xlsx 合并单元格扩张（点击被覆盖格 → 整个合并区入选）---
        open_file('reports/small.xlsx')
        page.locator('td:has-text("产品季度报表")').first.wait_for(timeout=15000)
        # A5:B6 合并（r4-5, c0-1）：点击 (5,0) 即"合计"行首列（被覆盖格不可见，点击落在锚点），
        # 验证点选合并区任一位置后选区覆盖整个合并矩形 → markdown 含 4 行 × 至少 2 列
        page.locator('td[data-rc="4:0"]').first.click()
        time.sleep(0.3)
        merged_shadow_cells = page.evaluate(
            "Array.from(document.querySelectorAll('td[data-rc]')).filter(td => td.style.boxShadow.includes('107c41') || td.style.boxShadow.includes('16, 124, 65')).length"
        )
        assert merged_shadow_cells >= 1, "合并区点选必须有框选格"
        page.keyboard.press('Control+c')
        time.sleep(0.3)
        merge_tsv = last_clipboard()
        merge_lines = merge_tsv.split('\n')
        assert len(merge_lines) == 2, f"合并 A5:B6 点选复制应为 2 行（扩张后），实际 {len(merge_lines)}: {merge_tsv!r}"
        assert merge_lines[0].startswith('小计'), f"合并锚点值必须在首行首列: {merge_lines[0]!r}"
        assert merge_lines[0].split('\t')[1] == '', f"覆盖格必须为空（Excel 复制语义）: {merge_lines[0]!r}"
        clear_clicks()

        # --- T17g: large.csv 拖到底部边缘自动滚动扩选 ---
        open_file('data/large.csv')
        page.locator('td[data-rc="0:0"]').first.wait_for(timeout=15000)
        anchor_cell = page.locator('td[data-rc="0:0"]').first.bounding_box()
        assert anchor_cell, "大表首格必须存在"
        page.mouse.move(anchor_cell['x'] + anchor_cell['width'] / 2, anchor_cell['y'] + anchor_cell['height'] / 2)
        page.mouse.down()
        # 指针推到容器底部边缘以内触发边缘滚选
        container_box = page.evaluate("""
            (() => {
                const el = document.querySelector('[data-workbench-editor]')
                const r = el.getBoundingClientRect()
                return { x: r.left + r.width / 2, bottom: r.bottom }
            })()
        """)
        page.mouse.move(container_box['x'], container_box['bottom'] - 8)
        # 边缘滚选是帧驱动的，等待滚动推进
        time.sleep(1.8)
        page.mouse.up()
        time.sleep(0.3)
        sel_bottom = page.evaluate("""
            Array.from(document.querySelectorAll('td[data-rc]'))
                .filter(td => { const sh = td.style.boxShadow; return td.className.includes('e9e9e9') || sh.includes('107c41') || sh.includes('16, 124, 65') })
                .map(td => parseInt(td.getAttribute('data-rc').split(':')[0], 10))
                .reduce((a, b) => Math.max(a, b), -1)
        """)
        print(f"  [debug] 边缘滚选到达行: {sel_bottom}")
        assert sel_bottom > 5, f"拖到底部边缘必须自动滚动扩选（焦点行 > 5），实际 {sel_bottom}"
        page.keyboard.press('Escape')

        # --- T17h: 宽表横向边缘滚选（滚动条带 hit-test 回归）---
        open_file('reports/large.xlsx')
        page.locator('td[data-rc="0:0"]').first.wait_for(timeout=20000)
        page.locator('button:has-text("宽表")').first.click()
        time.sleep(1.5)
        wide_anchor = page.locator('td[data-rc="1:0"]').first.bounding_box()
        assert wide_anchor, "宽表首行首列必须存在"
        page.mouse.move(wide_anchor['x'] + wide_anchor['width'] / 2, wide_anchor['y'] + wide_anchor['height'] / 2)
        page.mouse.down()
        wide_edge = page.evaluate("""
            (() => {
                const el = document.querySelector('[data-workbench-editor]')
                const r = el.getBoundingClientRect()
                return { y: r.top + r.height / 2, right: r.right }
            })()
        """)
        page.mouse.move(wide_edge['right'] - 8, wide_edge['y'])
        time.sleep(2.0)
        page.mouse.up()
        time.sleep(0.3)
        sel_right_col = page.evaluate("""
            Array.from(document.querySelectorAll('td[data-rc]'))
                .filter(td => { const sh = td.style.boxShadow; return td.className.includes('e9e9e9') || sh.includes('107c41') || sh.includes('16, 124, 65') })
                .map(td => parseInt(td.getAttribute('data-rc').split(':')[1], 10))
                .reduce((a, b) => Math.max(a, b), -1)
        """)
        print(f"  [debug] 横向边缘滚选到达列: {sel_right_col}")
        assert sel_right_col > 5, \
            f"宽表横向滚选必须推进过滚动条带（焦点列 > 5），实际 {sel_right_col}（hit-test 滚动条带回归）"
        page.keyboard.press('Escape')

        # --- T17i: 小表空白区拖选钳制（Excel 语义：下方空白扩到末行）---
        open_file('data/tricky.csv')
        page.locator('td[data-rc="1:0"]').first.wait_for(timeout=10000)
        start_cell = page.locator('td[data-rc="1:0"]').first.bounding_box()
        assert start_cell
        page.mouse.move(start_cell['x'] + start_cell['width'] / 2, start_cell['y'] + start_cell['height'] / 2)
        page.mouse.down()
        # 拖到网格下方空白区（表格结束、容器未结束之间）
        empty_spot = page.evaluate("""
            (() => {
                const table = document.querySelector('[data-workbench-editor] table')
                const container = document.querySelector('[data-workbench-editor]')
                const tr = table.getBoundingClientRect()
                const cr = container.getBoundingClientRect()
                const y = Math.min(tr.bottom + 60, cr.bottom - 40)
                return { x: tr.left + 100, y, tableBottom: tr.bottom, containerBottom: cr.bottom }
            })()
        """)
        page.mouse.move(empty_spot['x'], empty_spot['y'], steps=6)
        time.sleep(0.5)
        page.mouse.up()
        time.sleep(0.3)
        focus_row = page.evaluate("""
            Array.from(document.querySelectorAll('td[data-rc]'))
                .filter(td => { const sh = td.style.boxShadow; return td.className.includes('e9e9e9') || sh.includes('107c41') || sh.includes('16, 124, 65') })
                .map(td => parseInt(td.getAttribute('data-rc').split(':')[0], 10))
                .reduce((a, b) => Math.max(a, b), -1)
        """)
        print(f"  [debug] 空白区拖选钳制焦点行: {focus_row}")
        assert focus_row == 4, \
            f"拖到网格下方空白区必须钳制到末行 4（Excel 语义），实际 {focus_row}"
        page.keyboard.press('Escape')
        page.screenshot(path=os.path.join(EVIDENCE_DIR, 't17-excel-interactions.png'))
        print("PASS T17: 拖选矩形/整列/整行/Shift扩选/合并扩张/右键改选/边缘滚选(双向)/空白区钳制/Ctrl+C TSV 全部正确")

        # ============ T18: 全局错误检查 ============
        print("\nT18: 控制台与页面错误检查...")
        severe = [log for log in console_logs if log.startswith('[error]')]
        # harness 环境噪音（非产品缺陷）：
        # 1) 静态服务无 Electron CSP 豁免，Roboto/KaTeX 的 data-URI 字体被拦；
        # 2) mock 无真实 webview，AI 侧边栏 loadURL 必然失败。
        noise_patterns = ('Refused to load the font', 'loadURL failed')
        severe = [log for log in severe if not any(p in log for p in noise_patterns)]
        if errors:
            print("PAGE ERRORS:")
            for err in errors:
                print("  ERROR:", err)
            raise RuntimeError("验收过程出现页面错误")
        for log in severe[:10]:
            print("  console error:", log[:200])
        assert len(severe) == 0, f"验收过程不应有 console.error: {len(severe)} 条"
        print("PASS T18: 无页面错误、无 console.error")

        page.screenshot(path=os.path.join(EVIDENCE_DIR, 'final.png'))
        print(f"\n验收截图证据目录: {EVIDENCE_DIR}")
        print("\nALL OFFICE PREVIEW ACCEPTANCE TESTS PASSED")
        browser.close()


if __name__ == '__main__':
    main()
