const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1366,
    height: 850,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: false
    }
  });

  const indexPath = path.resolve(__dirname, '../out/renderer/index.html');
  console.log('Loading renderer build:', indexPath);

  // 注入 mock window.api 以便无需后端即可完整运行工作台
  await win.webContents.executeJavaScript(`
    window.__mockStore = {
      productMode: 'workbench',
      workbench_lastWorkspacePath: 'D:/test-workspace',
      workbench_lastActiveFilePath: 'test-note.md',
      workbench_isLeftCollapsed: false,
      workbench_rightPane: 'ai'
    };
    window.api = {
      platform: 'win32',
      storeGet: async (k) => window.__mockStore[k] ?? null,
      storeSet: async (k, v) => { window.__mockStore[k] = v; },
      onWindowFocusChange: () => () => {},
      onMaximizedChange: () => () => {},
      isMaximized: async () => false,
      windowDragStart: () => {},
      windowDragMove: () => {},
      windowDragEnd: () => {},
      workspace: {
        getDefault: async () => ({ path: 'D:/test-workspace', name: 'test-workspace' }),
        getRecent: async () => [],
        readTree: async () => ({
          nodes: [{
            name: 'test-note.md',
            path: 'test-note.md',
            isDirectory: false,
            size: 1024,
            mtime: Date.now()
          }]
        }),
        readFile: async () => ({
          success: true,
          content: '# 个人笔记与旁注测试\\n\\n这是一篇包含关键论点的精读文档。在此处我们进行了随手旁注记录。\\n\\n紧邻正文的体验极其流畅。'
        }),
        writeFile: async () => ({ success: true })
      },
      annotations: {
        listDocument: async () => ({
          success: true,
          data: [
            {
              id: 'test-note-1',
              scope: 'document',
              quote: '在此处我们进行了随手旁注记录',
              anchor: { exact: '在此处我们进行了随手旁注记录', prefix: '这是一篇包含关键论点的精读文档。', suffix: '。', offsetHint: 25 },
              comment: '这是紧挨正文右侧展示的便签注释',
              createdAt: Date.now() - 60000,
              updatedAt: Date.now() - 60000
            }
          ]
        }),
        listSource: async () => ({ success: true, data: { source: null, annotations: [] } }),
        upsertDocument: async () => ({ success: true }),
        deleteDocument: async () => ({ success: true }),
        reconcileDocument: async () => ({ success: true }),
        onChanged: () => () => {}
      },
      git: {
        status: async () => ({ clean: true, branch: 'main' })
      }
    };
  `);

  await win.loadFile(indexPath);
  await new Promise(r => setTimeout(r, 2000));

  // 1. 检查是否存在旧的侧边栏按钮
  const checkOldSidebarBtn = await win.webContents.executeJavaScript(`
    const oldBtn = document.querySelector('button[aria-label="打开标注"], button[aria-label="收起标注"]');
    oldBtn !== null;
  `);
  console.log('Old sidebar button exists:', checkOldSidebarBtn);

  // 2. 检查右侧边距旁注组件是否渲染
  const checkMarginNotes = await win.webContents.executeJavaScript(`
    const marginNotes = document.querySelector('aside[aria-label="文档原位旁注"]');
    const noteCard = document.querySelector('.border-l-amber-500');
    return {
      marginNotesExists: marginNotes !== null,
      noteCardExists: noteCard !== null,
      noteCardText: noteCard ? noteCard.innerText : ''
    };
  `);
  console.log('Margin notes check:', JSON.stringify(checkMarginNotes, null, 2));

  // 截图留档
  const shot = await win.capturePage();
  fs.writeFileSync(path.resolve(__dirname, '../docs/prototypes/workbench-margin-notes-runtime.png'), shot.toPNG());
  console.log('Screenshot saved to docs/prototypes/workbench-margin-notes-runtime.png');

  app.exit(0);
});
