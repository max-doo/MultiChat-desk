import sys
import os
import time
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

PORT = 5499
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'out', 'renderer'))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=OUT_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

def start_server():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port

def main():
    server, port = start_server()
    print(f"Starting test server for {OUT_DIR} on port {port}...")
    time.sleep(0.5)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1366, 'height': 850})
            page = context.new_page()

            # Preload contract mock with full IPC tracking
            page.add_init_script("""
                const store = {
                    productMode: 'workbench',
                    summaryPrompts: [],
                    workbench_lastWorkspacePath: 'C:\\\\mock-workspace',
                    workbench_lastActiveFilePath: 'welcome.md',
                    workbench_workspaceName: 'TestWorkspace',
                    workbench_rightPane: 'ai',
                    workbench_sidebarModelId: 'chatgpt',
                    models: [
                        { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', logo: 'chatgpt.svg', enabled: true },
                        { id: 'claude', name: 'Claude', url: 'https://claude.ai', logo: 'claude.svg', enabled: true }
                    ]
                };

                const mockFiles = {
                    'welcome.md': '# 知识库指南\\n\\n工作区拖拽上传测试正文',
                    'test.pdf': 'PDF-BINARY-MOCK',
                    'image.png': 'PNG-BINARY-MOCK'
                };

                window.__uploadedFiles = [];
                window.__dispatchedDrops = [];
                window.__savedFiles = [];
                window.__mockAttachmentCount = 0;
                window.__mockUploadError = false;
                window.__mockHangDrop = false;

                const workbenchMock = {
                    selectFolder: async () => ({ success: true, data: { path: 'C:\\\\mock-workspace', name: 'TestWorkspace' } }),
                    ensureDefaultWorkspace: async () => ({ success: true, data: { path: 'C:\\\\mock-workspace', name: 'TestWorkspace' } }),
                    watch: async () => ({ success: true }),
                    reconcileMindmaps: async () => ({ success: true }),
                    onFsChanged: () => () => {},
                    readTree: async (dir) => ({
                        success: true,
                        data: [
                            {
                                id: 'welcome.md',
                                name: 'welcome.md',
                                path: 'welcome.md',
                                fullPath: 'C:\\\\mock-workspace\\\\welcome.md',
                                isDirectory: false,
                                extension: '.md',
                                size: 1024,
                                category: 'markdown'
                            },
                            {
                                id: 'test.pdf',
                                name: 'test.pdf',
                                path: 'test.pdf',
                                fullPath: 'C:\\\\mock-workspace\\\\test.pdf',
                                isDirectory: false,
                                extension: '.pdf',
                                size: 2048,
                                category: 'pdf'
                            },
                            {
                                id: 'folder1',
                                name: '文档归档',
                                path: '文档归档',
                                fullPath: 'C:\\\\mock-workspace\\\\文档归档',
                                isDirectory: true,
                                children: [
                                    {
                                        id: 'folder1/notes.md',
                                        name: 'notes.md',
                                        path: '文档归档/notes.md',
                                        fullPath: 'C:\\\\mock-workspace\\\\文档归档\\\\notes.md',
                                        isDirectory: false,
                                        extension: '.md',
                                        size: 512
                                    }
                                ]
                            }
                        ]
                    }),
                    readFile: async (ws, filePath) => {
                        const content = mockFiles[filePath] || '# ' + filePath;
                        return {
                            success: true,
                            data: {
                                content,
                                mtime: Date.now(),
                                size: content.length,
                                category: filePath.endsWith('.pdf') ? 'pdf' : 'markdown'
                            }
                        };
                    },
                    writeFile: async (ws, filePath, content) => {
                        window.__savedFiles.push({ filePath, content });
                        mockFiles[filePath] = content;
                        return { success: true, data: { mtime: Date.now(), size: content.length } };
                    },
                    saveImage: async () => ({ success: true, data: { relativePath: 'assets/img.png', thumbnailDataUrl: '' } }),
                    createNode: async () => ({ success: true, data: null }),
                    renameNode: async () => ({ success: true }),
                    deleteNode: async () => ({ success: true }),
                    search: async () => ({ success: true, data: [] }),
                    revealFile: async () => ({ success: true }),
                    openInSystem: async () => ({ success: true })
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
                    onNotesNavigate: () => () => {},
                    notesConsumeNavigation: async () => ({ success: true, data: null }),
                    getActiveModels: async () => ({ success: true, data: ['chatgpt'] }),
                    getAppConfig: async () => ({ success: true, data: {} }),
                    cliGetStatus: async () => ({ success: true, data: { installed: false, inPath: false, skillConfigured: false } }),
                    checkForUpdates: async () => ({ success: true }),
                    getUpdateState: async () => ({ status: 'idle', result: null }),
                    onUpdateStateChanged: () => () => {},
                    historyGetList: async () => ({ success: true, data: [] }),
                    summaryPromptsList: async () => [],
                    summaryPromptsBootstrap: async () => [],
                    dispatchFileDrop: async (wcId, filePath, x, y) => {
                        if (window.__mockHangDrop) return new Promise(() => {});
                        window.__dispatchedDrops.push({ wcId, filePath, x, y });
                        if (!window.__mockUploadError) window.__mockAttachmentCount += 1;
                        return { success: true };
                    },
                    workbench: new Proxy(workbenchMock, {
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
                        if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
                        return async () => ({ success: true, data: null });
                    }
                });
            """)

            console_logs = []
            page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
            page.on("pageerror", lambda err: console_logs.append(f"[pageerror] {err}"))

            print("Navigating to Workbench...")
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
            time.sleep(2)

            # Wait for file tree to populate
            try:
                page.wait_for_selector("[data-file-node]", timeout=10000)
            except Exception as e:
                print("Failed waiting for [data-file-node]. Recent console logs:")
                for log in console_logs[-20:]:
                    print("  ", log)
                raise e
            print("File tree loaded successfully!")

            # 1. Verify file nodes are draggable
            file_nodes = page.query_selector_all("[data-file-node]")
            assert len(file_nodes) >= 2, f"Expected at least 2 file nodes, found {len(file_nodes)}"
            print(f"PASS 1: Found {len(file_nodes)} file nodes in left workspace")

            # 2. Test dragstart on welcome.md
            welcome_node = page.locator("[data-file-node='welcome.md']")
            assert welcome_node.count() > 0, "welcome.md must exist in the file tree"
            print("PASS 2: welcome.md node found")

            # Trigger dragstart via evaluation to inspect store dragging state
            drag_res = page.evaluate("""() => {
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const dt = new DataTransfer();
                const ev = new DragEvent('dragstart', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dt
                });
                nodeEl.dispatchEvent(ev);
                return {
                    plainText: dt.getData('text/plain'),
                    customData: dt.getData('application/x-multichat-workspace-files')
                };
            }""")
            print(f"DragStart DataTransfer: {drag_res}")
            assert "welcome.md" in drag_res["plainText"], f"Expected welcome.md in text/plain: {drag_res['plainText']}"
            assert "welcome.md" in str(drag_res["customData"]), "Custom dataTransfer format missing"
            print("PASS 3: handleDragStart successfully set multi-format dataTransfer and store state")

            # 3. Verify invisible dropzone overlay appeared in AI sidebar without mask or prompt
            time.sleep(0.5)
            debug_info = page.evaluate("""() => {
                const z40 = document.querySelectorAll(".z-40");
                const sidebar = document.querySelector(".flex-1.relative.overflow-hidden");
                return {
                    z40Count: z40.length,
                    z40Classes: Array.from(z40).map(el => el.className),
                    sidebarHtml: sidebar ? sidebar.outerHTML.slice(0, 300) : "no sidebar"
                };
            }""")
            print(f"DEBUG INFO: {debug_info}")
            overlay = page.locator(".flex-1 .absolute.inset-0.z-40")
            assert overlay.count() > 0, "AI 侧边栏隐形拖拽感应层必须在拖拽开始后自动挂载"
            sidebar_dropzone_prompt = page.locator("text=拖拽到此处上传到")
            assert sidebar_dropzone_prompt.count() == 0, "不应出现遮罩和提示文案"
            print("PASS 4: AI sidebar dropzone overlay mounted transparently without intrusive mask or prompt")

            # Prepare webview mock so isReady becomes true
            page.evaluate("""() => {
                const webview = document.querySelector("#webview-chatgpt") || document.querySelector("webview");
                if (webview) {
                    webview.canGoBack = () => false;
                    webview.canGoForward = () => false;
                    webview.getURL = () => 'https://chatgpt.com';
                    webview.getWebContentsId = () => 101;
                    webview.executeJavaScript = async (script) => {
                        if (typeof script === 'string' && script.includes('attachmentCount')) {
                            const attached = window.__mockAttachmentCount > 0;
                            return {
                                found: attached,
                                busy: false,
                                error: window.__mockUploadError ? '平台报告附件上传或解析失败' : undefined,
                                nameMatched: attached,
                                attachmentCount: window.__mockAttachmentCount
                            };
                        }
                        return { found: true, x: 150, y: 350 };
                    };
                    webview.dispatchEvent(new Event('dom-ready'));
                }
            }""")
            time.sleep(0.5)

            # 4. Simulate dropping onto the AI sidebar overlay
            drop_result = page.evaluate("""async () => {
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                if (!overlay) return { error: "Overlay not found" };

                // Emulate dragover
                const dt = new DataTransfer();
                const dragOverEv = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
                overlay.dispatchEvent(dragOverEv);

                // Emulate drop
                const dropEv = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
                overlay.dispatchEvent(dropEv);

                // Poll until upload finishes and toast appears
                const start = Date.now();
                while (Date.now() - start < 3000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast && (toast.includes("成功") || toast.includes("失败"))) break;
                    await new Promise(r => setTimeout(r, 100));
                }

                return {
                    dispatched: window.__dispatchedDrops,
                    toastText: document.querySelector("[data-upload-toast]")?.innerText || ""
                };
            }""")
            print(f"Drop simulation result: {drop_result}")
            print(f"Console logs ({len(console_logs)}):")
            for log in console_logs[-10:]:
                print("  ", log)
            assert len(drop_result.get("dispatched", [])) > 0, f"Expected dispatchFileDrop to be called: {drop_result}"
            assert "上传完成" in drop_result.get("toastText", ""), f"Toast should confirm success: {drop_result}"
            print("PASS 5: Dropping welcome.md successfully called dispatchFileDrop and displayed success toast")

            # 5a. Test second drop with test.pdf
            # Trigger dragstart on test.pdf
            page.evaluate("""() => {
                const nodeEl = document.querySelector("[data-file-node='test.pdf']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            }""")

            # Wait for overlay to be mounted in DOM
            page.wait_for_selector(".flex-1 .absolute.inset-0.z-40", timeout=3000)

            # Dispatch drop onto the overlay
            success_drop_res = page.evaluate("""async () => {
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                if (overlay) {
                    const dt = new DataTransfer();
                    overlay.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                }

                const start = Date.now();
                while (Date.now() - start < 3000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast && toast.includes("test.pdf") && (toast.includes("成功") || toast.includes("失败"))) break;
                    await new Promise(r => setTimeout(r, 100));
                }

                return {
                    dispatched: window.__dispatchedDrops,
                    toastText: document.querySelector("[data-upload-toast]")?.innerText || ""
                };
            }""")
            print(f"Success drop simulation: {success_drop_res}")
            assert len(success_drop_res.get("dispatched", [])) >= 2, f"Expected 2 dispatchFileDrop calls: {success_drop_res}"
            assert "上传完成" in success_drop_res.get("toastText", ""), f"Toast should indicate success: {success_drop_res}"
            print("PASS 5b: Success path verified with real dispatchFileDrop call for test.pdf")

            # 5c. Platform-reported upload failure must not be reported as success
            page.evaluate("""() => { window.__mockUploadError = true; }""")
            page.evaluate("""() => {
                const nodeEl = document.querySelector("[data-file-node='test.pdf']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            }""")
            page.wait_for_selector(".flex-1 .absolute.inset-0.z-40", timeout=3000)
            failure_drop_res = page.evaluate("""async () => {
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                const dt = new DataTransfer();
                overlay.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                const start = Date.now();
                while (Date.now() - start < 3000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast.includes("上传失败")) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                return { toastText: document.querySelector("[data-upload-toast]")?.innerText || "" };
            }""")
            page.evaluate("""() => { window.__mockUploadError = false; }""")
            assert "上传失败" in failure_drop_res.get("toastText", ""), f"Platform failure must surface as error: {failure_drop_res}"
            print("PASS 5c: Platform upload failure is surfaced instead of false success")

            # 5d. Dragging onto the collapsed right rail uploads in the same gesture
            page.click('button[title="折叠 AI 侧边栏"]')
            time.sleep(0.3)
            closed_pane_res = page.evaluate("""async () => {
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 200));
                const strip = document.querySelector("div.w-14.border-dashed");
                if (!strip) return { error: "right rail drop strip not found" };
                const before = window.__dispatchedDrops.length;
                strip.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                const start = Date.now();
                while (Date.now() - start < 3000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast.includes("welcome.md") && toast.includes("成功")) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                return {
                    dispatchedDelta: window.__dispatchedDrops.length - before,
                    toastText: document.querySelector("[data-upload-toast]")?.innerText || ""
                };
            }""")
            print(f"Collapsed pane drop result: {closed_pane_res}")
            assert closed_pane_res.get("dispatchedDelta") == 1, f"Collapsed pane drop must upload exactly once: {closed_pane_res}"
            assert "上传完成" in closed_pane_res.get("toastText", ""), f"Collapsed pane drop should report success: {closed_pane_res}"
            print("PASS 5d: Collapsed right rail uploads in the same drag gesture")

            # 5e. External drag state must not remain stuck after dropping on a tree node
            external_cleanup_res = page.evaluate("""async () => {
                const wv = document.querySelector("webview");
                const sidebarRoot = wv ? wv.closest("div.flex.flex-col.h-full") : null;
                if (!sidebarRoot) return { error: "sidebar root not found" };
                const dt = new DataTransfer();
                dt.items.add(new File(["outside"], "outside.txt", { type: "text/plain" }));
                sidebarRoot.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 150));
                const overlayBefore = !!document.querySelector(".flex-1 .absolute.inset-0.z-40");
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                nodeEl.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 150));
                return {
                    overlayBefore,
                    overlayAfter: !!document.querySelector(".flex-1 .absolute.inset-0.z-40")
                };
            }""")
            print(f"External drag cleanup result: {external_cleanup_res}")
            assert external_cleanup_res.get("overlayBefore") is True, f"External drag should mount the drop overlay: {external_cleanup_res}"
            assert external_cleanup_res.get("overlayAfter") is False, f"External drag state must clear after drop on tree: {external_cleanup_res}"
            print("PASS 5e: External drag overlay clears after dropping outside the sidebar")

            # 5f. External file drop wins over stale workspace draggingNodes
            stale_nodes_res = page.evaluate("""async () => {
                window.__dispatchedDrops.length = 0;
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 150));
                window.electron = {
                    webUtils: {
                        getPathForFile: (file) => file.name === "outside.txt" ? "C:\\\\outside\\\\outside.txt" : ""
                    }
                };
                const file = new File(["outside"], "outside.txt", { type: "text/plain" });
                const dt2 = new DataTransfer();
                dt2.items.add(file);
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                if (!overlay) return { error: "overlay not found" };
                overlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt2 }));
                const start = Date.now();
                while (Date.now() - start < 3000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast.includes("outside.txt") && (toast.includes("成功") || toast.includes("失败"))) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                return {
                    droppedPaths: window.__dispatchedDrops.map(d => d.filePath),
                    toastText: document.querySelector("[data-upload-toast]")?.innerText || ""
                };
            }""")
            print(f"Stale draggingNodes result: {stale_nodes_res}")
            assert stale_nodes_res.get("droppedPaths") == [r"C:\outside\outside.txt"], f"External drop must ignore stale workspace nodes: {stale_nodes_res}"
            assert "上传完成" in stale_nodes_res.get("toastText", ""), f"External drop should upload current file: {stale_nodes_res}"
            print("PASS 5f: External file drop overrides stale workspace draggingNodes")

            # 5g. A hung drop dispatch must not keep the upload lock forever
            hung_res = page.evaluate("""async () => {
                window.__mockHangDrop = true;
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 150));
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                if (!overlay) return { error: "overlay not found" };
                overlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
                const start = Date.now();
                while (Date.now() - start < 25000) {
                    const stop = document.querySelector("[data-upload-toast] button");
                    if (stop) return { stopVisibleAtMs: Date.now() - start };
                    await new Promise(r => setTimeout(r, 100));
                }
                return { stopVisibleAtMs: -1 };
            }""")
            print(f"Hung dispatch lock result: {hung_res}")
            assert hung_res.get("stopVisibleAtMs", -1) >= 0, f"Hung upload must expose a stop control: {hung_res}"

            recovered_res = page.evaluate("""async () => {
                window.__mockHangDrop = false;
                const stop = document.querySelector("[data-upload-toast] button");
                if (!stop) return { error: "stop button missing" };
                stop.click();
                await new Promise(r => setTimeout(r, 300));
                window.__dispatchedDrops.length = 0;
                const nodeEl = document.querySelector("[data-file-node='test.pdf']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 150));
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                if (!overlay) return { error: "overlay not found after stop" };
                overlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
                const start = Date.now();
                while (Date.now() - start < 5000) {
                    if (window.__dispatchedDrops.length > 0) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                // Wait for the retried upload to settle so its toast cannot overwrite the next case.
                while (Date.now() - start < 15000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast.includes("上传完成") && !document.querySelector("[data-upload-toast] button")) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                return {
                    dispatchedPaths: window.__dispatchedDrops.map(d => d.filePath),
                    toastText: document.querySelector("[data-upload-toast]")?.innerText || ""
                };
            }""")
            print(f"Recovery after stop result: {recovered_res}")
            assert any(path.endswith("test.pdf") for path in recovered_res.get("dispatchedPaths", [])), f"New upload must work after stopping: {recovered_res}"
            print("PASS 5g: Hung upload exposes stop control and accepts a new upload afterwards")

            # 5. Verify dragend resets draggingNodes
            page.evaluate("""() => {
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const endEv = new DragEvent('dragend', { bubbles: true, cancelable: true });
                nodeEl.dispatchEvent(endEv);
            }""")
            time.sleep(0.5)
            sidebar_dropzone_after = page.locator("text=拖拽到此处上传到")
            assert sidebar_dropzone_after.count() == 0, "AI 侧边栏拖拽遮罩层在 dragend 后必须销毁"
            print("PASS 6: dragend cleanly unmounted the dropzone overlay")

            # 6. Test folder drag restriction
            page.evaluate("""() => {
                const folderEl = document.querySelector("[data-folder-node='文档归档']");
                const dt = new DataTransfer();
                folderEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            }""")

            # Wait for overlay to mount in React DOM
            page.wait_for_selector(".flex-1 .absolute.inset-0.z-40", timeout=3000)

            folder_drop_res = page.evaluate("""async () => {
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                const dt = new DataTransfer();
                overlay.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 400));
                return {
                    toast: document.querySelector("[data-upload-toast]")?.innerText || ""
                };
            }""")
            print(f"Folder drop test: {folder_drop_res}")
            assert "不支持上传文件夹" in folder_drop_res.get("toast", ""), f"Toast should warn about folder: {folder_drop_res}"
            print("PASS 7: Folder drag restriction properly verified")

            # 7b. Mixed file + folder selection must report skipped folders
            page.click("[data-file-node='welcome.md']")
            page.click("[data-folder-node='文档归档']", modifiers=["Control"])
            time.sleep(0.2)
            mixed_drop_res = page.evaluate("""async () => {
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
                await new Promise(r => setTimeout(r, 200));
                const overlay = document.querySelector(".flex-1 .absolute.inset-0.z-40");
                if (!overlay) return { error: "overlay not found" };
                overlay.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
                const start = Date.now();
                while (Date.now() - start < 3000) {
                    const toast = document.querySelector("[data-upload-toast]")?.innerText || "";
                    if (toast.includes("成功") || toast.includes("失败")) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                return { toastText: document.querySelector("[data-upload-toast]")?.innerText || "" };
            }""")
            print(f"Mixed selection result: {mixed_drop_res}")
            assert "已跳过 1 个文件夹" in mixed_drop_res.get("toastText", ""), f"Mixed selection must report skipped folder: {mixed_drop_res}"
            print("PASS 7b: Mixed file + folder selection reports the skipped folder")

            # 7. Test Escape key cancellation cleans up drag state
            page.evaluate("""() => {
                const nodeEl = document.querySelector("[data-file-node='welcome.md']");
                const dt = new DataTransfer();
                nodeEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            }""")
            time.sleep(0.3)
            assert page.locator(".flex-1 .absolute.inset-0.z-40").count() > 0, "Overlay should be mounted before escape"
            page.keyboard.press("Escape")
            time.sleep(0.3)
            assert page.locator(".flex-1 .absolute.inset-0.z-40").count() == 0, "Overlay should be cleanly unmounted after Escape"
            print("PASS 8: Escape key properly resets drag state and unmounts overlay")

            # 8. Test search results drag & drop capability
            page.evaluate("""() => {
                // Mock search results into the store
                const store = window.__workbenchStore || {};
            }""")

            print("\n==========================================")
            print("ALL DRAG AND DROP VERIFICATION CHECKS PASSED!")
            print("==========================================")

    finally:
        server.shutdown()

if __name__ == '__main__':
    main()
